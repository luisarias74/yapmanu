# Home Nav and Repeat Auto-Speak Audit Report

**Date:** 2026-04-26
**Scope:** (1) Home nav does not visually return home; (2) Repeat auto-speaks on nav entry
**Files:** `index.html` only
**Status:** Audit only — no files modified.

---

## Issue 1 — Home nav does not return Home from other pages

### 1.1 — Home button `data-screen` value

```html
<!-- line 2168 -->
<div class="schema-nav-btn on" data-screen="home-screen">
```

`data-screen="home-screen"`. Correct value. The home button IS being found by `querySelectorAll('.schema-nav-btn')`.

---

### 1.2 — Does `homeScreen` exist?

```javascript
// line 2178
const homeScreen = document.getElementById('home-screen');
```

`#home-screen` is in the DOM at line 1752 as `<div id="home-screen" class="screen active">`. `homeScreen` is non-null and valid. The script runs after the DOM is parsed (script is at bottom of body). No issue here.

---

### 1.3 — Does `returnToHome()` run?

The nav handler (line 6668):
```javascript
if (targetId === 'home-screen') {
  window.speechSynthesis && window.speechSynthesis.cancel();
  returnToHome();
}
```

**`returnToHome()` runs.** The condition `targetId === 'home-screen'` is met because `data-screen="home-screen"` and `btn.getAttribute('data-screen')` returns that value. The `querySelectorAll` finds all 5 `.schema-nav-btn` nodes including the home one.

---

### 1.4 — Does `showScreen(homeScreen)` run?

`returnToHome()` at line 3922–3934:
```javascript
function returnToHome() {
  isAssistPractice = false;
  // ... state clears ...
  _clearAssistChainState();
  // ... more state clears ...
  if (understandPlayTimer) { ... }
  updateHomeRecommendation(true);    // ← runs first
  showScreen(homeScreen);            // ← runs synchronously after
}
```

`updateHomeRecommendation(true)` runs first. It immediately adds `fading` CSS class to `homeTitle`, `homeSubtitle`, `homeStartBtn`, sets Luna orb to `thinking`, then calls `window.setTimeout(() => { ... }, 750)` to animate them back in. It **returns immediately** — the timeout is async.

`showScreen(homeScreen)` then runs synchronously. It removes `active` from all screens, adds `hidden` to all, then removes `hidden` from `homeScreen` and adds `active`. **The screen DOES change to home.**

---

### 1.5 — Whether a CSS/class issue keeps Home hidden

**No CSS rule hides `#home-screen` itself.** The relevant rules:

```css
.screen        { display: none; }
.screen.active { display: block; }
.hidden        { display: none !important; }
```

After `showScreen(homeScreen)`:
- `homeScreen.classList` = `screen active` (no `hidden`) → `display: block` ✓
- All other screens = `screen hidden` → `display: none` ✓

There is no `!important` override on `#home-screen` itself that would block it from showing.

However: **the home screen's text content is intentionally invisible for 750ms** due to `updateHomeRecommendation(true)`. It adds the `fading` class to `homeTitle`, `homeSubtitle`, and `homeStartBtn`. These elements are mid-fade-out when the screen first appears. The user sees a home screen that is largely empty for ~750ms before content fades back in.

This is **not a broken navigation** — the screen change is real — but it creates the perception that nothing happened, because the visible content of the home screen is in a blank/faded state immediately after arriving.

---

### 1.6 — Whether `updateNavActive` interferes

`updateNavActive('home-screen')` is called after `returnToHome()` in the nav handler. It correctly sets the home button's `on` class:

```javascript
function updateNavActive(screenId) {
  navEl.querySelectorAll('.schema-nav-btn').forEach(function(btn) {
    btn.classList.toggle('on', btn.getAttribute('data-screen') === screenId);
  });
}
```

This runs correctly. The MutationObserver (line 6681) also fires when `homeScreen` gains the `active` class, and it also calls `updateNavActive('home-screen')`. No interference — both produce the same correct result.

---

### 1.7 — The actual cause of the perceived failure

Two compounding issues:

**Issue A — Home content is visually blank for 750ms:**

`updateHomeRecommendation(true)` adds `fading` class to home title, subtitle, and start button immediately. Those elements fade to `opacity: 0`. They are restored 750ms later via the setTimeout callback. So the home screen is technically visible but appears nearly empty/blank for 750ms after navigation.

**Issue B — Speak/Understand timers still fire after the user leaves:**

When the user navigates from Speak via nav:
1. `startNewSpeakSession(null)` was called 650ms ago (when the user first entered Speak)
2. Its `window.setTimeout(() => { addAIMessage(introMsg); ... }, 650)` may STILL be pending when the user taps Home
3. Even if speech is cancelled (our recent fix), the 650ms timer calls `addAIMessage()` which:
   - Calls `setLunaState('idle')` — modifies the Speak screen's Luna orb (no-op, screen is hidden)
   - Calls `speakText(text)` — plays TTS audio again AFTER the user is on Home

