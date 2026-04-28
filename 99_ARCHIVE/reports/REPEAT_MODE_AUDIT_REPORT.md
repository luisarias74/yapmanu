# Repeat Mode Audit Report

**Date:** 2026-04-26
**Scope:** All Repeat Mode issues: no intro, Check broken after Next, second box unclear
**Files:** `index.html` only
**Status:** Audit only — no files modified.

---

## 1. Repeat Screen HTML Structure

```
#repeat-screen
  section.app-card
    header.top-bar          ← hidden by CSS (#repeat-screen .top-bar { display:none })
    section.session-context ← hidden by CSS
    section.luna-stage
      #repeat-luna-orb      ← Luna orb (idle/listening/speaking)
      #repeat-luna-subtitle ← "Let's rebuild one short phrase."

    section.repeat-card                  ← KEY: needs .challenge-active to show any content
      #schema-topics                     ← visual topic grid (hidden when challenge-active)
      #repeat-topics                     ← JS-rendered topic filter buttons
      #repeat-prompt                     ← Instruction text box 1
      #repeat-cue                        ← Hint/meaning text box 2
      #repeat-recall.hidden              ← Text input + Check button (recall modes)
        #repeat-recall-input
        #repeat-submit-btn (Check)
      #answer-assembly                   ← Chip slots: built sentence display
      #chip-bank                         ← Scrambled word chips
      #repeat-feedback                   ← Feedback text
      div.repeat-actions
        #repeat-reset-btn                ← "Try again" / "Next challenge"
```

**What each box is for:**

| Element | Intended purpose |
|---|---|
| `#repeat-prompt` | Main instruction to the user — changes by challenge type |
| `#repeat-cue` | Hint context — Spanish meaning, or fill-in-blank cue with underscores |
| `#repeat-recall` | Text input + Check button — shown only for `quick_recall` / `guided_fill` |
| `#answer-assembly` | Displays chips the user has placed so far — `sentence_builder` only |
| `#chip-bank` | Scrambled word chips to tap — `sentence_builder` only |
| `#repeat-feedback` | Post-attempt feedback from Luna's response pools |

---

## 2. repeatChallengeConfig

```javascript
const repeatChallengeConfig = {
  sentence_builder: {
    prompt: 'Tap the words to build the sentence.',
    feedbackHint: 'Build the sentence one word at a time.'
  },
  quick_recall: {
    prompt: 'Type the phrase from memory.',
    feedbackHint: 'Type the phrase from memory, softly and simply.'
  },
  guided_fill: {
    prompt: 'Complete the phrase.',
    feedbackHint: 'Type the full phrase to complete it.'
  }
};
```

Three types. `getRepeatChallengeType(phrase)` selects based on the phrase's hit/miss record:
- `hits === 0` or `misses > hits` → 60% `sentence_builder`, 40% `guided_fill`
- `hits >= 2` → 50% `quick_recall`, 25% `guided_fill`, 25% `sentence_builder`
- Otherwise → 34% `sentence_builder`, 33% `quick_recall`, 33% `guided_fill`

The 5-phrase pool: `I am tired`, `I am hungry`, `I am ready`, `I feel good`, `I need help`. All start with `hits = 0`.

---

## 3. startRepeatChallenge() flow

```javascript
function startRepeatChallenge(phrase) {
  // 1. Cancel any reset timer
  // 2. Pick phrase from pool (weighted by ALM, filtered by topic)
  currentRepeatPhrase = currentRepeatLesson.phrase;
  repeatWords = /* shuffled words */;
  repeatSelection = [];
  repeatComplete = false;
  repeatChallengeType = getRepeatChallengeType(currentRepeatPhrase);
  repeatRecallInput.value = '';
  repeatCue.textContent = /* Spanish meaning or fill-in cue */;
  repeatResetBtn.textContent = 'Try again';
  repeatPrompt.textContent = repeatChallengeConfig[repeatChallengeType].prompt;
  setRepeatLunaState('listening', pickRepeatResponse('intro'));  // ← visual only
  setRepeatFeedback(repeatChallengeConfig[repeatChallengeType].feedbackHint);
  renderRepeatTopics();
  renderRepeatChallengeUI();
}
```

No `addAIMessage()` call. No `speakText()` call. No TTS at all. The only "intro" is `setRepeatLunaState('listening', subtitle)` which updates the Luna orb's visual state and the `#repeat-luna-subtitle` text element silently.

