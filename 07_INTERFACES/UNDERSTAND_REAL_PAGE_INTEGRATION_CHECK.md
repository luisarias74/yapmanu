# UNDERSTAND_REAL_PAGE_INTEGRATION_CHECK

## Scope

Compared:

- `/Users/luisarias/Documents/New project/LaLanguish/index.final.html`
- `/Users/luisarias/Documents/New project/LaLanguish/index.html`
- `/Users/luisarias/Documents/New project/LaLanguish/03_ENGINE/understand/understandEngine.js`
- `/Users/luisarias/Documents/New project/LaLanguish/07_INTERFACES/understandController.js`
- `/Users/luisarias/Documents/New project/LaLanguish/06_VOICE/mic/speechRecognitionAdapter.js`
- `/Users/luisarias/Documents/New project/LaLanguish/09_TESTS/understandController.smoke.test.js`
- `/Users/luisarias/Documents/New project/LaLanguish/09_TESTS/UNDERSTAND_SMOKE_TEST_REPORT.md`

This pass is read-only. No live wiring was performed.

## DOM ID Check

The actual real-page DOM contract in both `index.final.html` and `index.html` matches the Understand controller expectations.

### Required IDs checked

All requested IDs exist in **both** `index.final.html` and `index.html`:

- `understand-screen`
- `understand-state-label`
- `understand-luna-subtitle`
- `understand-phrase`
- `understand-meaning`
- `understand-feedback`
- `understand-listen-btn`
- `understand-meaning-btn`
- `understand-listen-actions`
- `understand-reflect-actions`
- `understand-practice`
- `understand-practice-copy`
- `understand-keywords`
- `understand-input`
- `understand-mic-btn`
- `understand-check-btn`
- `understand-next-actions`
- `understand-next-btn`
- `understand-yes-btn`
- `understand-notyet-btn`
- `understand-home-btn`

### Additional controller dependency

`understandController.js` also expects:

- `understand-luna-orb`

That ID also exists in both pages, so there is no hidden DOM mismatch there.

## DOM Compatibility Result

There is **no blocker** at the DOM-ID level for Understand-mode controller wiring.

## Script Loading Compatibility

### Current page loading style

Both `index.final.html` and `index.html` currently use:

- a classic script tag for `app.js`
- then a large inline classic `<script>` block

There is **no** current `type="module"` usage in either page.

### New extracted file style

The new files are written as UMD-style wrappers:

- Node path:
  - `module.exports`
  - `require(...)` in the controller’s Node branch
- Browser path:
  - `root.LaLanguishEngines.understandEngine`
  - `root.LaLanguishControllers.understandController`
  - `root.LaLanguishVoice.speechRecognitionAdapter`

### Browser import/export compatibility

Good news:

- No ES module `import`/`export` syntax is used in the browser branch.
- No browser bundler is required just to load the extracted files.
- A compatibility loader is **not** needed for `import`/`export` conversion.

Important constraint:

- Load order **does** matter.
- `understandController.js` expects `root.LaLanguishEngines.understandEngine` to already exist in the browser.
- The mic adapter must also be loaded before any bootstrap that wants to attach it.

## Loader Conclusion

The extracted files are compatible with classic browser script tags, but only if loaded in the correct order.

Required browser order:

1. `03_ENGINE/understand/understandEngine.js`
2. `06_VOICE/mic/speechRecognitionAdapter.js`
3. `07_INTERFACES/understandController.js`
4. a small bootstrap/wiring script

## Safest Wiring Strategy

### Option A: temporary script tag loader

Assessment: **best option**

Why:

- Matches the current classic-script page architecture
- Works with the existing UMD wrappers
- Avoids introducing `type="module"` into a page that is currently entirely classic-script
- Keeps the integration incremental and reversible
- Minimizes risk to the existing inline app logic

### Option B: inline adapter wrapper

Assessment: workable, but less safe than Option A

Why:

- Would require embedding more glue directly into the existing inline script area
- Increases coupling with the large current script block
- Makes rollback and isolation harder

### Option C: no wiring yet

Assessment: still defensible, but no longer the best next move

Why:

- The architecture, adapter contract, smoke test, and real DOM alignment are now in place
- Remaining risk is integration discipline, not missing structure

## Recommended Strategy

**Option A: temporary script tag loader**

This is the safest real-page path.

## Exact Next Action

Recommended next action:

- add classic script tags for the extracted Understand files in the correct order
- add one tiny bootstrap script that:
  - reads the real Understand DOM
  - initializes `understandController`
  - creates the speech adapter with the harness callbacks
  - binds only the Understand event handlers

## Safe To Wire Now?

**Yes, with one controlled bootstrap pass.**

More precisely:

- Safe to begin a non-invasive Understand-only wiring pass now
- Not safe to wire casually inside the existing inline script without a disciplined bootstrap plan

## Remaining Risks Before That Wiring Pass

- `collapseDuplicatedTranscript(...)` is still not extracted, so transcript cleanup parity must be handled deliberately in the bootstrap.
- The page still contains the original Understand inline logic, so any real wiring pass must avoid double-binding event listeners.
- The current inline script owns many shared globals (`sessionState`, `returnToHome`, `updatePhraseMastery`), so the bootstrap must inject the real dependencies rather than recreating them.

## Final Recommendation

There is no DOM blocker and no browser-module blocker.

The specific blocker to avoid is **double-binding / bad load order**, not missing IDs or incompatible file format.

Best next step:

1. use **Option A**
2. load the extracted files as classic script tags
3. add a tiny Understand-only bootstrap
4. keep the first live wiring pass isolated to Understand Mode only
