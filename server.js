require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors    = require('cors');
const fetch   = require('node-fetch');

console.log('🚀 SERVER FILE RUNNING:', __filename);
console.log('🚀 SERVER START TIME:', new Date().toISOString());

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

app.use(cors({ origin: 'http://localhost:3001' }));
app.use(express.json());
app.use(limiter);
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

// ── Anti-echo guard ───────────────────────────────────────────────────────────
function isEchoReply(input, reply) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const a = norm(input);
  const b = norm(reply);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const aSet   = new Set(aWords);
  const overlap = bWords.filter(w => aSet.has(w)).length;
  return (overlap / Math.max(aWords.length, bWords.length)) > 0.75;
}

// ── WhatsApp input classifier ─────────────────────────────────────────────────
async function classifyLunaAssistInput(userInput, mode) {
  if (mode !== 'whatsapp') return 'normal_luna_assist';

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
        messages: [{ role: 'user', content: userInput }]
      })
    });

    if (!res.ok) {
      console.warn('[LaLanguish Router] classifier API error', res.status, '— defaulting to friend_message_to_reply_to');
      return 'friend_message_to_reply_to';
    }

    const data  = await res.json();
    const raw   = data.content && data.content[0] && data.content[0].text;
    const label = (raw || '').trim().toLowerCase().replace(/[^a-z_]/g, '');

    const VALID_LABELS = new Set([
      'friend_message_to_reply_to', 'learner_spanish_draft', 'learner_english_draft',
      'translation_request', 'explanation_request', 'normal_luna_assist'
    ]);

    return VALID_LABELS.has(label) ? label : 'friend_message_to_reply_to';
  } catch (err) {
    console.warn('[LaLanguish Router] classifier threw:', err.message, '— defaulting to friend_message_to_reply_to');
    return 'friend_message_to_reply_to';
  }
}

