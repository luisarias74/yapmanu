# LaLánguish Mic System Audit Report

**Date:** 2026-04-26  
**Files audited:** `index.html`, `understand-v1-FINAL.html`, `index.GOLDEN-stable-with-baby-luna.html`  
**Status:** Audit only — no files modified.

---

## TL;DR

The root cause is **protocol**: index.html is opened via `file://`, and Chrome blocks `SpeechRecognition` on `file://`. The sandbox works because it runs on `localhost`. All other issues below are real but secondary to this.

---

## Finding 1 — Root cause: `file://` protocol blocks SpeechRecognition

**Severity: Critical**

`SpeechRecognition` requires a **secure context**: HTTPS or `localhost`. Chrome and Safari both refuse to start mic sessions on `file://`.

- Sandbox (`understand-v1-FINAL.html`) works → served via `localhost`
- `index.html` fails → opened directly from disk as `file://`

When `rec.start()` is called on `file://`, the browser either:
- Fires `onerror` with `event.error === 'not-allowed'`, or
- Throws a `DOMException: Not authorized by user`

Neither case is surfaced to the user in Speak mode (see Finding 2).

**Fix:** Serve the app via a local server. Any of these work:

```bash
npx http-server "/Users/luisarias/Documents/New project/LaLanguish" -p 8080
# or
python3 -m http.server 8080 --directory "/Users/luisarias/Documents/New project/LaLanguish"
```

Then open `http://localhost:8080/index.html` instead of the file directly.

---

## Finding 2 — Speak mode swallows `not-allowed` silently

**Severity: High**

`startMicListening()` (index.html ~line 3396):

```javascript
rec.onerror = (event) => {
  if (event.error === 'no-speech' || event.error === 'aborted') return;
  finishSession(false);  // withFallback=false → shows NOTHING to the user
};
```

`finishSession(false)` resets mic state and Luna UI but shows no message. When the browser fires `not-allowed` (the most common real-world error, on `file://` or after a denied permission prompt), the user sees the mic button go inert with zero explanation.

Compare with the Understand mic (`undStartMic`, index.html ~line 4453):

```javascript
undRecognition.onerror = (e) => {
  undStopMic(); undSetOrb('idle');
  undSetFeedback(
    e.error === 'not-allowed' ? 'Microphone access denied. Type the phrase instead.' :
    e.error === 'no-speech'   ? 'No speech detected. Try again or type it.' :
                                'Mic unavailable. Type the phrase instead.'
  );
};
```

Understand handles all error codes and shows a visible message. Speak does not.

**Fix:** Add `not-allowed` case to Speak's `rec.onerror`.

---

## Finding 3 — `rec.start()` not wrapped in try/catch in Speak mode

**Severity: Medium**

On `file://`, Chrome can throw synchronously from `rec.start()` before `onerror` fires:

```
DOMException: Failed to execute 'start' on 'SpeechRecognition': Not authorized by user
```

In `startMicListening()` (index.html line 3401), `rec.start()` is bare with no try/catch. If it throws, `micSessionActive` stays `true`, locking out all future mic clicks.

In `undStartMic()` (index.html line 4462), same issue — `undRecognition.start()` is also unwrapped.

**Fix:** Wrap both `rec.start()` calls:
```javascript
try { rec.start(); } catch (err) {
  // handle permission error gracefully
}
```

---

## Finding 4 — TTS not cancelled before mic starts (Speak mode)

**Severity: Medium**

`startMicListening()` does not call `speechSynthesis.cancel()` or stop ElevenLabs audio before opening the mic. If Luna is still speaking when the user taps the mic button:
- The mic will capture Luna's synthesized voice as the user's input
- `sendUserMessage()` will fire with Luna's own speech as the "user" message

The mic button click path:
```javascript
micButton.addEventListener('click', () => {
  clearYourTurnUI();      // only removes CSS classes
  startMicListening();    // no TTS cancel before this
});
```

The Understand mic (`undStartMic`) has the same gap — no `speechSynthesis.cancel()` before `undRecognition.start()`.

**Fix:** Call `window.speechSynthesis.cancel()` (and `flushAudio()` for ElevenLabs) at the top of both mic-start functions before `rec.start()`.

---

## Finding 5 — `speakWithBrowser` has no cancel-defer (Safari bug)

**Severity: Medium**

`speakWithBrowser()` (index.html ~line 2541):