---

## 4. renderRepeatChallengeUI() — the broken show/hide system

```javascript
function renderRepeatChallengeUI() {
  const isSentenceBuilder = repeatChallengeType === 'sentence_builder';
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';

  answerAssembly.classList.toggle('hidden', !isSentenceBuilder);
  chipBank.classList.toggle('hidden', !isSentenceBuilder);
  repeatRecall.classList.toggle('hidden', !isRecallLike);

  if (isSentenceBuilder) {
    renderRepeatAnswer();
    renderChipBank();
    return;
  }
  // For recall types: clear chip area, focus text input
  ...
}
```

**This logic is completely overridden by CSS when `challenge-active` is present.**

The CSS hierarchy:

| Rule | Specificity | Effect |
|---|---|---|
| `#repeat-screen .chip-bank { display:none !important }` | (1,1,0) | Hidden by default |
| `#repeat-screen .repeat-card.challenge-active .chip-bank { display:flex !important }` | (1,3,0) | Visible when challenge-active |
| `.hidden { display:none !important }` | (0,1,0) | Lowest priority |

When `.challenge-active` is on `.repeat-card`, the `(1,3,0)` rule **beats** `.hidden` `(0,1,0)` in specificity, even though both have `!important`. **The `hidden` class has no effect on any of these elements when `challenge-active` is set.**

**Result:** With `challenge-active` present (always added by the nav handler):

| Element | Expected (sentence_builder) | Actual |
|---|---|---|
| `#chip-bank` | visible | visible ✓ |
| `#answer-assembly` | visible | visible ✓ |
| `#repeat-recall` (input + Check) | hidden | **always visible** ✗ |

| Element | Expected (quick_recall) | Actual |
|---|---|---|
| `#repeat-recall` (input + Check) | visible | visible ✓ |
| `#chip-bank` | hidden | **always visible** ✗ |
| `#answer-assembly` | hidden | **always visible** ✗ |

**All challenge elements are always visible regardless of challenge type.** The show/hide logic in `renderRepeatChallengeUI()` is silently ignored by CSS specificity.

---

## 5. checkRepeatAnswer() — why Check fails after Next

```javascript
function checkRepeatAnswer() {
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';
  const built = isRecallLike ? repeatRecallInput.value.trim() : getRepeatBuiltSentence();
  const correct = normalizeRepeatText(built) === normalizeRepeatText(currentRepeatPhrase);
  // ... success or retry feedback ...
}
```

The function handles both types. `built` is taken from the text input (recall) or from the chip selection (sentence_builder). The logic is correct.

**The Check button handler:**

```javascript
repeatSubmitBtn.addEventListener('click', () => {
  const isRecallLike = repeatChallengeType === 'quick_recall' || repeatChallengeType === 'guided_fill';
  if (isRecallLike && !repeatComplete) {
    checkRepeatAnswer();
  }
});
```

**Bug:** The Check button is gated by `isRecallLike`. If `repeatChallengeType === 'sentence_builder'`, clicking Check does nothing — the condition is always false.

Because of the CSS specificity issue above, the Check button (`#repeat-submit-btn` inside `#repeat-recall`) is **always visible** when `challenge-active` is set — even for `sentence_builder`. The user sees the Check button, clicks it, and nothing happens.

**Root cause of "Check does not proceed after Next":**

1. User completes "I feel good" (whatever type was assigned)
2. User clicks "Next challenge" → `startRepeatChallenge()` → new phrase assigned
3. `getRepeatChallengeType(newPhrase)` — since newPhrase has `hits=0`, returns `sentence_builder` (60% chance) or `guided_fill` (40%)
4. If `sentence_builder`: `renderRepeatChallengeUI()` tries to hide `repeatRecall` (with `hidden` class) but CSS overrides it — Check button stays visible
5. User types in the text input and clicks Check → `isRecallLike = false` → nothing happens
6. The automatic sentence_builder check (when all chips are placed) also doesn't fire because the user typed instead of tapping chips

---

## 6. Next/Reset handlers

```javascript
repeatResetBtn.addEventListener('click', () => {
  if (repeatComplete) {
    startRepeatChallenge();   // "Next challenge" path — picks new phrase
    return;
  }
  resetRepeatChallenge();     // "Try again" path — resets same phrase
});
```

