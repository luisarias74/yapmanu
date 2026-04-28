# LaLánguish App Mode Audit Report

**Date:** 2026-04-26  
**Visual reference:** `index.GOLDEN-stable-with-baby-luna.html`  
**Functional reference:** `understand-v1-FINAL.html`  
**Current app state:** `index.html` (6652 lines) + `app.js` (110 lines)

---

## 1. Home Screen

**Status: Works**

- Luna orb renders with breathe animation
- Tagline and mode cards display correctly
- Bottom nav visible and functional
- Mode cards navigate to correct screens

**Issues:** None critical.

**Fix approach:** N/A  
**Repair in:** N/A

---

## 2. Understand Mode

**Status: Broken (multiple issues)**

### Issue 2a — No TTS on "Listen" button
`understandListenBtn` click handler (index.html ~line 4581) uses a fake 1800ms timer and sets a waveform animation. It does **not** call `speechSynthesis.speak()` or ElevenLabs. The learner hears nothing.

### Issue 2b — Nav click does not initialize a lesson
The bottom nav handler (index.html ~line 6563) for the Understand tab only calls `showScreen('understand')`. It does not call `startNewUnderstandLesson()`. Arriving via nav shows a stale or empty lesson state.

### Issue 2c — "Yes" returns to Home instead of next phrase
`handleReflection(true)` (~line 4558) calls `returnToHome()` after 1800ms. It should load the next phrase and stay in Understand mode.

### Issue 2d — Double-show after "Reveal Meaning"
`understandMeaningBtn` click (~line 4599) shows the practice area while `listenActions` is still visible. Both sections appear simultaneously.

**Safest fix approach:** Rebuild as sandbox (like `understand-v1-FINAL.html`) rather than patching index.html. The sandbox already has all four issues resolved. When ready, replace the Understand screen block in index.html with the sandbox version.

**Repair in:** New sandbox (`understand-v1-FINAL.html`) — already done. Merge into index.html when stable.

---

## 3. Speak Mode

**Status: Partially works**

- UI renders correctly (phrase card, mic button, feedback area)
- SpeechRecognition is implemented with `understandRecognitionActive` guard (works correctly)
- ElevenLabs TTS is wired but the hardcoded API key (`e66e7e529aa9...`, line 2512) is likely expired/burned

### Issue 3a — ElevenLabs API key burned
Hardcoded key in index.html line 2513. Production audio will silently fail; browser fallback triggers instead.

### Issue 3b — Browser TTS timing bug (Safari)
`speakWithBrowser()` (~line 2532) calls `speechSynthesis.cancel()` then immediately `speak()` in the same tick. On Safari this causes silent drop. Fix: wrap `speak()` in `setTimeout(..., 60)`.

**Safest fix approach:** Patch index.html for the two specific issues (key → user-supplied key or env var; add 60ms defer). Low blast radius.

**Repair in:** `index.html` (targeted patches)

---

## 4. Repeat / Training Mode

**Status: Partially works**

- Screen renders
- Basic listen→repeat flow works
- SpeechRecognition present

### Issue 4a — Generic 5-phrase pool
Training phrases are hardcoded to 5 generic greetings regardless of current lesson or user progress. Not adaptive.

### Issue 4b — Hardcoded topic progress
Progress indicators in Repeat mode show static values, not reading from `app.js` localStorage.

**Safest fix approach:** Low priority. Patch to read current lesson phrases from the same `PHRASES` array used in Understand. Connect progress display to `LaLanguishApp.get('completed')`.

**Repair in:** `index.html` (moderate patches)

---

## 5. Scenario / Play Mode

**Status: Partially works**

- UI renders; scenario card displays
- Dialogue flow works for the one built scenario

### Issue 5a — Only 1 real scenario
The scenario pool contains a single hardcoded "café order" scenario. The UI implies multiple scenarios exist.

### Issue 5b — No dedicated screen
Scenario content is injected into a generic modal rather than a full dedicated screen. Feels underdeveloped.

**Safest fix approach:** Add 2–3 more scenario objects to the existing array. Creating a dedicated screen is a larger rebuild — defer.

**Repair in:** `index.html` (data-only addition for scenarios)

---

## 6. Progress Screen

**Status: Partially broken**

### Issue 6a — Inline style blocks display
`#progress-data-panel` has `style="display:none"` hardcoded at line 2133. CSS cannot override inline styles. The progress panel never shows even when data is present.

**Fix:** Remove `style="display:none"` from that element; use the `.hidden` class instead (already wired in CSS).

