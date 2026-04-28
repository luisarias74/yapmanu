# UNDERSTAND_PARITY_REVIEW

## Scope

Compared:

- `/Users/luisarias/Documents/New project/LaLanguish/index.final.html`
- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/understand/understandEngine.js`
- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/understandController.js`
- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/UNDERSTAND_CONTROLLER_REPORT.md`

This review checks parity only. The controller is still **not wired** into the live app.

## Behaviors fully covered

- `start new lesson`
  - Original behavior from `startNewUnderstandLesson()` is represented by `startNewUnderstandLesson()` in the engine and `startUnderstandLessonController()` in the controller.
  - Covered state/UI outputs:
    - cancel prior playback timer
    - choose random lesson from the same pool
    - set phrase to `Listen first`
    - add placeholder state
    - set meaning text
    - hide meaning
    - hide meaning button
    - hide reflect actions
    - show listen actions
    - reset practice target/attempts/input
    - render keywords
    - enable listen button with text `Listen`
    - feedback `Tap Listen to hear the phrase.`
    - Luna `idle / Ready when you are.`

- `listen/play phrase`
  - Original listen button flow is represented by `beginUnderstandPlayback()` plus controller `runUnderstandEffects()` handling of `schedule_playback_complete`.
  - Covered UI outputs:
    - disable listen button
    - set button text `Playing...`
    - feedback `Hear it softly.`
    - Luna `speaking / Listen closely.`
    - reveal phrase after `1800ms`

- `reveal phrase`
  - Original timeout body after listen is represented by engine `revealUnderstoodPhrase()` and controller timer effect handling.
  - Covered UI outputs:
    - show lesson phrase
    - remove placeholder class
    - show meaning button
    - feedback `Tap Show meaning when ready, or listen again.`
    - enable listen button and restore text `Listen`
    - Luna `idle / How did that feel?`

- `reveal meaning`
  - Original meaning-button click is represented by engine `revealUnderstandMeaning()` and controller `handleUnderstandRevealController()`.
  - Covered UI outputs:
    - show meaning
    - hide meaning button
    - show practice area
    - keep listen actions visible
    - hide reflect actions
    - feedback `Now say it.`
    - Luna `idle / Now say it.`
    - focus input

- `keyword selection`
  - Original keyword click behavior is represented by engine `selectUnderstandKeyword()` and controller `renderKeywordButtons()`.
  - Covered UI outputs:
    - set `practiceTarget` to clicked word
    - reset practice attempts to `0`
    - update copy to `Now say it. Or repeat: "<word>".`
    - update input placeholder to `Say or type "<word>"...`
    - re-render active keyword state
    - focus input

- `practice check`
  - Original `runUnderstandPracticeCheck()` is represented by engine `runUnderstandPracticeCheck()` and controller `handleUnderstandCheckController()`.
  - Covered outcomes:
    - ignore empty normalized input
    - exact/contains match => `Good.`, Luna `speaking / Good.`, next button shown
    - first weak attempt => `Say it clearly.`, Luna `idle / Say it clearly.`
    - second weak attempt => `Good. Keep it in mind.`, Luna `idle / Good. Keep it in mind.`, next button shown

- `next button flow`
  - Original next-button click is represented by engine `moveToUnderstandReflection()` and controller `handleUnderstandNextController()`.
  - Covered UI outputs:
    - hide next actions
    - hide listen actions
    - show reflect actions
    - feedback `Did that feel familiar?`
    - Luna `idle / Take your time.`

- `yes reflection`
  - Original `handleReflection(true)` is represented by engine `handleUnderstandReflection({ understood: true })` and controller `handleUnderstandReflectionController(true)`.
  - Covered outcomes:
    - feedback `Nice. You recognized it clearly.`
    - Luna `speaking / Good. That phrase is settling in.`
    - update `sessionState.lastMode = 'understand'`
    - update `sessionState.lastResult = 'success'`
    - update `sessionState.lastPhrase = current lesson phrase`
    - schedule `returnToHome()` after `1800ms`
    - emit `update_phrase_mastery(..., 'understand_success')`

- `not yet reflection`
  - Original `handleReflection(false)` is represented by engine `handleUnderstandReflection({ understood: false })` and controller `handleUnderstandReflectionController(false)`.
  - Covered outcomes:
    - feedback `That's okay. Take another listen.`
    - Luna `idle / No rush. Hear it one more time.`
    - hide reflect actions
    - hide meaning
    - reset practice target/input/attempts
    - re-render keywords
    - show listen actions
    - hide meaning button
    - enable listen button and set text `Listen again`

- `progress/mastery effect`
  - Original `updatePhraseMastery(understoodPhrase, 'understand_success')` is preserved as an injected dependency interpreted from `update_phrase_mastery`.