// ── Spanish Draft Reply ───────────────────────────────────────────────────────
// Dedicated path for when the learner typed in Spanish and wants to express
// it as a natural English WhatsApp message. Bypasses the general classifier.
async function handleSpanishDraftReply(req, res, input, detectedLang) {
  const normalizedInput = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const systemPrompt =
    `You are converting what a Spanish-speaking learner wants to say into a natural English WhatsApp message. ` +
    `This is NOT a reply to a friend. You are expressing the learner's OWN words in English. ` +
    `\n\nRULES — every one is mandatory:` +
    `\n1. Do NOT answer as a friend. Express what the learner is saying.` +
    `\n2. Do NOT summarize or shorten. Preserve EVERY idea in the input.` +
    `\n3. Remove only meaningless filler: "quiero decirte que", "quiero que sepas que", "quiero decir que". Keep everything after.` +
    `\n4. Preserve ALL connectors and follow-ups:` +
    `\n   - "y tu" / "y tú" / "y usted" → "What about you?"` +
    `\n   - "y ustedes" → "What about you all?"` +
    `\n   - "vamos a comer" → "Let's go eat" or "Do you want to go eat?"` +
    `\n   - "pero" → "but" | "también" → "too" / "also" | "entonces" → "so"` +
    `\n5. When the Spanish input contains multiple ideas, preserve EVERY idea in the English output. Never reduce the message to only the first idea.` +
    `\n6. Output: 1-3 short casual sentences. Like a real WhatsApp text.` +
    `\n7. No explanation. No teaching tone. No formal phrasing.` +
    `\n\nExamples — match completeness exactly:` +
    `\n"Quiero que sepas que tengo hambre y tu?" → "I'm hungry. What about you?"` +
    `\n"Quiero decirte que tengo hambre y tú?" → "I'm hungry. What about you?"` +
    `\n"Tengo hambre vamos a comer?" → "I'm hungry. Do you want to go eat?"` +
    `\n"Estoy cansado pero bien y tu?" → "I'm tired, but I'm good. What about you?"` +
    `\n"Tengo sueño y tú?" → "I'm sleepy. What about you?"` +
    `\n"Estoy bien también" → "I'm good too."` +
    `\n\nOutput ONLY a valid JSON object. No markdown. No code fences. Start with { end with }.` +
    `\nUse EXACTLY these keys:` +
    `\n{"friendMessage":"...","friendMeaningSpanish":"...","suggestedReplyEnglish":"...","suggestedReplySpanish":"...","noteSpanish":""}` +
    `\n- friendMessage: the original input verbatim` +
    `\n- friendMeaningSpanish: one clean Spanish sentence restating what the learner wants to say` +
    `\n- suggestedReplyEnglish: the full natural English version — never drop any idea` +
    `\n- suggestedReplySpanish: Spanish translation of suggestedReplyEnglish` +
    `\n- noteSpanish: empty string`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }]
      })
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      return res.status(502).json({ error: 'Anthropic error ' + aiRes.status + ': ' + errBody });
    }

    const aiData = await aiRes.json();
    const aiRaw  = aiData.content && aiData.content[0] && aiData.content[0].text;
    if (!aiRaw) return res.status(502).json({ error: 'Empty response from Anthropic' });

    const aiStr = aiRaw.trim();
    let parsed;
    try { parsed = JSON.parse(aiStr); }
    catch (_) {
      const s = aiStr.indexOf('{'), e = aiStr.lastIndexOf('}');
      if (s !== -1 && e > s) try { parsed = JSON.parse(aiStr.slice(s, e + 1)); } catch (_2) {}
    }
    if (!parsed) parsed = {};

    let finalSuggestedReplyEnglish = parsed.suggestedReplyEnglish || '';

    // ── Hard repair: append follow-ups the model may have dropped ────────────
    if (
      (normalizedInput.includes(' y tu') ||
       normalizedInput.includes(' y usted') ||
       normalizedInput.includes(' y ustedes') ||
       normalizedInput.includes(' y vos')) &&
      !/what about you|how about you|and you/i.test(finalSuggestedReplyEnglish)
    ) {
      finalSuggestedReplyEnglish =
        finalSuggestedReplyEnglish.replace(/[.!?]*$/, '') + '. What about you?';
    }

    if (
      normalizedInput.includes('vamos a comer') &&
      !/\b(eat|food|lunch|dinner)\b/i.test(finalSuggestedReplyEnglish)
    ) {
      finalSuggestedReplyEnglish =
        finalSuggestedReplyEnglish.replace(/[.!?]*$/, '') + ". Let's go eat.";
    }

    console.log('WA normalized input:', normalizedInput);
    console.log('WA before repair:', parsed.suggestedReplyEnglish);
    console.log('WA after repair:', finalSuggestedReplyEnglish);

    return res.json({
      mode:                  'whatsapp',
      classification:        'learner_spanish_draft',
      friendMessage:         parsed.friendMessage        || input,
      friendMeaningSpanish:  parsed.friendMeaningSpanish || '',
      suggestedReplyEnglish: finalSuggestedReplyEnglish,
      suggestedReplySpanish: parsed.suggestedReplySpanish || '',
      noteSpanish:           '',
    });
  } catch (err) {
    console.error('[LaLanguish SpanishDraft] fetch error:', err.message);
    return res.status(500).json({ error: 'Spanish draft helper error: ' + err.message });
  }
}

