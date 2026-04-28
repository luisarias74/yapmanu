# Voice and Repeat Audit Report

**Date:** 2026-04-26
**Scope:** (A) Understand voice sounds robotic vs Speak; (B) Repeat Check button does nothing
**Files:** `index.html` only
**Status:** Audit only — no files modified.

---

## Issue A — Voice mismatch: Understand uses robotic browser voice

### A.1 — What voice path Speak uses

All Speak audio flows through `speakText()` (line 2740):

```javascript
function speakText(text) {
  lastSpokenPhrase = text;
  if (LUNA_VOICE_PROVIDER === 'elevenlabs') {
    speakWithElevenLabs(text);   // ← attempted first
  } else {
    speakWithBrowser(text);
  }
}
```

`LUNA_VOICE_PROVIDER` is hardcoded to `'elevenlabs'` (line 2521). The EL API key is burned — every request returns HTTP 401. The catch block in `playElQueue()` (line 2710) falls back:

```javascript
speakWithBrowser(text, browserRate || 0.86);
```

`speakWithBrowser` (line 2541) uses the global `lunaVoice` variable, selected by `loadVoices()`:

```javascript
lunaVoice = voices.find(v =>
  v.name.includes('Samantha') ||        // ← macOS Samantha — the "good" voice
  v.name.includes('Google US English') ||
  v.name.includes('Google') ||
  v.name.includes('Natural')
) || voices.find(v => v.lang === 'en-US') || voices[0] || null;
```

Rate: `0.86`, pitch: `1.03`.

**So Speak uses: EL (fails) → `speakWithBrowser` with `lunaVoice` = Samantha (on macOS).**

---

### A.2 — What voice path Understand uses

Understand audio flows through `undSpeak()` (line 4513):

```javascript
function undSpeak(text, rate, onEnd) {
  if (!window.speechSynthesis || !text) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    if (undLunaVoice) u.voice = undLunaVoice;   // ← separate voice variable
    u.rate = rate || 0.9;
    u.pitch = 1.02;
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }, 60);
}
```

`undLunaVoice` is loaded by `undLoadVoice()` (line 4499):

```javascript
undLunaVoice =
  v.find(x => x.name.includes('Samantha')) ||
  v.find(x => x.name.includes('Google US English')) ||
  v.find(x => x.lang === 'en-US' && x.localService) ||   // ← picks local service voice, not Google
  v.find(x => x.lang === 'en-US') ||
  v[0] || null;
```

Rate: `0.9` (caller passes `0.88`), pitch: `1.02`.

**Understand does NOT go through `speakText()` or ElevenLabs at all — it is entirely separate browser TTS.**

---

### A.3 — Why Understand is not using the same good voice

Three differences explain the robotic quality:

**Difference 1 — Separate voice variable (`undLunaVoice` vs `lunaVoice`):**

The two variables are populated by two separate loader functions. If `undLoadVoice` runs before the browser has finished loading voices (a race condition common on first page load), `undLunaVoice` may resolve to a lower-quality fallback while `lunaVoice` resolves correctly later when EL failure triggers `speakWithBrowser`.

**Difference 2 — Fallback priority differs:**

| Step | Speak (`loadVoices`) | Understand (`undLoadVoice`) |
|---|---|---|
| 1 | `includes('Samantha')` | `includes('Samantha')` |
| 2 | `includes('Google US English')` | `includes('Google US English')` |
| 3 | `includes('Google')` ← broader | `lang === 'en-US' && localService` ← picks local/system |
| 4 | `includes('Natural')` | `lang === 'en-US'` |
| 5 | `lang === 'en-US'` | `voices[0]` |

At step 3, if neither Samantha nor Google US English is available:
- Speak falls through to `includes('Google')` — picks any Google neural voice
- Understand falls through to `lang === 'en-US' && localService` — picks any **local service** en-US voice, which on many systems is a robotic system voice

**Difference 3 — Rate and pitch are slightly different:**

- Speak fallback: rate `0.86`, pitch `1.03`
- Understand: rate `0.88`/`0.9`, pitch `1.02`

Small but contributes to the perceived difference in naturalness.

**Root cause:** `undSpeak` uses a separate voice loader with a different fallback chain that can land on a robotic system voice instead of the same Samantha/Google voice Speak uses.

---

### A.4 — Smallest safe fix

Inside `undSpeak()` (line 4519), replace `undLunaVoice` with `lunaVoice` — the same voice variable already loaded and used by the Speak path:

**Before (line 4519):**
```javascript
if (undLunaVoice) u.voice = undLunaVoice;
```

**After:**
```javascript
if (lunaVoice) u.voice = lunaVoice;
```

`lunaVoice` is a global declared at line 2526, populated by `loadVoices()` at page load and on `voiceschanged`. It is always in scope from `undSpeak`.

This change:
- Makes Understand use the exact same voice object as Speak's browser fallback
- Requires no change to `undLoadVoice`, `undSpeak`, or any other Understand logic
- Leaves rate/pitch in `undSpeak` untouched (minor tuning, safe to leave as-is)
- One word changed: `undLunaVoice` → `lunaVoice`

