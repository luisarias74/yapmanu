require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors({ origin: ['http://localhost:3001', 'http://127.0.0.1:3001', 'null', '*'] }));
app.use(express.json());
app.use(express.static(__dirname));

// ── Language detection ────────────────────────────────────────────────────────
const SPANISH_WORDS = new Set([
  'tengo','quiero','necesito','dónde','donde','como','cómo','baño','hambre',
  'agua','listo','gracias','favor','gustaría','gustaria','hola','adiós',
  'adios','buenas','buenos','días','noches','tarde','hablar','decir','saber',
  'puedo','puede','podría','podria','estoy','está','esta','están','estan',
  'es','son','soy','hay','tiene','tengo','voy','quiero','ayuda','dinero',
  'hotel','taxi','comida','bebida','médico','medico','farmacia','baño',
  'cuenta','mesa','reserva','vuelo','pasaporte','equipaje','precio','cuánto',
  'cuanto','dónde','donde','cómo','como','qué','que','cuál','cual','mi','me',
  'por','para','con','sin','una','uno','unos','unas','del','las','los','muy',
  'más','mas','bien','mal','aquí','aqui','allí','alli','ahora','hoy','mañana',
]);

function detectLanguage(text) {
  if (/[¿¡]/.test(text)) return 'spanish';
  const words = text.toLowerCase().replace(/[^a-záéíóúüñ\s]/gi, ' ').split(/\s+/);
  const hits = words.filter(w => SPANISH_WORDS.has(w)).length;
  return hits >= 1 ? 'spanish' : 'english';
}