// ── WhatsApp Reply Helper ─────────────────────────────────────────────────────
// Completely separate from Luna Assist. Handles only conversation replies.
// No pronunciation, no grammar lessons, no translation-mode behavior.
async function handleWhatsAppReplyHelper(req, res, input, detectedLang) {
  console.log('WhatsApp Reply Helper activated');

  // ── Spanish draft fast-path — bypasses classifier ─────────────────────────
  const normalizedInput = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const isSpanishDraft =
    /\b(quiero decir|quiero decirte|quiero que sepas|como digo|como digo|quiero escribir|dile que|quiero responder)\b/.test(normalizedInput);

  if (isSpanishDraft) {
    console.log('🇪🇸 SPANISH DRAFT PATH ACTIVATED');
    return await handleSpanishDraftReply(req, res, input, detectedLang);
  }

  const classification = await classifyLunaAssistInput(input, 'whatsapp');
  console.log('Luna Assist classification:', classification);

  const JSON_SPEC =
    `\n\nOutput ONLY a valid JSON object. No markdown. No code fences. Start with { end with }.` +
    `\nUse EXACTLY these keys — no extras:` +
    `\n{"friendMessage":"...","friendMeaningSpanish":"...","suggestedReplyEnglish":"...","suggestedReplySpanish":"...","noteSpanish":"..."}` +
    `\n- friendMessage: the original input verbatim` +
    `\n- friendMeaningSpanish: one short Spanish sentence explaining what was said or intended` +
    `\n- suggestedReplyEnglish: the natural English output (see rules below)` +
    `\n- suggestedReplySpanish: Spanish translation of suggestedReplyEnglish` +
    `\n- noteSpanish: one short Spanish vocab or grammar tip under 12 words, or empty string`;

  let systemPrompt;

  if (classification === 'learner_spanish_draft') {
    systemPrompt =
      `You are a WhatsApp message coach. The learner typed in Spanish. ` +
      `Your job: write the FULL meaning as a short, natural English WhatsApp message. ` +
      `\n\nRULES — every rule is mandatory:` +
      `\n1. NEVER translate literally. Reconstruct the full meaning as a native English speaker would text it.` +
      `\n2. PRESERVE EVERY IDEA in the input. Never drop clauses, questions, or follow-ups.` +
      `\n3. STRIP only meaningless filler: "quiero decirte que", "quiero decir que", "te quiero decir que". Keep everything after.` +
      `\n4. Translate ALL connectors and follow-ups:` +
      `\n   - "y tú" / "y tu" → "What about you?"` +
      `\n   - "y usted" → "How about you?"` +
      `\n   - "vamos a comer" → "Let's go eat" or "Do you want to go eat?"` +
      `\n   - "pero" → "but"  |  "también" → "too" / "also"  |  "entonces" → "so"` +
      `\n5. Output: 1-3 short sentences. Casual. Like a real WhatsApp message.` +
      `\n6. No explanation. No teaching tone. No formal phrasing.` +
      `\n7. friendMeaningSpanish = one clean Spanish sentence restating what they want to say.` +
      `\n\nExamples — output MUST match this completeness:` +
      `\n"Quiero decirte que tengo hambre y tu?" → "I'm hungry. What about you?"` +
      `\n"Quiero decirte que eres mi amigo." → "You're my friend."` +
      `\n"Tengo hambre vamos a comer?" → "I'm hungry. Do you want to go eat?"` +
      `\n"Tengo hambre, vamos a comer?" → "I'm hungry. Let's go eat."` +
      `\n"Tengo hambre pero estoy bien" → "I'm hungry, but I'm good."` +
      `\n"Estoy cansado y tu?" → "I'm tired. What about you?"` +
      `\n"Tengo sueño y tú?" → "I'm sleepy. What about you?"` +
      `\n"No sé cómo llegar" → "I'm not sure how to get there."` +
      `\n"Estoy bien también" → "I'm good too."` +
      JSON_SPEC;

  } else if (classification === 'learner_english_draft') {
    systemPrompt =
      `You are a WhatsApp conversation coach helping a Spanish-speaking learner polish an English message. ` +
      `The learner typed an English draft that may have small mistakes. ` +
      `\n\nRULES:` +
      `\n1. suggestedReplyEnglish = gently corrected natural English — same tone, same meaning.` +
      `\n2. If already correct, return it unchanged.` +
      `\n3. Do NOT make it more formal than the original.` +
      `\n4. friendMeaningSpanish = one Spanish sentence explaining what their message says.` +
      `\n5. noteSpanish = briefly state the correction rule in Spanish if you fixed something. Otherwise empty.` +
      `\n6. No pronunciation tips, grammar lessons, or example sentences.` +
      JSON_SPEC;

  } else {
    // friend_message_to_reply_to (and any other label)
    systemPrompt =
      `You are a WhatsApp conversation coach. ` +
      `A Spanish-speaking English learner received a message from a friend. ` +
      `Write a short, natural reply FROM the learner TO the friend. ` +
      `\n\nCRITICAL RULES:` +
      `\n1. suggestedReplyEnglish is the learner's REPLY. It must NEVER repeat, rephrase, or correct the friend's message.` +
      `\n2. If the friend's message has grammar mistakes, do NOT correct them in the reply. A noteSpanish is fine.` +
      `\n3. The reply must answer or react and keep conversation going.` +
      `\n4. 1-2 casual sentences max, like a real WhatsApp message.` +
      `\n5. No pronunciation tips, grammar lessons, or example sentences.` +
      `\n\nExamples — the WRONG column shows what you must NEVER do:` +
      `\nFriend: "How is you morning going?" WRONG reply: "How is your morning going?" CORRECT reply: "It's going well, thanks! How about yours?"` +
      `\nFriend: "Did you get coffe today?" WRONG reply: "Did you get coffee today?" CORRECT reply: "Not yet, but I could use one. How about you?"` +
      `\nFriend: "What are you doing?" CORRECT reply: "Not much, just relaxing. What about you?"` +
      `\nFriend: "Do you want to meet?" CORRECT reply: "Sure, what time works for you?"` +
      JSON_SPEC;
  }

  try {
    const waRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }]
      })
    });

    if (!waRes.ok) {
      const errBody = await waRes.text();
      return res.status(502).json({ error: 'Anthropic error ' + waRes.status + ': ' + errBody });
    }

    const waData = await waRes.json();
    const waRaw  = waData.content && waData.content[0] && waData.content[0].text;
    if (!waRaw) return res.status(502).json({ error: 'Empty response from Anthropic' });

    const waStr = waRaw.trim();
    console.log('WhatsApp raw suggested reply:', waStr.slice(0, 200));

    let waParsed;
    try { waParsed = JSON.parse(waStr); }
    catch (_) {
      const s = waStr.indexOf('{'), e = waStr.lastIndexOf('}');
      if (s !== -1 && e > s) try { waParsed = JSON.parse(waStr.slice(s, e + 1)); } catch (_2) {}
    }
    if (!waParsed) waParsed = {};

    // ── Deterministic repair — runs unconditionally before res.json ──────────
    const normalizedInput = input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    let finalSuggestedReplyEnglish = waParsed.suggestedReplyEnglish || '';

    const hasSpanishYouFollowup =
      normalizedInput.includes(' y tu') ||
      normalizedInput.includes(' y usted') ||
      normalizedInput.includes(' y ustedes') ||
      normalizedInput.includes(' y vos') ||
      normalizedInput.includes('¿y tu') ||
      normalizedInput.includes('?y tu');

    const alreadyHasEnglishYouFollowup =
      /what about you|how about you|and you/i.test(finalSuggestedReplyEnglish);

    if (hasSpanishYouFollowup && !alreadyHasEnglishYouFollowup) {
      finalSuggestedReplyEnglish =
        finalSuggestedReplyEnglish.replace(/[.!?]*$/, '') + '. What about you?';
    }

    if (normalizedInput.includes('vamos a comer') &&
        !/\b(eat|food|lunch|dinner)\b/i.test(finalSuggestedReplyEnglish)) {
      finalSuggestedReplyEnglish =
        finalSuggestedReplyEnglish.replace(/[.!?]*$/, '') + ". Let's go eat.";
    }

    console.log('WA normalized input:', normalizedInput);
    console.log('WA before repair:', waParsed.suggestedReplyEnglish);
    console.log('WA after repair:', finalSuggestedReplyEnglish);

    if (isEchoReply(input, finalSuggestedReplyEnglish)) {
      console.log('WhatsApp anti-echo guard triggered — replacing echo with fallback');
      finalSuggestedReplyEnglish = "That's interesting! Tell me more.";
    }

    console.log('WhatsApp final suggested reply:', finalSuggestedReplyEnglish);

    return res.json({
      mode:                  'whatsapp',
      classification,
      friendMessage:         waParsed.friendMessage        || input,
      friendMeaningSpanish:  waParsed.friendMeaningSpanish || '',
      suggestedReplyEnglish: finalSuggestedReplyEnglish,
      suggestedReplySpanish: waParsed.suggestedReplySpanish || '',
      noteSpanish:           waParsed.noteSpanish           || '',
    });
  } catch (err) {
    console.error('[LaLanguish WhatsApp] fetch error:', err.message);
    return res.status(500).json({ error: 'WhatsApp helper error: ' + err.message });
  }
}