```javascript
function speakWithBrowser(text, rate = 0.86) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  // ← speak() called in the same tick — Safari drops this silently
  segments.forEach(segment => {
    window.speechSynthesis.speak(utterance);
  });
}
```

Safari requires a minimum ~50–100ms gap between `cancel()` and `speak()`. Without it, `speak()` silently no-ops on Safari — the user hears nothing.

The Understand mode `undSpeak()` correctly uses `setTimeout(..., 60)` between cancel and speak. The Speak mode `speakWithBrowser` does not.

**Fix (1 line):** Wrap the `segments.forEach(...)` block in `setTimeout(() => { ... }, 60)`.

---

## Finding 6 — Two completely separate mic implementations with different patterns

**Severity: Low (maintainability risk)**

| | Speak mode | Understand mode |
|---|---|---|
| Function | `startMicListening()` | `undStartMic()` |
| Guard flag | `micSessionActive` (local to function) | `undMicActive` (closure variable) |
| Recognition var | `rec` (local, no cleanup path) | `undRecognition` (stored, abortable) |
| TTS cancel | No | No |
| `not-allowed` message | No — silently resets | Yes — visible feedback |
| `no-speech` message | Shows fallback after 2500ms | Shows inline feedback |
| Start wrapped in try/catch | No | No |
| Button state | `is-listening` CSS class | `listening` CSS class |

Speak's `rec` variable is local and cannot be `abort()`ed from outside the closure. If the user navigates away mid-session, recognition keeps running invisibly.

Understand's `undRecognition` is stored at closure scope, so `undStopMic()` can abort it from tab-switch, Not-yet button, or new lesson init — this is correct.

**Fix (future, not urgent):** Extract a shared `createMicSession({ onResult, onError, onEnd })` factory that handles: TTS cancel, try/catch start, abort-on-cleanup, normalized error messages.

---

## Finding 7 — GOLDEN file identical to index.html for Speak mic

The GOLDEN file's `startMicListening()` (lines 3325–3393) is byte-for-byte identical to index.html's. All the same issues exist in GOLDEN. GOLDEN is not a useful reference for mic logic.

---

## Finding 8 — No duplicate recognition variables

No variable name collision was found. `micSessionActive` (Speak), `undMicActive` (Understand), and the old `understandRecognitionActive` (removed in the recent merge) are all in separate scopes. No cross-contamination.

---

## Finding 9 — Mic buttons wired correctly in both modes

- Speak: `micButton.addEventListener('click', ...)` → `startMicListening()` ✓
- Understand: `if (UND_SR) undMicBtn.addEventListener('click', undStartMic)` ✓ (also hides button if SR unsupported)

Button attachment is not the problem.

---

## Finding 10 — Permissions: no pre-flight check, no persistent grant

Neither mode checks mic permissions before calling `rec.start()`. The browser handles the permission prompt, but:
- On `file://`, the prompt may never appear — denial is silent
- On `localhost`, the prompt appears once; after denial, `onerror` fires with `not-allowed`

No code in either mode checks `navigator.permissions.query({ name: 'microphone' })` before attempting to start. This is optional but would allow showing a pre-start warning.

---

## Summary of Issues

| # | Issue | Affects | Severity | Fix effort |
|---|-------|---------|----------|------------|
| 1 | `file://` blocks SpeechRecognition | Both modes | **Critical** | Run local server |
| 2 | `not-allowed` silently swallowed | Speak | **High** | Add error case |
| 3 | `rec.start()` not in try/catch | Both modes | Medium | Wrap in try/catch |
| 4 | TTS not cancelled before mic | Both modes | Medium | Add cancel call |
| 5 | `speakWithBrowser` no cancel-defer | Speak (Safari) | Medium | Add setTimeout 60ms |
| 6 | Two separate mic implementations | Both | Low | Shared factory (future) |
| 7 | GOLDEN identical issues | N/A | Info | Use sandbox as reference |
| 8 | No duplicate variables | — | None | — |
| 9 | Mic buttons wired correctly | — | None | — |
| 10 | No permission pre-flight | Both | Low | Optional |

---

## Recommended Fix Order

1. **Serve via localhost** — this alone will unblock SpeechRecognition for both modes
2. **Add not-allowed message to Speak onerror** — prevents silent failures after permission denial
3. **Wrap rec.start() in try/catch** — both modes, prevents `micSessionActive` lockout
4. **Add speechSynthesis.cancel() before mic start** — both modes, prevents TTS-as-input
5. **Add 60ms defer to speakWithBrowser** — Safari fix, 1-line change