**Risk: Minimal.** `lunaVoice` is guaranteed to be set before any user interaction (it's loaded at `DOMContentLoaded` and updated on `voiceschanged`). If it's null, `undSpeak` already silently skips the voice assignment and uses the browser default — same behavior as before.

---

## Issue B — Repeat mode Check button does nothing

### B.1 — Repeat screen button/input IDs

| Element | ID | Type |
|---|---|---|
| Text input (recall mode) | `repeat-recall-input` | `<input type="text">` |
| Check button | `repeat-submit-btn` | `<button>` |
| Try again / Next challenge button | `repeat-reset-btn` | `<button>` |
| Recall wrapper div | `repeat-recall` | `<div class="repeat-recall hidden">` |
| Actions wrapper div | `repeat-actions` | `<div class="repeat-actions">` |

---

### B.2 — Event listeners for Check and Enter

**Check button** (line 3469):
```javascript
repeatSubmitBtn.addEventListener('click', () => {
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';
  if (isRecallLike && !repeatComplete) {
    checkRepeatAnswer();
  }
});
```

**Enter key on input** (line 3476):
```javascript
repeatRecallInput.addEventListener('keydown', (event) => {
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';
  if (event.key === 'Enter' && isRecallLike && !repeatComplete) {
    event.preventDefault();
    checkRepeatAnswer();
  }
});
```

Both listeners are correctly wired and call `checkRepeatAnswer()`. The event listeners are NOT the bug.

---

### B.3 — Function that validates the answer

`checkRepeatAnswer()` (line 3271):
```javascript
function checkRepeatAnswer() {
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';
  const built = isRecallLike ? repeatRecallInput.value.trim() : getRepeatBuiltSentence();
  const correct = normalizeRepeatText(built) === normalizeRepeatText(currentRepeatPhrase);
  // shows success or retry feedback...
}
```

The function itself is complete and correct. It is not the source of the problem.

---

### B.4 — Why Check and Enter do nothing

**There are two compounding bugs:**

**Bug 1 — `.challenge-active` not added → Check button is permanently hidden by CSS.**

The CSS at lines 1522–1531 controls visibility:

```css
/* Always hidden: */
#repeat-screen .repeat-actions { display: none !important; }
#repeat-screen .repeat-recall  { display: none !important; }

/* Shown only when challenge is active: */
#repeat-screen .repeat-card.challenge-active .repeat-actions { display: flex !important; }
#repeat-screen .repeat-card.challenge-active .repeat-recall  { display: block !important; }
```

The Check button (`#repeat-submit-btn`) lives inside `.repeat-actions`. It is **only visible when `.repeat-card` has the class `challenge-active`**.

`.challenge-active` is added in exactly ONE place (line 6704):
```javascript
// Inside topic-card click handler on the home screen:
repeatCard.classList.add('challenge-active');
startRepeatChallenge();
```

It is **never added** by:
- The bottom nav `repeat-screen` handler → calls only `showScreen(repeatScreen)`
- `openRepeatButton` click handler (line 3452) → calls only `startRepeatChallenge()`, NOT `.add('challenge-active')`
- `startRepeatChallenge()` itself → never adds the class

**Result:** Unless the user navigates to Repeat by clicking a topic card on the home screen, the Check button is invisible. The input area is hidden. Nothing responds.

**Bug 2 — Bottom nav does not call `startRepeatChallenge()` at all.**

The nav handler (line 6648) for `repeat-screen` has no special case:
```javascript
// Current nav handler:
if (targetId === 'understand-screen') startNewUnderstandLesson();
if (targetId === 'speak-screen') startNewSpeakSession(null);
// ← no case for 'repeat-screen'
```

So `currentRepeatPhrase` is `''`, `repeatChallengeType` is `'sentence_builder'` (its default), and `isRecallLike` in the Check handler is `false` — meaning even if the button were visible, clicking it would silently do nothing (the condition `if (isRecallLike && !repeatComplete)` fails).

**Combined effect:**
1. Navigate to Repeat via bottom nav
2. `challenge-active` not set → Check button invisible
3. `startRepeatChallenge()` not called → no phrase loaded, `isRecallLike` false
4. Press Enter → listener fires but `isRecallLike` is false → `checkRepeatAnswer()` never called
5. User sees static screen with no interactive feedback

---

### B.5 — Smallest safe fix

Add two lines to the nav handler for `repeat-screen`, mirroring the pattern already used for `speak-screen` and `understand-screen`:

**Before (inside the nav handler `else` block):**
```javascript
if (targetId === 'understand-screen') startNewUnderstandLesson();
if (targetId === 'speak-screen') startNewSpeakSession(null);
```

**After:**
```javascript
if (targetId === 'understand-screen') startNewUnderstandLesson();
if (targetId === 'speak-screen') startNewSpeakSession(null);
if (targetId === 'repeat-screen') {
  var rc = document.querySelector('#repeat-screen .repeat-card');
  if (rc) rc.classList.add('challenge-active');
  startRepeatChallenge();
}
```

This:
1. Adds `challenge-active` so the Check button, input, and feedback area become visible
2. Calls `startRepeatChallenge()` so a phrase is loaded and `repeatChallengeType` is set correctly
3. Makes Enter and Check functional immediately on nav

**Risk: Minimal.** `startRepeatChallenge()` and `.add('challenge-active')` are already used together in the topic-card path. No logic changes to the repeat checker itself.

---

## Summary

| Issue | Root cause | Affected line(s) | Fix effort |
|---|---|---|---|
| A — Understand robotic voice | `undSpeak` uses `undLunaVoice` (different fallback chain) instead of `lunaVoice` | Line 4519 | One word: `undLunaVoice` → `lunaVoice` |
| B — Repeat Check broken | Nav handler never adds `.challenge-active` or calls `startRepeatChallenge()` | Nav handler ~line 6661 | 3 lines added |