// ── Luna Assist proxy ─────────────────────────────────────────────────────────
app.post('/api/luna', async (req, res) => {
  console.log('🔥 /api/luna HIT', req.body);

  const { input, context, inputType, mode, detectedType, intent } = req.body;

  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Missing input' });
  }

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_api_key_here') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  const finalDetectedType = detectedType || inputType || mode || intent;
  const detectedLang = detectLanguage(input.trim());

  // ── WhatsApp: dedicated helper, completely separate from Luna Assist ──────────
  if (
    finalDetectedType === 'whatsapp' ||
    inputType === 'whatsapp' ||
    mode === 'whatsapp' ||
    detectedType === 'whatsapp' ||
    intent === 'whatsapp'
  ) {
    console.log('🔥 ENTERED WHATSAPP HELPER');
    console.log('WhatsApp routing values:', { finalDetectedType, inputType, mode, detectedType, intent });
    return await handleWhatsAppReplyHelper(req, res, input.trim(), detectedLang);
  }

  // ── Standard Luna Assist — Explain / Help me say it / Translate ──────────────
  const lunaContext    = context || 'general';

  console.log('[LaLanguish Luna] detected language:', detectedLang);
  console.log('[LaLanguish Luna] inputType:', finalDetectedType);
  console.log('[LaLanguish Luna] context:', lunaContext);

  const contextNote = lunaContext !== 'general'
    ? `The learner is currently practicing the "${lunaContext}" topic. `
    : '';

  const wordCount      = input.trim().split(/\s+/).length;
  const isSentenceLike = wordCount >= 3;

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
  }[finalDetectedType] || 'Help the learner understand or use this phrase.';

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

    try {
      parsed = JSON.parse(rawTrimmed);
    } catch (_) {
      const start = rawTrimmed.indexOf('{');
      const end   = rawTrimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(rawTrimmed.slice(start, end + 1)); } catch (_2) { parsed = null; }
      }
    }

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