`resetRepeatChallenge()` resets `repeatSelection`, clears input, re-renders. It does NOT change `currentRepeatPhrase` or `repeatChallengeType`. This path works correctly.

The "Next challenge" path calls `startRepeatChallenge()` with no argument — picks a new phrase. This works for loading, but inherits the Check-broken issue on the new challenge.

---

## 7. Issue 1 — No Luna introduction when entering Repeat

**Root cause:** `startRepeatChallenge()` contains no `addAIMessage()` or `speakText()`. The only audio/voice wiring was `window.setTimeout(() => speakText(currentRepeatPhrase), 400)` which was removed in the previous fix session (correctly — it auto-spoke the answer phrase, not an intro).

Luna's subtitle (`#repeat-luna-subtitle`) updates to a random intro phrase from `repeatResponsePools.intro`, but this is a silent text change only. The user sees Luna's orb change state, but hears nothing.

**Missing intro elements:**
1. No spoken greeting from Luna ("Let's rebuild one short phrase.")
2. No chat-style message in the UI (there is no message list in Repeat — unlike Speak)
3. No TTS for the phrase being practiced

**Safest intro fix:** At the end of `startRepeatChallenge()`, call `speakText(pickRepeatResponse('intro'))` to speak the intro message (e.g., "Let's rebuild one short phrase.") — not the phrase itself. This gives a human-sounding entry without revealing the answer.

---

## 8. Issue 2 — Check broken after Next (summary)

**Two bugs interact:**

| Bug | Location | Effect |
|---|---|---|
| CSS specificity: `challenge-active` overrides `hidden` | Lines 1519–1531 | All elements always visible; user sees Check button for sentence_builder |
| Check handler gated by `isRecallLike` | Line 3481 | Check does nothing for sentence_builder |

**Safest fix:**

Option A (minimal — one line): Remove the `isRecallLike` guard from the Check button handler. `checkRepeatAnswer()` already reads the right value for each type. This makes Check always work:
```javascript
// Before:
if (isRecallLike && !repeatComplete) { checkRepeatAnswer(); }
// After:
if (!repeatComplete) { checkRepeatAnswer(); }
```

Option B (complete): Fix the CSS specificity issue so `hidden` class actually hides elements inside `challenge-active`. Replace the `challenge-active` CSS overrides with JS-driven `display` style toggles in `renderRepeatChallengeUI()`.

**Option A is the smallest safe fix.** It allows Check to work for all challenge types without touching CSS.

---

## 9. Issue 3 — Second display box unclear (summary)

Two text boxes are always visible:
- **Box 1 (`#repeat-prompt`):** `"Tap the words to build the sentence."` / `"Type the phrase from memory."` / `"Complete the phrase."` — the task instruction
- **Box 2 (`#repeat-cue`):** `"Meaning: Me siento bien."` / `"Fill in: I f___l good."` — the hint

Neither box is labeled. They look identical visually. The user cannot tell which is the instruction and which is the cue/hint.

Additionally, because of the CSS specificity bug, three more interactive zones are always visible simultaneously (`#answer-assembly`, `#chip-bank`, `#repeat-recall`), regardless of challenge type. For `sentence_builder` the user also sees a text input that does nothing (Check button blocked for that type). For `quick_recall` the user sees a chip bank they never need to use.

**Root cause:** No visual distinction between prompt/cue boxes, combined with all UI zones being simultaneously visible due to CSS override.

---

## Summary of all issues

| # | Issue | Root cause | Smallest safe fix |
|---|---|---|---|
| 1 | No Luna intro on entry | No `speakText()` in `startRepeatChallenge()` | Add `speakText(pickRepeatResponse('intro'))` at end of `startRepeatChallenge()` |
| 2a | Check does nothing (sentence_builder) | `isRecallLike` guard in Check handler blocks execution | Remove `isRecallLike` guard: `if (!repeatComplete) checkRepeatAnswer()` |
| 2b | Both input + chips always visible | `challenge-active` CSS (1,3,0) overrides `.hidden` (0,1,0) | Remove `isRecallLike` guard (workaround); or fix CSS specificity |
| 3 | Second box unclear | No label, no visual distinction between prompt and cue | Add a visible label or style distinction between `#repeat-prompt` and `#repeat-cue` |
