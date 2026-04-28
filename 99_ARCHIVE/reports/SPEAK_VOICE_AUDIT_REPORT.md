# Speak Voice Audit Report

**Date:** 2026-04-26  
**Scope:** Why navigating to Speak via the toolbar mic icon produces no voice prompt  
**Files:** `index.html` only  
**Status:** Audit only — no files modified.

---

## 1. Which home/toolbar mic icon navigates to Speak

The icon the user calls "the toolbar mic" is the **bottom navigation bar's Speak button** — the second button in the `schema-nav`, containing a microphone SVG:

```html
<!-- index.html line 2151 -->
<div class="schema-nav-btn" data-screen="speak-screen">
  <svg><!-- mic icon --></svg>
</div>
```

`data-screen="speak-screen"` is the identifier the nav handler uses to route to Speak mode.

There is no mic icon on the home screen itself. The home screen has:
- `#home-start-btn` — "Start speaking" text button
- `#home-assist-btn` — "Luna Assist" text button
- `#baby-luna` — Baby Luna orb (routes to **Assist**, not Speak)

---

## 2. What handler the nav mic button calls

The nav handler (index.html ~line 6563) fires on every nav button click:

```javascript
navEl.querySelectorAll('.schema-nav-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var targetId = btn.getAttribute('data-screen');
    if (targetId === 'home-screen') {
      returnToHome();
    } else if (targetId === 'progress-screen') {
      if (typeof renderProgressScreen === 'function') renderProgressScreen();
      showScreen(progressScreen);
    } else {
      var target = screenMap[targetId];
      if (target) {
        showScreen(target);
        if (targetId === 'understand-screen') startNewUnderstandLesson(); // ← added in recent fix
      }
    }
    updateNavActive(targetId);
    updateBeams();
  });
});
```

For `speak-screen`, the handler falls into the `else` branch and calls only:

```javascript
showScreen(speakScreen);
// nothing else
```

**`startNewSpeakSession()` is never called.**

---

## 3. Whether it calls startNewSpeakSession()

**No.** The nav handler for `speak-screen` calls only `showScreen(speakScreen)`.

The only place `startNewSpeakSession()` is called is:

| Caller | Location |
|--------|----------|
| `homeStartBtn` click | line 4718 |
| `startScenarioSession()` fallback | line 4286 |
| Speak-to-next-phrase internal flow | line ~4237 |

None of these are triggered by the bottom nav's Speak button.

---

## 4. Whether startNewSpeakSession() calls speech/audio

Yes. The full chain when `startNewSpeakSession(phrase)` IS called correctly:

```
startNewSpeakSession(phrase)
  └── window.setTimeout(() => {
        addAIMessage(introMsg)           // 650ms delay
          └── window.setTimeout(() => {
                speakText(text)           // 950ms delay (inside addAIMessage)
              }, 950)
      }, 650)
```

`speakText()` is the single call-site for all voice output:

```javascript
// line 2740
function speakText(text) {
  if (!text) return;
  lastSpokenPhrase = text;
  if (LUNA_VOICE_PROVIDER === 'elevenlabs') {
    speakWithElevenLabs(text);
  } else {
    speakWithBrowser(text);
  }
}
```

So when `startNewSpeakSession()` is called, voice fires ~1600ms after navigation (650ms + 950ms). When it is NOT called (nav button path), there is zero voice output.

---

## 5. Whether Speak uses speakText(), speakWithBrowser(), ElevenLabs, or different path

All voice in Speak mode flows through `speakText()`. The full path:

```
speakText(text)
  └── if LUNA_VOICE_PROVIDER === 'elevenlabs':
        speakWithElevenLabs(text)
          └── fetch() to api.elevenlabs.io
                success → play <Audio> element
                failure → catch → speakWithBrowser(text, browserRate)
      else:
        speakWithBrowser(text)
```

`speakWithBrowser()` (line 2541):
```javascript
function speakWithBrowser(text, rate = 0.86) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  // splits text at sentence boundaries, speaks each segment
  segments.forEach(segment => {
    window.speechSynthesis.speak(utterance);
  });
}
```