// ── ElevenLabs voice proxy ────────────────────────────────────────────────────
const ELEVENLABS_DEFAULT_VOICE_ID = 'IDHS58OMlK9jZvRdhEVy';

app.post('/api/voice', async (req, res) => {
  const { text, voiceId, model_id, voice_settings } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }

  if (!ELEVENLABS_API_KEY) {
    console.error('[LaLanguish Voice] ELEVENLABS_API_KEY not set in .env');
    return res.status(500).json({ error: 'Voice service not configured' });
  }

  const targetVoiceId = voiceId || ELEVENLABS_DEFAULT_VOICE_ID;

  try {
    const elRes = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + targetVoiceId,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: model_id || 'eleven_turbo_v2',
          voice_settings: voice_settings || { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );

    if (!elRes.ok) {
      const errText = await elRes.text();
      console.error('[LaLanguish Voice] ElevenLabs error', elRes.status, errText.slice(0, 120));
      return res.status(502).json({ error: 'Voice service error ' + elRes.status });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    elRes.body.pipe(res);
  } catch (err) {
    console.error('[LaLanguish Voice] fetch error:', err.message);
    res.status(500).json({ error: 'Voice server error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LaLanguish] Server running at http://localhost:${PORT}`);
  console.log(`[LaLanguish] Serving from: ${__filename}`);
  console.log(`[LaLanguish] Anthropic key loaded: ${ANTHROPIC_API_KEY && ANTHROPIC_API_KEY !== 'your_api_key_here' ? 'YES' : 'NO — set ANTHROPIC_API_KEY in .env'}`);
  console.log(`[LaLanguish] ElevenLabs key loaded: ${ELEVENLABS_API_KEY ? 'YES' : 'NO — set ELEVENLABS_API_KEY in .env'}`);
});