### Issue 6b — Hardcoded stats
XP, streak, and stamp counts displayed in the Progress screen are static placeholder values. They do not read from `LaLanguishApp` localStorage.

**Safest fix approach:** Remove the inline style (1 character change). Wire stats to `LaLanguishApp.get('xp')`, `get('streak')`, etc.

**Repair in:** `index.html` (small targeted patches)

---

## 7. Assist / Luna Chat Mode

**Status: Conditional — works when API key is present**

- Luna chat UI renders correctly
- Anthropic API call is wired
- Graceful fallback message shown when no key

### Issue 7a — No key management UI
Users must manually open DevTools and set a key. No in-app key entry field exists.

**Safest fix approach:** Add a simple settings field (one `<input>`) that writes to `LaLanguishApp.set('api_key', val)`. Low risk.

**Repair in:** `index.html` (additive only)

---

## 8. Voice / TTS System

**Status: Broken for production**

| Layer | Status | Notes |
|-------|--------|-------|
| ElevenLabs | Broken | Hardcoded key burned (line 2513) |
| Browser TTS | Buggy | No cancel-defer; Safari silent-drop bug |
| Understand TTS | Completely missing | Listen button has NO speech call |

### Summary of TTS issues:
- EL key is a single point of failure with no rotation mechanism
- Safari users hear nothing from browser TTS
- Understand mode has zero audio playback (worst regression)

**Safest fix approach:**
1. Add 60ms defer to `speakWithBrowser()` (1 line)
2. Fix Understand Listen button to call `speakWithBrowser(phrase)`
3. Replace hardcoded EL key with `LaLanguishApp.get('api_key')` or remove EL entirely until key management is built

**Repair in:** `index.html` (targeted patches)

---

## 9. Mic / Speech Recognition

**Status: Works**

- Speak mode: `understandRecognitionActive` guard prevents double-start ✓
- Understand mode (sandbox `understand-v1-FINAL.html`): `micActive` flag, full lifecycle ✓
- Unsupported browser: mic button hidden ✓
- Error states: permission denied, no-speech, generic — all handled ✓

**Issues:** None. This is the most solid subsystem.

**Fix approach:** N/A  
**Repair in:** N/A (sandbox already production-ready)

---

## 10. Bottom Navigation

**Status: Partially broken**

Nav handler (index.html ~line 6563) uses a single `showScreen(target)` call for all tabs.

### Issue 10a — Understand tab missing lesson init
Tapping Understand nav shows the screen but does not call `startNewUnderstandLesson()`. User sees whatever was last on screen (or empty state).

### Issue 10b — No active-state reset on tab switch
Switching tabs mid-flow (e.g., leaving Understand while mic is active) does not call `stopMic()` or reset lesson state.

**Safest fix approach:** In the nav handler's else branch, add:
```javascript
if (target === 'understand') startNewUnderstandLesson();
```
And call `stopMic()` on any tab switch.

**Repair in:** `index.html` (2-line targeted patch)

---

## Priority Order for Fixes

| Priority | Mode | Issue | Effort |
|----------|------|-------|--------|
| 1 | Understand | No TTS on Listen | Small — add `speakWithBrowser(phrase)` |
| 2 | Bottom Nav | Understand tab missing init | Tiny — 1 line |
| 3 | Progress | Inline style blocks panel | Tiny — remove attribute |
| 4 | Voice/TTS | Safari browser TTS timing | Tiny — add setTimeout |
| 5 | Understand | Yes→Home instead of next phrase | Small — fix `handleReflection` |
| 6 | Understand | Double-show after Reveal | Small — hide listenActions first |
| 7 | Speak | EL key burned | Medium — key management UI |
| 8 | Progress | Hardcoded stats | Small — wire to LaLanguishApp |
| 9 | Repeat | Generic phrase pool | Small — share PHRASES array |
| 10 | Scenario | Only 1 scenario | Medium — write 2–3 more |

---

## Rebuild vs. Patch Recommendation

| Mode | Recommendation |
|------|---------------|
| Understand | **Merge sandbox** (`understand-v1-FINAL.html`) into index.html — sandbox is already complete |
| Speak | Patch index.html (TTS timing + key) |
| Repeat | Patch index.html (phrase pool + progress) |
| Scenario | Patch index.html (add scenario data) |
| Progress | Patch index.html (remove inline style + wire stats) |
| Assist | Patch index.html (add key input) |
| Home | No action |
| Mic | No action |
| Bottom Nav | Patch index.html (1 line) |
| Voice/TTS | Patch index.html (3 small changes) |
