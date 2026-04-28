# UNDERSTAND_WIRING_REPORT

## Scope

This pass performed a controlled Understand-only wiring start in:

- `/Users/luisarias/Documents/New project/LaLanguish/index.html`
- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/understandBootstrap.js`

No changes were made to:

- `/Users/luisarias/Documents/New project/LaLanguish/index.final.html`
- any existing backup file

## Backup created

Created backup:

- `/Users/luisarias/Documents/New project/LaLanguish/index.before-understand-controller-wiring.html`

Backup command used:

- `cp index.html index.before-understand-controller-wiring.html`

## Script tags added

Added classic script tags to `index.html` in strict order:

1. `./03_ENGINE/understand/understandEngine.js`
2. `./06_VOICE/mic/speechRecognitionAdapter.js`
3. `./07_INTERFACES/understandController.js`
4. `./07_INTERFACES/understandBootstrap.js`

These load after `./app.js` and before the existing inline script block.

## Bootstrap behavior

Created:

- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/understandBootstrap.js`

Bootstrap behavior:

- initializes the Understand controller only
- creates and attaches the SpeechRecognition adapter
- injects existing real-page dependencies:
  - `sessionState`
  - `updatePhraseMastery`
  - `returnToHome`
  - `collapseDuplicatedTranscript`
- logs:
  - `Understand controller bootstrap loaded`
- exposes:
  - `window.LaLanguishUnderstandDebug`

## Safe non-destructive override strategy

The old Understand code was **not removed**.

Instead, the existing inline Understand functions and event handlers now perform a guarded delegation:

- if `window.LaLanguishUnderstandDebug.active` exists:
  - route to the extracted controller/bootstrap path
- otherwise:
  - fall back to the original inline Understand behavior

This keeps the old code available as a rollback path and avoids rewriting other app modes.

## Double-binding risks

Main conflict point:

- the original inline script still binds the old Understand event listeners

Mitigation used:

- those listeners now early-return into controller methods when the bootstrap is active
- the old inline bodies remain as fallback only

Residual risk:

- if another part of the page calls the old Understand helper functions directly, they now delegate when debug bootstrap is active
- this is intentional, but it means Understand behavior is now switched by the presence of the bootstrap/debug object

## How to test in browser

1. Open `/Users/luisarias/Documents/New project/LaLanguish/index.html`
2. Open DevTools console
3. Confirm the log appears:
   - `Understand controller bootstrap loaded`
4. Confirm the debug object exists:
   - `window.LaLanguishUnderstandDebug`
5. Navigate into Understand Mode
6. Verify:
   - lesson start still works
   - Listen shows phrase after delay
   - Reveal opens meaning + practice area
   - keyword buttons still work
   - Check still advances correctly
   - Mic unsupported/error/no-transcript paths still show expected messages
   - Next / Yes / Not yet still behave correctly
   - Home still returns correctly

## Rollback command

To roll back `index.html` to the pre-wiring state:

```bash
cp index.before-understand-controller-wiring.html index.html
```

## Notes

This is still an incremental wiring pass, not full cleanup.

The old Understand code is still present by design so parity can be verified before any removal/refactor step.
