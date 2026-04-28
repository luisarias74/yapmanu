# Speak Prompt Logic Audit Report

**Date:** 2026-04-26  
**Scope:** Why "I feel good" appears accepted for "She feels good" and why Luna seems to echo the user's wrong answer  
**Files:** `index.html` only  
**Status:** Audit only — no files modified.

---

## 1. Where the speak target phrase is selected

`speakTargetPhrase` is the **root phrase key** for the whole session — e.g. `"I feel good"`. It is set in:
- `startNewSpeakSession()` (line 4254): `speakTargetPhrase = first;`
- `startNextPhrase()` (line 4218): `speakTargetPhrase = next;`

Each root phrase has a **sequence of steps** in `speakPracticeSequences`, each with its own `target`:

```javascript
// index.html line 3930
'I feel good': [
  { cue: 'Say: "I feel good."',    target: 'I feel good',   critical: ['i','feel','good'] },  // step 0
  { cue: 'Again — say it...',      target: 'I feel good',   critical: ['i','feel','good'] },  // step 1
  { cue: 'Now: "I feel great."',   target: 'I feel great',  critical: ['i','feel','great'] }, // step 2
  { cue: 'Try: "She feels good."', target: 'She feels good',critical: ['she','feels','good']},// step 3  ← the problem step
  { cue: 'Last one: "I feel good."',target:'I feel good',   critical: ['i','feel','good'] },  // step 4
  { cue: 'Good work...',           done: true }                                                // step 5
]
```

At step 3, the **step target** is `"She feels good"`, but the **root phrase** (`speakTargetPhrase`) is still `"I feel good"`. These are two different values. This distinction is the source of the bug.

---

## 2. Where accepted variants are checked

Variants (`acceptedVariants`) are checked **only in scenario mode** via `matchesVariant()` (line 2851). There are no accepted variants for the Speak practice sequence steps — only the `target` string and `critical` word array.

The general match check (line 2866):
```javascript
if ((input === stepTarget || matchRatio >= 0.75) && criticalOk)
```

Where:
- `matchRatio` = fraction of `stepTarget` words that appear as substrings in `input`
- `criticalOk` = all `critical` words must appear as exact tokens in `input` (word-split, not substring)

---

## 3. Why "I feel good" passes when target is "She feels good"

**It does not pass the correctness check.** The check correctly rejects it:

```
input      = "i feel good"
stepTarget = "she feels good"
targetWords = ['she', 'feels', 'good']

matchedWords = targetWords.filter(w => input.includes(w))
  'i feel good'.includes('she')   → false
  'i feel good'.includes('feels') → false  (input has 'feel', not 'feels')
  'i feel good'.includes('good')  → true
  → matchRatio = 1/3 = 0.33   (< 0.40 threshold)

criticalWordsFail = ['she', 'feels'].filter(w => !['i','feel','good'].includes(w))
  → criticalOk = false

Strong match branch: 0.33 < 0.75 → fails
High match bad critical: 0.33 < 0.75 → fails
Partial match: 0.33 < 0.40 → fails
→ Falls to weak/no-match struggle path ✓
```

**The check itself is correct. The bug is in the struggle path's response.**

When the user says "I feel good" for step 3 ("She feels good"), `speakWeakAttempts` becomes 1 and Level 1 feedback fires (line 3015–3023):

```javascript
// line 3017–3019
const msgs = [
  'The phrase is: "' + speakTargetPhrase + '." Try once more.',
  'Say: "' + speakTargetPhrase + '."'
];
addAIMessage(hPrefix + msgs[speakAttemptCount % msgs.length], '', true);

// line 3023
window.setTimeout(() => speakSlowPhrase(speakTargetPhrase), ...);
```

**`speakTargetPhrase` here is `"I feel good"` — the ROOT phrase, not the step target.**

So Luna tells the user: `'The phrase is: "I feel good." Try once more.'` and then speaks "I feel good" aloud — **which is exactly what the user just said**. It reads and sounds as if the user was correct, not wrong. The user has no idea their answer was actually rejected.

---

## 4. Where Luna prompt text is spoken

All Luna messages go through `addAIMessage()` → `speakText()`:

```
addAIMessage(text)
  └── setTimeout 950ms → speakText(text)
        └── LUNA_VOICE_PROVIDER === 'elevenlabs'
              → speakWithElevenLabs(text) → HTTP 401 (key burned) → fallback
              → speakWithBrowser(text)
```

Step cues are injected via `addAIMessage(staged.cue, staged.coach, true, staged.meaning)` either immediately or via `queueNextSpeakStep()` with a 1200–1800ms delay.

---

## 5. Where user feedback text is spoken

All feedback goes through the same `addAIMessage()` path. There is no separate feedback-speak function — feedback text (`'The phrase is: "..."'`, `'Close — try again.'`, etc.) is spoken the same way as prompts.

**This means the struggle feedback is indistinguishable in voice from a new prompt.** Both are spoken at the same rate, pitch, and voice.

---

## 6. Whether Luna is speaking the target phrase twice

Yes — in two different scenarios:

**Scenario A: Struggle replay uses root phrase instead of step target.**

