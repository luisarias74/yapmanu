# Toolbar Mic Audit Report

**Date:** 2026-04-26  
**Scope:** Speak screen mic button vs Understand screen mic button  
**Files:** `index.html` only  
**Status:** Audit only — no files modified.

---

## 1. The toolbar mic element

**Element:** `<button class="mic-button" id="mic-button" type="button">🎙️</button>`  
**Location:** `index.html` line 1840, inside `<section class="input-dock">` in the **Speak screen**  
**Variable:** `const micButton = document.getElementById('mic-button')` (line 2195)

This is the large emoji mic button at the bottom of the Speak conversation interface. It is **not** on the home screen or in the bottom nav — it lives exclusively in the Speak screen's input dock.

---

## 2. The event listener attached to it

```javascript
// index.html line 3412–3415
micButton.addEventListener('click', () => {
  clearYourTurnUI();
  startMicListening();
});
```

`clearYourTurnUI()` only removes CSS classes (removes `is-ready` pulse). It does not cancel TTS or touch any recognition state.

---

## 3. What function it calls

`startMicListening()` — defined at index.html line 3334.

```javascript
function startMicListening() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { addAIMessage("..."); return; }

  if (micSessionActive) return;   // ← guard check
  micSessionActive = true;        // ← flag set HERE, synchronously, BEFORE rec.start()

  setLunaState('listening');      // ← Luna shows "listening" immediately, even if mic never starts
  chatStatus.textContent = 'Listening…';

  const rec = new SpeechRecognition();
  // ... handlers attached ...

  rec.start();                    // ← if this throws, micSessionActive stays true FOREVER
}
```

---

## 4. The working Luna mic path (Understand)

**Element:** `<button class="und-mic-btn" id="und-mic-btn">` (index.html line 2000)

**Event listener:**
```javascript
if (UND_SR) undMicBtn.addEventListener('click', undStartMic);
```

**Function `undStartMic()`** — defined at index.html line 4436:

```javascript
function undStartMic() {
  if (!UND_SR) return;
  if (undMicActive) { undStopMic(); return; }   // ← guard check

  undRecognition = new UND_SR();
  // handlers set first...
  undRecognition.onstart = () => {
    undMicActive = true;        // ← flag set INSIDE onstart callback, AFTER mic actually starts
    undMicBtn.classList.add('listening');
    undSetOrb('listening');     // ← visual feedback only fires if mic actually started
  };
  undRecognition.onerror = (e) => {
    undStopMic();               // ← resets undMicActive for ALL error types
    undSetFeedback(/* user-visible message */);
  };
  undRecognition.onend = () => { if (undMicActive) undStopMic(); };

  undRecognition.start();       // if this throws, undMicActive is still false → user can retry
}
```

---

## 5. Why Understand mic works but Speak mic does not

There are three specific code differences, each of which causes a distinct failure mode:

---

### Difference A — Flag set before vs after `rec.start()` — PERMANENT LOCKOUT

**Speak:**
```javascript
micSessionActive = true;   // line 3342 — BEFORE start()
// ...
rec.start();               // line 3401 — if this throws, flag stuck forever
```

**Understand:**
```javascript
undRecognition.onstart = () => { undMicActive = true; ... }; // INSIDE onstart callback
// ...
undRecognition.start();    // if this throws, undMicActive stays false — user can retry
```

**Effect:** If `rec.start()` ever throws (e.g. `file://` protocol, permission denied prompt, or any other synchronous DOMException), `micSessionActive` is set to `true` before the throw, and nothing ever resets it. Every subsequent click hits `if (micSessionActive) return;` and silently bails. **The mic button becomes permanently dead for the rest of the session without any error shown.**

The Understand mic doesn't have this problem: `undMicActive` is only set inside `onstart`, so a throw leaves it `false` and the user can click again.

---

### Difference B — `onerror` for `not-allowed` is swallowed in Speak

**Speak:**
```javascript
rec.onerror = (event) => {
  if (event.error === 'no-speech' || event.error === 'aborted') return; // resets nothing
  finishSession(false);   // called for not-allowed, but withFallback=false → NO user message
};
```

**Understand:**
```javascript
undRecognition.onerror = (e) => {
  undStopMic();           // always resets the flag
  undSetFeedback(
    e.error === 'not-allowed' ? 'Microphone access denied. Type the phrase instead.' :
    e.error === 'no-speech'   ? 'No speech detected. Try again or type it.' :
                                'Mic unavailable. Type the phrase instead.'
  );
};
```

**Effect:** When the browser denies the mic (permission denied, `file://` protocol, or secure-context mismatch), Speak mode calls `finishSession(false)` which resets `micSessionActive` but shows the user **no message**. Luna's orb and chat status silently snap back to idle. The user has no idea what happened and may assume the button is broken.

Understand always shows a human-readable inline message.

---

### Difference C — Visual "listening" state shown before mic actually starts

**Speak:**
```javascript
micSessionActive = true;
setLunaState('listening');   // ← called synchronously, line 3344
chatStatus.textContent = 'Listening…';
// ...
rec.start();                 // only AFTER this does the browser grant the mic
```

**Understand:**
```javascript
undRecognition.onstart = () => {
  undMicActive = true;
  undSetOrb('listening');    // ← only fires after browser confirms mic is live
};
```

**Effect:** In Speak mode, Luna's orb turns to "listening" and the status shows "Listening…" the instant the button is tapped — even if the mic never actually starts. If `rec.start()` fails, the user sees the listening animation briefly and then it snaps back, with no explanation. In Understand mode, the orb only changes when the browser confirms the mic is active.

---

## Root cause summary

| Issue | Speak mic | Understand mic |
|-------|-----------|----------------|
| Flag set before `rec.start()` | Yes — permanent lockout on throw | No — flag only set in `onstart` |
| `not-allowed` error message | None — `finishSession(false)` is silent | Yes — visible inline message |
| Visual feedback before mic grants | Yes — lying to user | No — truthful |
| `no-speech` resets flag | Via `onend` eventually | Via `undStopMic()` in `onerror` |

**Most likely sequence of events the user experienced:**
1. App opened from disk (`file://`) at any point before or during testing
2. Toolbar mic tapped → `micSessionActive = true` → `rec.start()` threw DOMException (`file://` blocks SR)
3. `micSessionActive` stuck at `true` for the session
4. Every subsequent mic tap hit `if (micSessionActive) return;` silently
5. Understand mic worked because `undMicActive` was never set (it lives in `onstart`)

---

## Smallest safe patch

Move `micSessionActive = true` into `rec.onstart`, and add a `not-allowed` message to `onerror`. Two targeted changes inside `startMicListening()`:

**Change 1 — Move flag into `onstart` (removes permanent lockout):**
```javascript
// REMOVE this line from where it is (line 3342):
micSessionActive = true;

// ADD inside the handlers block, as a new onstart:
rec.onstart = () => {
  micSessionActive = true;
  setLunaState('listening');
  chatStatus.textContent = 'Listening… speak naturally';
};
```

And remove `setLunaState('listening')` and the `chatStatus` line from their current synchronous position (lines 3344–3345), since they now live in `onstart`.

**Change 2 — Add `not-allowed` message to `onerror`:**
```javascript
rec.onerror = (event) => {
  if (event.error === 'no-speech' || event.error === 'aborted') return;
  if (event.error === 'not-allowed') {
    finishSession(false);
    addAIMessage("Microphone access denied. Type your answer instead.");
    return;
  }
  finishSession(false);
};
```

These two changes mirror the Understand mic pattern exactly. No other code is touched.