- `UI feedback text`
  - All feedback strings used by the original Understand flow are represented in the engine/controller pair.

- `Luna state descriptors`
  - All original Understand-mode state/subtitle pairs are represented:
    - `idle / Ready when you are.`
    - `speaking / Listen closely.`
    - `idle / How did that feel?`
    - `idle / Now say it.`
    - `speaking / Good.`
    - `idle / Say it clearly.`
    - `idle / Good. Keep it in mind.`
    - `idle / Take your time.`
    - `speaking / Good. That phrase is settling in.`
    - `idle / No rush. Hear it one more time.`
    - `idle / Try it one more time.`

## Behaviors partially covered

- `mic transcript handling`
  - Covered:
    - transcript can be handed into `handleUnderstandMicTranscriptController(transcript)`
    - transcript is copied into the input
    - transcript then flows through the same practice-check logic
    - empty transcript returns Luna `idle / Try it one more time.` and feedback `Say it clearly.`
    - recognition-active flag is now reset when transcript handling completes
  - Partial gap:
    - the controller does **not** own browser `SpeechRecognition` setup, `onresult`, `onerror`, or `onend`
    - transcript de-duplication via `collapseDuplicatedTranscript(...)` is still outside this adapter

- `mic request/start flow`
  - Covered:
    - `requestUnderstandMicController()` now mirrors the original pre-listen transition when mic is delegated:
      - Luna `listening / Now say it.`
      - feedback `Listening...`
      - duplicate-start guard via `understandRecognitionActive`
    - unsupported/deferred fallback keeps:
      - Luna `idle / Try it one more time.`
      - feedback `Type it if your browser does not support the mic.`
      - input focus
  - Partial gap:
    - actual recognition lifecycle remains delegated to legacy code
    - original `onerror` path feedback `Type it if the mic missed you.` is not modeled as a dedicated controller helper yet

## Behaviors not covered

- direct browser mic lifecycle parity
  - No in-controller equivalent yet for original `startUnderstandPracticeListening()`
  - Missing native handling for:
    - `SpeechRecognition` creation
    - `rec.onerror`
    - `rec.onend`
    - `rec.onresult`
    - transcript collapse via `collapseDuplicatedTranscript(...)`

- event binding parity
  - The controller provides callable handlers, but it does not bind them to the live DOM yet.
  - This is intentional for this pass.

- home-button wiring
  - `returnToHome()` is injectable and used for the scheduled success path, but the controller does not yet bind `#understand-home-btn` or `progressHomeBtn`.
  - This is intentional for this pass.

## Risks before wiring

- Highest risk: mic behavior is still split across adapter and legacy browser logic.
  - Wiring the controller without a clear handoff for `SpeechRecognition` would create duplicate or missing mic state transitions.

- Moderate risk: the engine/controller pair depends on injected legacy functions.
  - `updatePhraseMastery`
  - `returnToHome`
  - shared `sessionState`
  - If any of these are omitted or shaped differently at integration time, parity will break silently.

- Moderate risk: keyword selection still depends on compatibility DOM button creation inside the controller.
  - That is okay for a thin adapter, but it is still imperative glue rather than fully abstracted interface logic.

- Lower risk: transcript normalization is not identical end-to-end unless the integration layer still uses the original transcript cleanup before calling `handleUnderstandMicTranscriptController()`.

## Exact functions that need adjustment before live integration

- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/understandController.js`
  - `requestUnderstandMicController()`
    - Needs a formal integration contract for browser mic start/error/end callbacks.
  - `handleUnderstandMicTranscriptController()`
    - Needs the final integration decision for transcript pre-processing and explicit mic-error handling.
  - `initUnderstandController()`
    - Will need a real integration pass to bind current app dependencies and, later, event listeners.

- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/understand/understandEngine.js`
  - No blocking parity bug found for the currently extracted Understand logic.
  - Future enhancement only: mic-specific fallback/error effects could be modeled more explicitly if the team wants the full speech lifecycle in-engine.

## Recommendation

**Not safe yet** for live wiring.

Reason:

- The non-mic Understand flow is close to parity and mostly ready.
- The mic path is still only partially bridged, with important lifecycle behavior still delegated outside the controller.
- The adapter has not yet been smoke-tested against the real DOM/dependency bundle.

## Safe next step

Before live wiring:

1. Add a tiny non-invasive harness that initializes `understandController` against the existing Understand DOM.
2. Inject the real `updatePhraseMastery`, `returnToHome`, `sessionState`, and legacy mic starter.
3. Verify manually:
   - lesson start
   - listen/reveal
   - meaning reveal
   - keyword click
   - text practice success/failure
   - next flow
   - yes/no reflection
   - mic start
   - mic empty transcript
   - mic successful transcript
4. Only then replace the existing Understand event handlers with controller calls.