When the user fails step 3 ("She feels good"):
1. Luna says: `'The phrase is: "I feel good." Try once more.'` (wrong phrase)
2. Luna speaks: "I feel good" via `speakSlowPhrase(speakTargetPhrase)` (wrong phrase)

The user just said "I feel good". Luna echoes "I feel good". Sounds like confirmation of the wrong answer.

**Scenario B: Success tone + next step cue play back-to-back.**

When the user CORRECTLY says "She feels good" and advances to step 4:
1. `addAIMessage(pickSuccessTone(), '')` → e.g. "Nice." — spoken immediately
2. `queueNextSpeakStep()` fires after 1200ms → step 4 cue

At `settling` stage, `buildStageCue` for step 4 strips the full instruction (`'Last one: "I feel good." Nice and smooth.'`) and replaces it with just `'"I feel good."'` (the target phrase alone).

The user hears:
> "Nice." *(pause)* "I feel good."

Which sounds like: Luna affirms something → then says "I feel good" as if that's correct — even though the user just said "She feels good" successfully. The transition is ambiguous and confusing.

---

## 7. Whether stage cue / transition phrase overrides actual target phrase

**Yes.** `buildStageCue()` (line 4081) transforms step cues based on the learner's stage:

```javascript
if (stage === 'settling') {
  // strips full instruction, returns only the bare target phrase
  return { cue: '"' + target + '."' , coach: '', meaning: '' };
}
if (stage === 'ready_more') {
  return { cue: 'Your turn.', coach: '', meaning: '' };
}
```

At `settling` stage:
- Step 3 full cue: `'Try: "She feels good."'` → becomes `'"She feels good."'`
- Step 4 full cue: `'Last one: "I feel good." Nice and smooth.'` → becomes `'"I feel good."'`

The instruction context is stripped. The user only sees/hears the bare phrase in quotes, with no indication of whether it's a new prompt, a transition, or an echo.

---

## 8. Safest fix analysis

### Problem A — Struggle path uses root phrase instead of step target

**Root cause:** In the weak/no-match path (line ~3012–3061), all references to the phrase use `speakTargetPhrase` (the root key: "I feel good") instead of `currentStep.target` (the step target: "She feels good").

`correctPhrase` is already computed correctly at line 2964 but only used in the high-match-bad-critical branch. It is never used in the weak/no-match branch.

**Fix:** Replace every `speakTargetPhrase` in the struggle messages and `speakSlowPhrase()` calls within that branch with `correctPhrase`. The variable is already defined and correct — just not referenced:

```javascript
// Currently (wrong):
'The phrase is: "' + speakTargetPhrase + '." Try once more.'
speakSlowPhrase(speakTargetPhrase)

// Fixed:
'The phrase is: "' + correctPhrase + '." Try once more.'
speakSlowPhrase(correctPhrase)
```

Affected lines: 3018, 3019, 3023, 3040, 3054, 3060. Each replaces `speakTargetPhrase` with `correctPhrase` (or `currentStep.target || speakTargetPhrase`).

**Risk: Minimal.** `correctPhrase` is already computed in the same function. No logic changes.

---

### Problem B — `buildStageCue` at settling stage strips instruction context

At `settling` stage, the cue becomes just the bare target phrase. This means after a correct answer, the next prompt is indistinguishable from an echo of the correct answer.

**Fix option 1 (conservative):** Keep the full `step.cue` at `settling` stage instead of stripping it to just the target phrase. The instruction "Try: 'She feels good.'" is still useful even for settling-stage learners.

**Fix option 2 (minimal):** Add a brief separator prefix to the settling-stage cue so it reads as a new instruction: `'Now: "' + target + '."'` instead of just `'"' + target + '."'`.

**Risk: Low.** Only affects how the cue is shown/spoken at settling stage. Does not affect checker logic.

---

### Problem C — Success tone and next step cue concatenated (line 2893)

When completing the last sequence step before the `done` step:
```javascript
addAIMessage((successNote || pickSuccessTone()) + ' ' + next.cue);
```

This joins an affirmation with the done-step farewell into one spoken utterance. It can sound like Luna is confirming the user's answer AND summarizing the phrase in a single breath.

**Fix option:** Split into two `addAIMessage` calls with a delay, so the affirmation lands before the next instruction, rather than being joined:
```javascript
addAIMessage(successNote || pickSuccessTone());
window.setTimeout(() => addAIMessage(next.cue), 1400);
```

**Risk: Low.** Only affects the spoken pacing of the final step transition.

---

## Summary table

| # | Issue | Root cause | Affected code | Fix effort |
|---|-------|-----------|---------------|------------|
| A | Struggle path echoes root phrase, not step target | `speakTargetPhrase` used instead of `correctPhrase` | Lines 3018, 3019, 3023, 3040, 3054, 3060 | Tiny — swap variable name |
| B | Settling stage strips cue to bare phrase | `buildStageCue` design | Line 4086 | Small — keep full cue or add prefix |
| C | Affirmation + next cue joined in one utterance | Concatenation at line 2893 | Line 2893 | Small — split into two calls |

**Fix A is the highest priority** — it's the direct cause of the reported confusion (Luna appearing to confirm the wrong answer). Fix B and C address a separate but related ambiguity in the flow.
