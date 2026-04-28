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

  // Direction note — tells Luna which field maps to what
  const directionNote = detectedLang === 'spanish'
    ? 'The learner typed in Spanish. "english" = natural English version. "meaning" = original or cleaned Spanish phrase.'
    : 'The learner typed in English. "english" = corrected natural English. "meaning" = Spanish translation.';

  // Per-type instruction injected into the unified prompt
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