Note: **No 60ms defer between `cancel()` and `speak()`** — Safari silent-drop bug is present here (separate issue, not the root cause of the missing prompt).

---

## 6. Whether voice is blocked by LUNA_VOICE_PROVIDER = 'elevenlabs'

Partially. The constant is hardcoded:

```javascript
// line 2521
const LUNA_VOICE_PROVIDER = 'elevenlabs';
const ELEVENLABS_API_KEY  = 'e66e7e529aa9967e8e873388a837ccaeff9eaca448f8b0ea1c9db18b5137b9d6';
```

The EL API key is burned/expired. Every EL request returns HTTP 401. The `catch` block in `playElQueue()` (line 2706) handles this gracefully:

```javascript
} catch (err) {
  console.warn('[Luna/EL] FAILED — falling back to browser TTS. Reason:', err.message);
  elPlaying = false;
  resolve();
  speakWithBrowser(text, browserRate || 0.86);  // ← browser TTS fires here
  playElQueue();
}
```

So `LUNA_VOICE_PROVIDER = 'elevenlabs'` does NOT block voice entirely — it adds a round-trip HTTP failure (~200–500ms) before browser TTS takes over. Voice does eventually play via `speakWithBrowser`, just delayed.

**This is not the root cause of the silent Speak screen.** The root cause is that `startNewSpeakSession()` is never called.

---

## 7. Whether Baby Luna voice path is different from Speak voice path

Baby Luna → `showScreen(assistScreen)` → user submits → `runLunaAssist()` → `speakText(assistLastResult.english)` at line 6507.

That's the same `speakText()` → `speakWithElevenLabs()` → fallback to `speakWithBrowser()` path. **Identical voice chain.**

If Baby Luna/Assist voice works for the user, it confirms:
- `speakWithBrowser()` works in their browser
- The EL fallback is functioning
- The bug is not in the audio path itself

---

## 8. Why opening Speak from the toolbar does not speak

**Root cause: the nav handler does not call `startNewSpeakSession()`.**

When the user taps the Speak (mic) icon in the bottom nav:

1. `showScreen(speakScreen)` is called — the Speak screen becomes visible
2. `startNewSpeakSession()` is **never called**
3. The screen shows the **static hardcoded HTML messages** baked into the HTML at page load:
   ```html
   <div class="message ai">Hi Luis... ready to practice?</div>
   <div class="message ai">Say: <strong>"I need help."</strong></div>
   ```
4. These static messages were never injected via `addAIMessage()`, so `speakText()` was never called for them
5. **No voice fires. No new session starts. Luna is silent.**

Compare with the working path (Home → "Start speaking"):
1. `homeStartBtn` click → `startNewSpeakSession(nextRecommendedPhrase)` 
2. 650ms later → `addAIMessage(introMsg)` → renders new messages, calls `speakText()`
3. 950ms later → EL attempt → fails → `speakWithBrowser()` → voice plays
4. Luna is audible

---

## Root cause summary

| Path | Calls startNewSpeakSession? | Voice fires? |
|------|-----------------------------|--------------|
| Bottom nav Speak (mic icon) | **No** | **No** |
| Home "Start speaking" button | Yes | Yes (browser TTS after EL fails) |
| Internal next-phrase flow | Yes | Yes |

The nav handler already has this exact fix applied for Understand:
```javascript
if (targetId === 'understand-screen') startNewUnderstandLesson();
```

Speak needs the same one-line addition.

---

## Smallest safe patch

In the nav handler's `else` branch, add one line for `speak-screen`, mirroring the Understand fix:

**Before:**
```javascript
} else {
  var target = screenMap[targetId];
  if (target) {
    showScreen(target);
    if (targetId === 'understand-screen') startNewUnderstandLesson();
  }
}
```

**After:**
```javascript
} else {
  var target = screenMap[targetId];
  if (target) {
    showScreen(target);
    if (targetId === 'understand-screen') startNewUnderstandLesson();
    if (targetId === 'speak-screen') startNewSpeakSession(null);
  }
}
```

`null` as the phrase argument causes `startNewSpeakSession` to call `pickNextSpeakPhrase()` internally, selecting an appropriate phrase — same as the home button does when no specific phrase is recommended.

**One line. No other changes needed.**
