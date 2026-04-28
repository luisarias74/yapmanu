# Understand Voice Trace Report

**Date:** 2026-04-26
**Scope:** Why Understand still sounds robotic after `undLunaVoice → lunaVoice` fix
**Status:** Logs added — no functional code changed.

---

## Diagnostic logs added

Three console logs were added (no behavior changes):

| Log | Location | Purpose |
|---|---|---|
| `[LaLanguish Voice] Speak voice: ElevenLabs (neural) — playing` | After `currentAudio.play()` in EL success path | Confirms whether EL audio is actually used for Speak |
| `[LaLanguish Voice] Speak voice: <name> \| rate: 0.86 \| pitch: 1.03` | Top of `speakWithBrowser()` | Shows which browser voice and params are used when Speak falls back |
| `[LaLanguish Voice] Understand voice: <name> \| rate: 0.88 \| pitch: 1.02` | Inside `undSpeak()` setTimeout | Shows which voice and params Understand uses |

**To read logs:** Open DevTools → Console, then trigger each mode (Speak prompt, then Understand Listen).

---

## Static analysis findings (no runtime needed)

### 1. Is `lunaVoice` actually loaded/non-null when Understand Play fires?

**Likely yes — but not guaranteed.**

`lunaVoice` is loaded by `loadVoices()` at line 2539 (synchronous call at parse time) and on `window.speechSynthesis.onvoiceschanged`. In Chrome, `getVoices()` returns `[]` synchronously on first call — voices only arrive after the async `voiceschanged` event. So at parse time, `loadVoices()` sets `lunaVoice = null` (`voices[0]` of empty array is `undefined || null`).

`voiceschanged` fires shortly after page load and re-runs `loadVoices()`. By the time the user navigates to Understand and taps Listen, `voiceschanged` has almost certainly fired and `lunaVoice` is non-null. But if the user taps Listen extremely fast (before `voiceschanged`), `lunaVoice` could still be `null` — in which case the utterance uses the browser default (system voice, often robotic).

**The log will confirm this.** If it prints `null/default`, `voiceschanged` timing is the bug. If it prints `Samantha`, the voice is correct and the issue is elsewhere.

---

### 2. What exact voice.name is used in Speak?

**Code path for Speak:**

1. `speakText(text)` → `LUNA_VOICE_PROVIDER === 'elevenlabs'` → `speakWithElevenLabs(text)`
2. EL request succeeds → `currentAudio.play()` → **ElevenLabs neural audio**
3. OR EL fails 401 → catch → `speakWithBrowser(text, 0.86)` → `lunaVoice.name`

`lunaVoice` priority (line 2530):
```
Samantha > Google US English > Google > Natural > en-US > voices[0]
```

**The "good Baby Luna voice" the user hears in Speak is almost certainly ElevenLabs neural audio — not the browser voice at all.**

Evidence: The EL key (`e66e7e529aa9967e8e873388a837ccaeff9eaca448f8b0ea1c9db18b5137b9d6`) was described as "burned" in earlier audit reports, but the user currently reports Speak sounds good. Either the key was renewed, or CORS/network conditions changed. The diagnostic log at `currentAudio.play()` will confirm this immediately.

If `[LaLanguish Voice] Speak voice: ElevenLabs (neural) — playing` appears in console, EL is working for Speak.

---

### 3. What exact voice.name is used in Understand?

After the `undLunaVoice → lunaVoice` change, `undSpeak()` now uses `lunaVoice` — the same variable as Speak's browser fallback. So if both use the browser, they should produce the same voice.

**But if Speak is using ElevenLabs neural audio and Understand is using browser TTS, they will always sound different regardless of which browser voice is selected.** `lunaVoice.name` may be "Samantha" and it still sounds like browser TTS compared to a neural voice.

The log will show whether both paths land on the same voice object or different ones.

---

### 4. Are rate/pitch different enough to sound robotic?

| Path | Rate | Pitch |
|---|---|---|
| Speak via `speakWithBrowser` (EL fallback) | `0.86` | `1.03` |
| Understand via `undSpeak` | `0.88` (passed by Listen btn) | `1.02` |