**The combined effect:** Home screen appears, but is blank/faded for 750ms, AND TTS audio from Speak fires in the background. The user thinks nothing happened.

Neither issue is a navigation failure — the screen does change — but both make it invisible or ambiguous that it changed.

---

### 1.8 — Smallest safe fix

**Fix A:** Remove animation delay from `returnToHome()` — call `updateHomeRecommendation(false)` (no animate flag) instead of `updateHomeRecommendation(true)`. This updates text immediately, no fade delay.

**Fix B:** Cancel the Speak/Understand session timers in `returnToHome()`. Two timers need clearing:

```javascript
// Already has:
if (understandPlayTimer) { window.clearTimeout(understandPlayTimer); understandPlayTimer = null; }

// Needs to add:
if (speakNextStepTimer)  { window.clearTimeout(speakNextStepTimer);  speakNextStepTimer  = null; }
if (speakPhraseTransitionTimer) { window.clearTimeout(speakPhraseTransitionTimer); speakPhraseTransitionTimer = null; }
// Also stop EL audio if playing:
if (currentAudio) { currentAudio.pause(); currentAudio = null; }
```

`speakNextStepTimer` and `speakPhraseTransitionTimer` are already declared and used in the Speak session. `currentAudio` is the ElevenLabs `Audio` element.

**Fix A alone** would make home instantly readable and eliminate the "blank screen" perception. Fix B prevents orphaned TTS from playing after navigation.

---

## Issue 2 — Repeat auto-speaks when entering Repeat screen

### 2.1 — What change caused Repeat to auto-speak

Two changes were applied in the same patch session:

**Change 1** — Added `speakText(currentRepeatPhrase)` to the end of `startRepeatChallenge()` (line ~3347):
```javascript
window.setTimeout(() => speakText(currentRepeatPhrase), 400);
```

**Change 2** — Added `startRepeatChallenge()` to the nav handler for `repeat-screen` (line ~6680):
```javascript
if (targetId === 'repeat-screen') {
  var rc = document.querySelector('#repeat-screen .repeat-card');
  if (rc) rc.classList.add('challenge-active');
  startRepeatChallenge();
}
```

Together: tapping the Repeat nav button → `startRepeatChallenge()` → 400ms later → `speakText(currentRepeatPhrase)`. The phrase is spoken immediately on arrival, before the user does anything.

---

### 2.2 — Should `startRepeatChallenge()` be removed from the nav handler?

**Yes — partially.** The nav handler SHOULD call `startRepeatChallenge()` to load a challenge and add `challenge-active` so the Check button becomes visible (the original bug). But it should NOT cause auto-speech.

The `speakText(currentRepeatPhrase)` line inside `startRepeatChallenge()` is the speech source. If it stays there, it fires on every challenge start — including via nav, via topic card click, and via "Next challenge" button. That's too aggressive for all cases.

---

### 2.3 — Safest way to show Repeat page without auto-speaking

**Option 1 (recommended):** Remove `speakText` from `startRepeatChallenge()` entirely. Let the user tap a "Hear phrase" button or the existing Repeat flow speak the phrase only when needed (e.g., correct answer feedback already speaks via `setRepeatLunaState`). The phrase meaning is already shown as text in `repeatCue`. No auto-speech needed on load.

```javascript
// Remove this line from startRepeatChallenge():
window.setTimeout(() => speakText(currentRepeatPhrase), 400);
```

**Option 2:** Keep `speakText` in `startRepeatChallenge()` but only when the challenge is started by explicit user action (topic card click or "Next challenge" button), not on nav entry. This requires passing a parameter:

```javascript
function startRepeatChallenge(phrase, speakOnStart = false) {
  ...
  if (speakOnStart) window.setTimeout(() => speakText(currentRepeatPhrase), 400);
}
```

Then the nav handler passes `startRepeatChallenge(null, false)` (no speech), while the topic card and "Next challenge" button pass `startRepeatChallenge(null, true)` (speak on start).

**Option 1 is safer** — one removal, no parameter threading required.

---

## Summary

| Issue | Root cause | Fix |
|---|---|---|
| Home nav feels broken | Home text is invisible for 750ms (fade animation); orphaned Speak timers fire TTS after nav | Call `updateHomeRecommendation(false)` in `returnToHome()`; cancel `speakNextStepTimer`, `speakPhraseTransitionTimer`, `currentAudio` |
| Repeat auto-speaks | `speakText(currentRepeatPhrase)` added inside `startRepeatChallenge()`, which now runs on nav entry | Remove the `speakText` line from `startRepeatChallenge()` |
