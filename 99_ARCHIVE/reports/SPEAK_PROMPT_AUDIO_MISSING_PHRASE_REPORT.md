# Speak Prompt Audio Missing Phrase Report

**Date:** 2026-04-26
**Scope:** Why Speak screen shows the target phrase visually but Luna voice only says "Your turn."
**Files:** `index.html` only
**Status:** Audit only — no files modified.

---

## Summary

Two completely separate systems produce the visual phrase display and the spoken prompt. They are driven by different code paths. The visual display always shows the phrase; the spoken cue does not at `ready_more` stage because `buildStageCue()` intentionally discards the phrase for that stage and returns only `'Your turn.'`.

---

## 1. Where the visible phrase text is set

`showPhraseContext(phrase)` — line 4113:

```javascript
function showPhraseContext(phrase) {
  const data = speakPhraseData[phrase];
  const meaning = data ? data.meaning : '';
  const stage = getLearnerState() || 'starting';
  const showSpanish = stage === 'starting' || stage === 'building';
  phraseEnEl.textContent = phrase;          // ← sets #phrase-en to "I feel good"
  phraseEsEl.textContent = meaning;
  phraseContext.classList.add('visible');   // ← shows the phrase-context panel
  hideBeginnerHelp();
}
```

`#phrase-context` is a separate panel above the chat (lines 1792–1795). It is populated directly with the raw phrase string, bypassing `buildStageCue()` and `addAIMessage()` entirely.

`showPhraseContext()` is called in:
- `startNewSpeakSession()` — line 4260
- `startNextPhrase()` — line 4231
- Scenario turns — line 4350

**Result:** The visual phrase panel always shows "I feel good" regardless of learner stage.

---

## 2. Where the spoken prompt text is built

The spoken cue is built by `buildStageCue(step, stage, phraseTarget)` — line 4085:

```javascript
function buildStageCue(step, stage, phraseTarget) {
  const target = step.target || phraseTarget || '';
  const anticipatory = getAnticipatoryNote(step, phraseTarget);

  if (stage === 'settling') {
    return { cue: '"' + target + '."', coach: anticipatory || '', meaning: '' };
  }
  if (stage === 'ready_more') {
    return { cue: 'Your turn.', coach: anticipatory || '', meaning: '' };   // ← HERE
  }
  if (stage === 'building') {
    return { cue: step.cue, coach: anticipatory || defaultCoach, meaning: step.meaning || '' };
  }
  // starting:
  return { cue: step.cue, coach: anticipatory || step.coach || '', meaning: step.meaning || '' };
}
```

The returned `cue` string is passed directly to `addAIMessage()`:

```javascript
addAIMessage(staged.cue, staged.coach, true, staged.meaning);
```

Inside `addAIMessage()` (line 2788), `speakText(text)` is called with that same `cue` string. There is no secondary phrase-speak call. Whatever `staged.cue` contains is the only thing spoken.

---

## 3. Why the spoken prompt excludes the phrase and only says "Your turn."

`getLearnerState()` (line 3485) returns `'ready_more'` when the average phrase mastery across the phrase pool is ≥ 3.5:

```javascript
function getLearnerState() {
  const scores = pool.map(p => getPhraseMastery(p));
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg < 1.5) return 'starting';
  if (avg < 2.5) return 'building';
  if (avg < 3.5) return 'settling';
  return 'ready_more';
}
```

When `stage === 'ready_more'`, `buildStageCue` intentionally discards both `step.cue` (e.g. `'Say: "I feel good."'`) and `target` (e.g. `'I feel good'`) and returns only:

```javascript
{ cue: 'Your turn.', coach: anticipatory || '', meaning: '' }
```

The design assumption: at `ready_more` stage the learner is advanced enough to see the phrase in the visual panel and act without being told it aloud. But:
- The visual panel (`#phrase-context`) is not always visible or noticed — it is outside the conversational flow
- The user expects Luna to speak the phrase as part of every prompt, regardless of mastery level
- "Your turn." with no phrase context gives no indication of what phrase to say

---

## 4. Whether buildStageCue, addAIMessage, speakSlowPhrase, or transition timing is responsible