A difference of 0.02 in rate and 0.01 in pitch is **not perceptible** and cannot cause "robotic" quality. Rate and pitch are not the cause.

However: if Speak is using ElevenLabs (no rate/pitch involved — it's pre-rendered audio), the comparison isn't rate/pitch at all — it's neural TTS vs browser TTS. Neural always sounds more natural.

---

### 5. Does Speak still go through speakText/speakWithBrowser while Understand uses undSpeak direct?

**Yes — the two paths are entirely separate:**

```
Speak:      addAIMessage() → speakText() → speakWithElevenLabs() → [success] → Audio element
                                                                  → [fail]   → speakWithBrowser()

Understand: undListenBtn click → undSpeak() → SpeechSynthesisUtterance → window.speechSynthesis.speak()
```

Understand **never touches** `speakText()`, `speakWithElevenLabs()`, or the EL queue. It goes directly to the browser speech synthesis API. Even after the `lunaVoice` fix, it uses browser TTS while Speak uses ElevenLabs.

**This is the root cause of the quality gap** — not the voice name, not rate, not pitch. It is the TTS engine itself.

---

### 6. Should Understand call speakWithBrowser(text, 0.92) instead of maintaining its own undSpeak voice logic?

**Partially — but the real fix is to route Understand through `speakText()` (i.e., ElevenLabs).**

`speakWithBrowser` is a simpler replacement for `undSpeak` from a voice-consistency standpoint. But:
- `speakWithBrowser` has no `onEnd` callback — Understand uses `onEnd` to trigger the phrase reveal and button state changes after playback
- Replacing `undSpeak` with `speakWithBrowser` would require rewriting the sequencing logic

**The cleanest fix is to route `undSpeak` through ElevenLabs** for the audio output while keeping the existing `onEnd` callback mechanism. One approach:

```javascript
function undSpeak(text, rate, onEnd) {
  if (!text) { if (onEnd) onEnd(); return; }
  // Use EL if available; onEnd fires after audio completes or on error
  speakWithElevenLabs(text).then(() => { if (onEnd) onEnd(); }).catch(() => {
    // EL failed — fall through to browser TTS with onEnd wired to utterance.onend
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      if (lunaVoice) u.voice = lunaVoice;
      u.rate = rate || 0.9; u.pitch = 1.02; u.lang = 'en-US';
      u.onend = () => { undSetOrb('idle'); if (onEnd) onEnd(); };
      u.onerror = () => { undSetOrb('idle'); if (onEnd) onEnd(); };
      window.speechSynthesis.speak(u);
    }, 60);
  });
}
```

But `speakWithElevenLabs` pushes to a queue (`elQueue`) and the `resolve()` in `playElQueue` fires when the audio ends — so `.then()` on `speakWithElevenLabs` would fire after EL audio completes, which is exactly when `onEnd` should fire. This works.

**Risk: Medium.** EL queue and `undSpeak` have never been connected. Needs testing to confirm `onEnd` timing is correct.

---

## Predicted log output

**If ElevenLabs is working for Speak:**
```
[LaLanguish Voice] Speak voice: ElevenLabs (neural) — playing
```
→ Root cause confirmed: Speak = EL neural, Understand = browser TTS. Voice name fix was irrelevant.

**If ElevenLabs is NOT working (still 401):**
```
[Luna/EL] FAILED — falling back to browser TTS. Reason: ElevenLabs 401 — ...
[LaLanguish Voice] Speak voice: Samantha | rate: 0.86 | pitch: 1.03
[LaLanguish Voice] Understand voice: Samantha | rate: 0.88 | pitch: 1.02
```
→ Both using same voice; robotic quality from a different cause (e.g., `lunaVoice` null at first call, or `voiceschanged` timing).

---

## Recommended next step

1. Open `http://localhost:8080/index.html` in DevTools
2. Go to Speak — trigger a phrase prompt, note console output
3. Go to Understand — tap Listen, note console output
4. Report back which log lines appear

If EL log fires for Speak but not for Understand → fix is to route `undSpeak` through EL.
If both show `Samantha` — investigate whether `lunaVoice` is null on first call (timing issue).
