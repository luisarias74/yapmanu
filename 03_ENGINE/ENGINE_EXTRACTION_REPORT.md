# ENGINE_EXTRACTION_REPORT

## Scope

This pass creates standalone engine modules without modifying:

- `/Users/luisarias/Documents/New project/LaLanguish/index.html`
- `/Users/luisarias/Documents/New project/LaLanguish/index.final.html`
- `/Users/luisarias/Documents/New project/LaLanguish/10_REFERENCE_OLD_APP/index.final.html`
- Any backup file

The new modules convert logic into pure or semi-pure functions that return structured objects, state patches, and effect descriptors instead of directly touching DOM/UI.

## Files created

- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/progress/progressEngine.js`
- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/speak/speakEngine.js`
- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/scenario/scenarioEngine.js`
- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/understand/understandEngine.js`

## Functions extracted

| Engine file | Function | Source file | Approx. line range |
|---|---|---|---|
| `progressEngine.js` | `loadMasteryMap` | `index.final.html` | 2211-2214 |
| `progressEngine.js` | `saveMasteryMap` | `index.final.html` | 2216-2218 |
| `progressEngine.js` | `getPhraseMastery` | `index.final.html` | 2223-2225 |
| `progressEngine.js` | `updatePhraseMastery` | `index.final.html` | 2228-2258 |
| `progressEngine.js` | `loadScenarioDoneMap` | `index.final.html` | 2263-2264 |
| `progressEngine.js` | `markScenarioDone` | `index.final.html` | 2266-2269 |
| `progressEngine.js` | `isScenarioDone` | `index.final.html` | 2271 |
| `progressEngine.js` | `recordRepeatOutcome` | `index.final.html` | 2276-2284 |
| `speakEngine.js` | `pickNextSpeakPhrase` | `index.final.html` | 4079-4107 |
| `speakEngine.js` | `startNextPhrase` | `index.final.html` | 4110-4157 |
| `speakEngine.js` | `startNewSpeakSession` | `index.final.html` | 4159-4197 |
| `scenarioEngine.js` | `startScenarioSession` | `index.final.html` | 4201-4232 |
| `scenarioEngine.js` | `advanceScenarioTurn` | `index.final.html` | 4235-4271 |
| `scenarioEngine.js` | `finishScenario` | `index.final.html` | 4274-4320 |
| `understandEngine.js` | `normalizeRepeatText` | `index.final.html` | 3088-3094 |
| `understandEngine.js` | `buildUnderstandKeywords` | `index.final.html` | 4366-4388 |
| `understandEngine.js` | `selectUnderstandKeyword` | `index.final.html` | 4379-4385 |
| `understandEngine.js` | `resetUnderstandPractice` | `index.final.html` | 4391-4400 |
| `understandEngine.js` | `finishUnderstandPractice` | `index.final.html` | 4402-4406 |
| `understandEngine.js` | `runUnderstandPracticeCheck` | `index.final.html` | 4408-4432 |
| `understandEngine.js` | `startNewUnderstandLesson` | `index.final.html` | 4478-4497 |
| `understandEngine.js` | `beginUnderstandPlayback` | `index.final.html` | 4522-4537 |
| `understandEngine.js` | `revealUnderstoodPhrase` | `index.final.html` | 4528-4536 |
| `understandEngine.js` | `revealUnderstandMeaning` | `index.final.html` | 4540-4548 |
| `understandEngine.js` | `moveToUnderstandReflection` | `index.final.html` | 4566-4571 |
| `understandEngine.js` | `handleUnderstandReflection` | `index.final.html` | 4499-4519 |

## Dependencies found

### `progressEngine.js`

- `localStorage` in original source
- `masteryMap` mutable module state in original source
- `getAssistLearningEntry`
- `recordAssistLearningResult`

### `speakEngine.js`

- `speakPhrasePool`
- `speakUsedPhrases`
- `speakTargetPhrase`
- `speakPracticeSequences`
- `getPhraseMastery`
- `getAssistLearningEntry`
- `getMasteryTransition`
- `getLearnerState`
- `buildStageCue`
- `getTimingProfile`
- `pick`
- `_clearAssistChainState`

### `scenarioEngine.js`

- `scenarioLibrary`
- `activeScenario`
- `scenarioMemory`
- `sessionState`
- `speakPracticeSequences`
- `getLearnerState`
- `resolveScenarioLunaText`
- `getTimingProfile`
- `buildStageCue`
- `markAssistScenarioUsed`
- `recordAssistLearningResult`
- `recordAssistContextUse`
- `getAssistPostScenarioReinforcement`

### `understandEngine.js`

- `understandLessonPool`
- `currentUnderstandLesson`
- `sessionState`
- `updatePhraseMastery`
- `understandPlayTimer`

## DOM/UI dependencies removed

The following behaviors were not copied as DOM operations. They were converted into returned state or `effects`/`ui` descriptors:

- `document.getElementById(...)`
- `classList.add(...)`
- `classList.remove(...)`
- `innerHTML = ''`
- `textContent = ...`
- `disabled = ...`
- `focus()`
- `createElement(...)`
- `appendChild(...)`
- `addEventListener(...)`
- `window.setTimeout(...)`
- `window.clearTimeout(...)`

Examples of replacements:

- Timer work now returns effect objects like `schedule_message`, `schedule_stage_cue`, `schedule_return_home`, `cancel_timer`
- UI mutations now return `ui` objects like `feedback`, `phraseText`, `listenButtonText`, `meaningHidden`
- Cross-engine work now returns effects like `update_phrase_mastery`, `record_assist_learning_result`, `mark_scenario_done`

## Functions that could not be safely extracted yet

These remain too entangled with browser/runtime behavior to move cleanly without a second integration pass:

- `setUnderstandLunaState`
  - Reason: pure logic is trivial, but the original function is only direct DOM mutation.
- `renderUnderstandKeywords`
  - Reason: original implementation creates buttons, attaches listeners, and re-renders DOM.
- `startUnderstandPracticeListening`
  - Reason: directly depends on `window.SpeechRecognition`, callback wiring, focus management, and mic lifecycle.
- The button/input event listener bodies themselves
  - Reason: they are UI controller code, not engine logic.
- `startNextPhrase`, `startNewSpeakSession`, `startScenarioSession`, `advanceScenarioTurn`, `finishScenario`
  - Partial extraction only. Their original side effects are now represented as returned effect descriptors, but they are not yet wired back into the app shell.

## Uncertainties

- `finishScenario` originally calls `markAssistScenarioUsed(responseTurn.phrase)`. Elsewhere in `index.final.html`, `markAssistScenarioUsed` appears to accept `(entryEn, scenarioId)`. I preserved the behavior pattern seen at the callsite and documented it here rather than guessing a corrected contract.
- The original `startNextPhrase` transition index uses `speakUsedPhrases.length % transitions.length` after `next` is pushed. The extracted engine preserves that sequencing, even though it may feel slightly offset at first glance.
- `handleUnderstandReflection(false)` reuses `resetUnderstandPractice()` and also toggles several UI regions. The logic is extracted, but exact UI orchestration still depends on a future adapter/controller layer.

## Recommended next step

Create a thin adapter/controller layer for each mode that:

1. Calls these engine functions with current app state and injected dependencies.
2. Interprets returned `effects` into existing UI operations and timers.
3. Verifies parity one flow at a time:
   - `Understand` first
   - `Speak` next
   - `Scenario` last

That will let the app keep the current UI while gradually moving behavior out of `index.final.html` with minimal regression risk.