| Component | Role | Responsible for bug? |
|---|---|---|
| `buildStageCue` | Builds the cue text to speak | **Yes — root cause.** Returns `'Your turn.'` at `ready_more` stage, discarding the phrase |
| `addAIMessage` | Speaks whatever `staged.cue` contains | No — works correctly, speaks what it receives |
| `speakSlowPhrase` | Not called in the normal step-intro path | No — only called in struggle/replay path |
| Transition timing | Timing of `setTimeout` calls before cue fires | No — timing is fine, the wrong text just arrives on time |

`setYourTurn()` (line 2433) is NOT the source of the "Your turn." voice. It only sets CSS classes and status text — it does not call `speakText()` or `addAIMessage()`. The spoken "Your turn." comes from `addAIMessage('Your turn.', ...)` which is the `staged.cue` from `buildStageCue`.

---

## 5. Whether this happens only at the first step or all Speak steps

**All steps, any time the learner's stage is `ready_more`.**

`buildStageCue` is called from three places, all of which pass the return value directly to `addAIMessage`:

| Caller | Line | Context |
|---|---|---|
| `startNewSpeakSession()` | 4275, 4280 | Session start — first step cue |
| `queueNextSpeakStep()` | 4161 | Between-step transitions |
| `startNextPhrase()` | 4234, 4241 | After completing a phrase, moving to next |

Every one of these hits `buildStageCue` with the same `stage` value from `getLearnerState()`. If that returns `'ready_more'`, every step cue across the entire session becomes `'Your turn.'` — including step 3 ("She feels good") and all variation steps.

---

## 6. Safest fix so Luna speaks both the instruction and target phrase

### Root cause

`buildStageCue` at `ready_more` stage returns `'Your turn.'` with no phrase. Change this one branch.

### Fix option 1 — Include phrase in cue (recommended)

Replace the `ready_more` branch in `buildStageCue` (line 4092–4093):

**Before:**
```javascript
if (stage === 'ready_more') {
  return { cue: 'Your turn.', coach: anticipatory || '', meaning: '' };
}
```

**After:**
```javascript
if (stage === 'ready_more') {
  const cueTxt = target ? '\u201c' + target + '.\u201d Your turn.' : 'Your turn.';
  return { cue: cueTxt, coach: anticipatory || '', meaning: '' };
}
```

**Result:** Luna says `'"I feel good." Your turn.'` instead of `'Your turn.'` The phrase is spoken first, then the call to action. Matches the `settling` stage pattern but adds "Your turn." so it still feels appropriately brief for an advanced learner.

**Risk: Minimal.** One branch in one function. No other logic changes. `target` is already computed at line 4086 — it is `step.target || phraseTarget || ''`. The fallback to `'Your turn.'` when `target` is empty is safe.

---

### Fix option 2 — Keep text as-is, add a `speakSlowPhrase` call after the cue

After `addAIMessage(staged.cue, ...)` fires, schedule a `speakSlowPhrase(speakTargetPhrase)` call with a short delay so the phrase is spoken separately from the "Your turn." message.

**Risk: Medium.** Requires identifying every call site that fires `addAIMessage(staged.cue)` at `ready_more` stage and adding the extra `speakSlowPhrase` call in each. More invasive and harder to maintain.

---

### Recommended fix

**Fix option 1, one line in `buildStageCue`.** It mirrors the `settling` stage pattern (`'"' + target + '."'`) and adds `'Your turn.'` as the call to action. Keeps the UX brief for advanced learners while ensuring Luna always speaks the phrase.

---

## Summary table

| Question | Answer |
|---|---|
| Where is the visible phrase set? | `showPhraseContext()` → `phraseEnEl.textContent = phrase` (line 4119) — bypasses `buildStageCue` entirely |
| Where is the spoken prompt built? | `buildStageCue(step, stage, phraseTarget)` → `staged.cue` → `addAIMessage(staged.cue)` → `speakText(staged.cue)` |
| Why only "Your turn."? | `stage === 'ready_more'` branch in `buildStageCue` returns `{ cue: 'Your turn.' }`, discarding both `step.cue` and `target` |
| Which component is responsible? | `buildStageCue` — root cause. `addAIMessage` and `speakSlowPhrase` are innocent |
| Which steps are affected? | All steps at all call sites when `getLearnerState()` returns `'ready_more'` |
| Safest fix? | Change `ready_more` branch cue to `'"' + target + '." Your turn.'` — one line, one function |
