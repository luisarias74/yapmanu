require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors({ origin: ['http://localhost:3001', 'http://127.0.0.1:3001', 'null', '*'] }));
app.use(express.json());

// Serve index.html and all static files from this directory
app.use(express.static(__dirname));

// Luna Assist proxy — keeps API key out of the browser entirely
app.post('/api/luna', async (req, res) => {
  const { input, context, inputType, intent } = req.body;

  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Missing input' });
  }

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_api_key_here') {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  const lunaContext  = context   || 'general';
  const detectedType = inputType || 'phrase';

  const contextNote = lunaContext !== 'general'
    ? `The learner is currently practicing the "${lunaContext}" topic.`
    : 'The learner is practicing general English.';

  const inputGuide = {
    translate: 'The learner wants a translation. Give the English and Spanish versions.',
    explain:   'The learner wants a short explanation. Explain the phrase simply in 1 sentence.',
    phrase:    'The learner typed a phrase. If it needs correction, give the corrected English version.'
  }[detectedType] || 'Help the learner understand or use this phrase.';

  const systemPrompt =
    `You are Luna, a calm bilingual tutor for English \u2194 Spanish learners. ` +
    `${contextNote} ${inputGuide} ` +
    `Reply ONLY with a valid JSON object \u2014 no markdown, no preamble. ` +
    `Always include exactly these keys: ` +
    `"english" (the English phrase, max 10 words), ` +
    `"meaning" (the Spanish translation, 1 short sentence), ` +
    `"example" (1 short natural English sentence using the phrase), ` +
    `"note" (1 extra tip if genuinely useful, else null). ` +
    `Keep every field to 1\u20132 lines. Be calm and concise.`;

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
        max_tokens: 280,
        system: systemPrompt,
        messages: [{ role: 'user', content: input.trim() }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[Luna proxy] Anthropic error', anthropicRes.status, errText);
      return res.status(502).json({ error: 'Anthropic API error ' + anthropicRes.status });
    }

    const data = await anthropicRes.json();
    const raw  = data.content && data.content[0] && data.content[0].text;
    if (!raw) return res.status(502).json({ error: 'Empty response from Anthropic' });

    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (_) {
      return res.status(502).json({ error: 'Invalid JSON from model', raw });
    }

    res.json({
      english: parsed.english || input.trim(),
      meaning: parsed.meaning || '',
      example: parsed.example || '',
      note:    parsed.note    || null
    });
  } catch (err) {
    console.error('[Luna proxy] fetch error:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[LaLanguish] Server running at http://localhost:${PORT}`);
  console.log(`[LaLanguish] API key loaded: ${ANTHROPIC_API_KEY ? 'YES' : 'NO — set ANTHROPIC_API_KEY in .env'}`);
});