// ── WhatsApp input classifier ─────────────────────────────────────────────────
// Classifies what the user typed before the WA prompt runs, so the prompt can
// be tuned per input type. Returns one of:
//   friend_message_to_reply_to | learner_spanish_draft | learner_english_draft
//   translation_request | explanation_request | normal_luna_assist
async function classifyLunaAssistInput(userInput, mode) {
  // Only run the Anthropic classifier for WhatsApp mode
  if (mode !== 'whatsapp') return 'normal_luna_assist';

  const text = userInput;
  const classifierPrompt =
    `You are a classifier. The user is in WhatsApp Reply mode of a language-learning app. ` +
    `Classify the input into exactly one of these labels:\n` +
    `- friend_message_to_reply_to   (an English message the learner received from a friend)\n` +
    `- learner_spanish_draft        (Spanish text the learner typed, wanting to know how to say it in English)\n` +
    `- learner_english_draft        (an English draft reply the learner is writing, possibly with mistakes)\n` +
    `- translation_request          (explicit request to translate something, e.g. "how do I say X")\n` +
    `- explanation_request          (asking what a word/phrase means)\n` +
    `- normal_luna_assist           (anything else — general question, not clearly WhatsApp-related)\n` +
    `\nRespond with ONLY the label. No punctuation. No explanation. One line.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        system: classifierPrompt,
        messages: [{ role: 'user', content: text }]
      })
    });

    if (!res.ok) {
      console.warn('[LaLanguish Router] classifier API error', res.status, '— defaulting to friend_message_to_reply_to');
      return 'friend_message_to_reply_to';
    }

    const data = await res.json();
    const raw  = data.content && data.content[0] && data.content[0].text;
    const label = (raw || '').trim().toLowerCase().replace(/[^a-z_]/g, '');

    const VALID_LABELS = new Set([
      'friend_message_to_reply_to',
      'learner_spanish_draft',
      'learner_english_draft',
      'translation_request',
      'explanation_request',
      'normal_luna_assist'
    ]);

    return VALID_LABELS.has(label) ? label : 'friend_message_to_reply_to';
  } catch (err) {
    console.warn('[LaLanguish Router] classifier threw:', err.message, '— defaulting to friend_message_to_reply_to');
    return 'friend_message_to_reply_to';
  }
}

// ── Luna Assist proxy ─────────────────────────────────────────────────────────
app.post('/api/luna', async (req, res) => {
  const { input, context, inputType, intent } = req.body;

  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Missing input' });
  }

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_api_key_here') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  const lunaContext    = context   || 'general';
  const detectedType   = inputType || 'phrase';
  const detectedLang   = detectLanguage(input.trim());

  console.log('[LaLanguish Luna] detected language:', detectedLang);
  console.log('[LaLanguish Luna] inputType:', detectedType);
  console.log('[LaLanguish Luna] context:', lunaContext);

  const contextNote = lunaContext !== 'general'
    ? `The learner is currently practicing the "${lunaContext}" topic. `
    : '';

  // Determine if input looks like a sentence vs. a single word/fragment
  const wordCount = input.trim().split(/\s+/).length;
  const isSentenceLike = wordCount >= 3;

  // ── WhatsApp Chat Helper — conversation assistant, NOT an explanation mode ──
  if (detectedType === 'whatsapp') {
    // ── Classifier: identify what kind of input this is ──────────────────────
    const classification = await classifyLunaAssistInput(input.trim(), detectedType);
    console.log('Luna Assist classification:', classification);

    // ── Build a classification-aware system prompt ────────────────────────────
    const WA_JSON_SPEC =
      `\n\nReply with ONLY a valid JSON object. No markdown. No code fences. Start with { end with }.` +
      `\nUse EXACTLY these keys:` +
      `\n{"friendMessage":"...","friendMeaningSpanish":"...","suggestedReplyEnglish":"...","suggestedReplySpanish":"...","noteSpanish":"..."}` +
      `\n- friendMessage: repeat the original input verbatim` +
      `\n- friendMeaningSpanish: one short Spanish sentence explaining what was said or meant` +
      `\n- suggestedReplyEnglish: the natural English output (see rules per classification below)` +
      `\n- suggestedReplySpanish: Spanish translation of suggestedReplyEnglish` +
      `\n- noteSpanish: one short Spanish grammar or vocab tip (under 12 words), or empty string`;

    let waPrompt;

    if (classification === 'learner_spanish_draft') {
      waPrompt =
        `You are helping a Spanish-speaking English learner express themselves in English. ` +
        `The learner has typed something in Spanish and wants to know how to say it naturally in English. ` +
        `\n\nRULES:` +
        `\n1. suggestedReplyEnglish is the natural English phrase that conveys what the learner wants to say.` +
        `\n2. Keep it short and conversational (1-2 sentences max).` +
        `\n3. friendMeaningSpanish: restate the learner's intent in clean Spanish (e.g. "Quieres decir que tienes hambre.").` +
        `\n\nExample: input "Quiero decir que tengo hambre" → suggestedReplyEnglish: "I'm hungry."` +
        `\nExample: input "No sé cómo llegar" → suggestedReplyEnglish: "I'm not sure how to get there."` +
        WA_JSON_SPEC;

    } else if (classification === 'learner_english_draft') {
      waPrompt =
        `You are helping a Spanish-speaking English learner improve a WhatsApp message they are writing. ` +
        `The learner has typed a draft in English that may contain mistakes. ` +
        `\n\nRULES:` +
        `\n1. suggestedReplyEnglish is the gently corrected, natural English version of their draft.` +
        `\n2. If the draft was already correct, return it unchanged.` +
        `\n3. Keep the same meaning and tone. Do not make it more formal than the original.` +
        `\n4. friendMeaningSpanish: explain in Spanish what their message means (e.g. "Le estás diciendo a tu amigo que estás ocupado.").` +
        `\n5. noteSpanish: if you corrected something, explain the rule briefly in Spanish. Otherwise leave it empty.` +
        `\n\nExample: "I am very tire today" → suggestedReplyEnglish: "I'm very tired today." noteSpanish: "Se usa 'tired' (adjetivo), no 'tire'."` +
        WA_JSON_SPEC;

    } else {
      // Default: friend_message_to_reply_to (and any other label)
      waPrompt =
        `You are helping a Spanish-speaking learner reply to a friend's WhatsApp message. ` +
        `The user input is the FRIEND's message. ` +
        `Your job is to write a natural reply FROM the learner TO the friend. ` +
        `\n\nCRITICAL RULES:` +
        `\n1. suggestedReplyEnglish is the learner's ANSWER to the friend. Never a correction or rephrasing of the friend's message.` +
        `\n2. If the friend's message has grammar mistakes, do NOT put the corrected version as the reply. Only note it in noteSpanish if useful.` +
        `\n3. The reply must answer the friend and move the conversation forward.` +
        `\n4. Keep replies short and casual, like a real WhatsApp text (1-2 sentences max).` +
        `\n5. friendMeaningSpanish: one short Spanish sentence explaining what the friend said (e.g. "Tu amigo te saluda y pregunta cómo estás.").` +
        `\n\nExamples — follow this pattern exactly:` +
        `\nFriend: "Good morning" → suggestedReplyEnglish: "Good morning! How are you today?"` +
        `\nFriend: "How is you morning going?" → suggestedReplyEnglish: "It's going well, thanks! How about yours?" (WRONG: "How is your morning going?")` +
        `\nFriend: "Did you get coffe today?" → suggestedReplyEnglish: "Not yet, but I could use one. How about you?" (WRONG: "Did you get coffee today?")` +
        `\nFriend: "What are you doing?" → suggestedReplyEnglish: "Not much, just relaxing. What about you?"` +
        `\nFriend: "Do you want to meet?" → suggestedReplyEnglish: "Sure, what time works for you?"` +
        `\nFriend: "Are you free later?" → suggestedReplyEnglish: "Yes, I'm free after 5. What's up?"` +
        WA_JSON_SPEC;
    }

    try {
      const waRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: waPrompt, messages: [{ role: 'user', content: input.trim() }] })
      });
      if (!waRes.ok) { const t = await waRes.text(); return res.status(502).json({ error: 'Anthropic error ' + waRes.status }); }
      const waData = await waRes.json();
      const waRaw  = waData.content && waData.content[0] && waData.content[0].text;
      if (!waRaw) return res.status(502).json({ error: 'Empty response' });

      const waStr = waRaw.trim();
      let waParsed;
      try { waParsed = JSON.parse(waStr); }
      catch (_) {
        const s = waStr.indexOf('{'), e = waStr.lastIndexOf('}');
        if (s !== -1 && e > s) try { waParsed = JSON.parse(waStr.slice(s, e + 1)); } catch (_2) {}
      }
      if (!waParsed) waParsed = {};

      console.log('[LaLanguish Luna] whatsapp keys returned:', Object.keys(waParsed));

      return res.json({
        mode:                   'whatsapp',
        classification,
        friendMessage:          waParsed.friendMessage          || input.trim(),
        friendMeaningSpanish:   waParsed.friendMeaningSpanish   || '',
        suggestedReplyEnglish:  waParsed.suggestedReplyEnglish  || '',
        suggestedReplySpanish:  waParsed.suggestedReplySpanish  || '',
        noteSpanish:            waParsed.noteSpanish            || '',
        detectedLang
      });
    } catch (err) {
      console.error('[LaLanguish Luna] whatsapp fetch error:', err.message);
      return res.status(500).json({ error: 'Server error: ' + err.message });
    }
  }

  // ── Standard Assist ───────────────────────────────────────────────────────
  // Direction note — tells Luna which field maps to what
  const directionNote = detectedLang === 'spanish'
    ? 'The learner typed in Spanish. "english" = natural English version. "meaning" = original or cleaned Spanish phrase.'
    : 'The learner typed in English. "english" = corrected natural English. "meaning" = Spanish translation.';

  const inputGuide = {
    translate:
      'The learner wants a translation between English and Spanish. Give the clean English version and its Spanish equivalent.',

    explain:
      'The learner wants a brief explanation of a word or phrase. Explain its meaning simply in one sentence. ' +
      'If the phrase has a grammar note worth sharing, put it in "note".',

    phrase: isSentenceLike
      ? 'The learner typed a sentence or phrase that may have grammar errors. ' +
        'Correct it naturally into fluent English. ' +
        'In the "note" field: write a SHORT bilingual correction note aimed at a Spanish speaker. ' +
        'Start in Spanish, then show the corrected form in English. ' +
        'Format: "En inglés [short rule in Spanish]: [corrected example]." ' +
        'Example: "En inglés se usa \'are\' con \'you\': How old are you?" ' +
        'Another example: "Después de \'need\' usamos \'to\': I need to go." ' +
        'If the sentence was already correct, set "note" to "Suena natural." ' +
        'Keep the note under 15 words total. Never explain more than one rule at a time.'
      : 'The learner typed a short phrase or word. Provide the natural English version and its Spanish translation.'
  }[detectedType] || 'Help the learner understand or use this phrase.';

  const systemPrompt =
    `You are Luna, a bilingual English tutor for Spanish-speaking learners. ` +
    `Your job is to help learners speak English confidently and correctly. ` +
    `${contextNote}${inputGuide} ${directionNote} ` +
    `IMPORTANT: Reply with ONLY a single valid JSON object. ` +
    `No markdown. No code fences. No text before or after the JSON. ` +
    `The output must begin with { and end with }. ` +
    `Required keys — keep every value to 1-2 lines maximum: ` +
    `"english" (corrected natural English phrase, max 12 words), ` +
    `"meaning" (Spanish equivalent, one short line), ` +
    `"example" (one short natural English sentence using the corrected phrase), ` +
    `"note" (one short grammar tip, correction rule, or "That sounds natural." — never null for phrase mode).`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: input.trim() }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[LaLanguish Luna] Anthropic error', anthropicRes.status, errText);
      return res.status(502).json({ error: 'Anthropic API error ' + anthropicRes.status });
    }

    const data = await anthropicRes.json();
    const raw  = data.content && data.content[0] && data.content[0].text;
    if (!raw) return res.status(502).json({ error: 'Empty response from Anthropic' });

    const rawTrimmed = raw.trim();
    let parsed;

    // 1. Direct parse
    try {
      parsed = JSON.parse(rawTrimmed);
    } catch (_) {
      // 2. Extract first { ... last } block (handles markdown fences or surrounding prose)
      const start = rawTrimmed.indexOf('{');
      const end   = rawTrimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(rawTrimmed.slice(start, end + 1)); } catch (_2) { parsed = null; }
      }
    }

    // 3. Graceful fallback
    if (!parsed) {
      console.warn('[LaLanguish Luna] Could not parse JSON, using fallback. raw:', rawTrimmed.slice(0, 120));
      parsed = { english: rawTrimmed.slice(0, 120), meaning: '', example: '', note: null };
    }

    res.json({
      english:  parsed.english || input.trim(),
      meaning:  parsed.meaning || '',
      example:  parsed.example || '',
      note:     parsed.note    || null,
      detectedLang
    });
  } catch (err) {
    console.error('[LaLanguish Luna] fetch error:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[LaLanguish] Server running at http://localhost:${PORT}`);
  console.log(`[LaLanguish] API key loaded: ${ANTHROPIC_API_KEY && ANTHROPIC_API_KEY !== 'your_api_key_here' ? 'YES' : 'NO — set ANTHROPIC_API_KEY in .env'}`);
});
