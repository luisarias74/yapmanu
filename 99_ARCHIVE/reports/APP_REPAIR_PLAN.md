# LaLánguish App Repair Plan

**Date:** 2026-04-26  
**Source:** APP_MODE_AUDIT_REPORT.md  
**Rule:** No file is modified until the corresponding repair session begins.

---

## Phase 1 — Understand Mode (highest impact, sandbox already done)

### Why first
Understand is the core learning mode and is the most broken: no audio, broken nav init, broken "Yes" flow, double-show bug. The sandbox (`understand-v1-FINAL.html`) already has all four issues resolved, so this is a merge operation, not a rewrite.

### Approach: Merge sandbox into index.html

Do NOT patch the four bugs individually. Instead:

1. Extract the Understand screen HTML block from `understand-v1-FINAL.html`
2. Extract all Understand-related CSS from `understand-v1-FINAL.html`
3. Extract all Understand-related JS (PHRASES, isClose, mic lifecycle, runCheck, progress system) from `understand-v1-FINAL.html`
4. Replace the corresponding blocks in `index.html` with the sandbox versions
5. Preserve all non-Understand screens and JS in index.html exactly as-is

### Backup to create before changes

```
index.html → index-before-understand-merge.html
```

Copy in Finder or terminal before any edit. Do not rename or move the original — copy it.

### Files touched

| File | Change |
|------|--------|
| `index.html` | Understand screen HTML replaced, CSS block replaced, JS block replaced |
| `index-before-understand-merge.html` | Created as backup (do not edit) |

No other files touched in Phase 1.

### Test checklist — Phase 1

- [ ] Home screen still loads and all mode cards are visible
- [ ] Tapping Understand nav card navigates to Understand screen
- [ ] Tapping Understand tab in bottom nav calls `startNewUnderstandLesson()` — a phrase loads immediately
- [ ] "Listen" button plays the phrase aloud (browser TTS fires — you hear audio)
- [ ] "Reveal Meaning" shows translation and hides the listen actions (no double-show)
- [ ] Typing the correct phrase into the input and submitting shows "Perfect" or "Good" feedback
- [ ] Mic button is visible during practice state; clicking it starts recognition
- [ ] "Yes" after a correct answer loads the NEXT phrase (does not return to Home)
- [ ] "Not yet" after an incorrect answer allows retry
- [ ] Switching to another tab mid-lesson and back reinitializes the lesson
- [ ] All other screens (Speak, Repeat, Progress, Assist) still render without errors
- [ ] Browser console has no uncaught JS errors

---

## Phase 2 — Bottom Nav + TTS (tiny patches, high return)

### Why second
Two one-line fixes that unblock the Understand nav init and fix audio for all Safari users. Low risk, isolated changes.

### Approach: Patch index.html directly

**Fix A — Nav init (index.html ~line 6563)**  
In the nav click handler's else branch, after `showScreen(target)`, add:
```javascript
if (target === 'understand') startNewUnderstandLesson();
```

> Note: If Phase 1 already merges the Understand JS, `startNewUnderstandLesson` will exist. Confirm before applying.

**Fix B — Safari TTS timing (index.html ~line 2532)**  
In `speakWithBrowser()`, change the `speak()` call from immediate to deferred:
```javascript
// before
speechSynthesis.cancel();
speechSynthesis.speak(utterance);

// after
speechSynthesis.cancel();
setTimeout(() => speechSynthesis.speak(utterance), 60);
```

### Backup to create before changes

```
index.html → index-before-nav-tts-patch.html
```

(If Phase 1 backup already exists and was not rolled back, this backup captures the post-Phase-1 state.)

### Files touched

| File | Change |
|------|--------|
| `index.html` | 2 lines changed |
| `index-before-nav-tts-patch.html` | Created as backup |

### Test checklist — Phase 2

- [ ] Tapping Understand in bottom nav loads a fresh phrase (not blank screen)
- [ ] TTS audio plays on Safari (test in Safari specifically)
- [ ] TTS audio still plays on Chrome/Firefox
- [ ] All other nav tabs still work correctly
- [ ] No regressions in Speak mode mic or TTS

---

## Phase 3 — Progress Screen (tiny, isolated)

### Why third
One attribute removal unblocks the entire Progress panel. Hardcoded stats are cosmetic but wiring them to real data makes the screen meaningful.

### Approach: Patch index.html directly

**Fix A — Remove inline style (index.html line 2133)**  
Change:
```html
<div class="progress-panel" id="progress-data-panel" style="display:none">
```
To:
```html
<div class="progress-panel" id="progress-data-panel">
```

**Fix B — Wire stats to LaLanguishApp**  
On Progress screen `show` event (or in `showScreen` handler for `progress`), populate:
- XP display → `LaLanguishApp.get('xp') || 0`
- Streak display → `LaLanguishApp.get('streak') || 0`
- Stamps display → `(LaLanguishApp.get('stamps') || []).length`

### Backup to create before changes

```
index.html → index-before-progress-patch.html
```

### Files touched

| File | Change |
|------|--------|
| `index.html` | 1 attribute removed, ~3 JS lines added |
| `index-before-progress-patch.html` | Created as backup |

### Test checklist — Phase 3

- [ ] Progress screen opens and the data panel is visible (not blank)
- [ ] XP, streak, and stamp counts reflect localStorage values (open DevTools > Application > localStorage to verify)
- [ ] Progress screen still shows correctly when localStorage is empty (zeroes, not errors)
- [ ] No regressions in other screens

---

## Deferred (Do not plan yet)

| Phase | Mode | Reason deferred |
|-------|------|-----------------|
| 4 | Speak — EL key | Requires key management UI design decision |
| 5 | Repeat — phrase pool | Low user impact; needs design input |
| 6 | Scenario — add scenarios | Content work, not a bug |
| 7 | Assist — key input UI | Dependent on Speak key management |

---

## Rollback procedure (any phase)

1. Delete the modified `index.html`
2. Rename the backup (e.g. `index-before-understand-merge.html`) back to `index.html`
3. Reload in browser — previous state restored

Git provides a secondary safety net: every backup commit is tagged before changes begin.

---

## Summary

| Phase | Mode | Approach | Effort | Risk |
|-------|------|----------|--------|------|
| 1 | Understand | Merge sandbox | Medium | Low (sandbox is proven) |
| 2 | Bottom Nav + TTS | Patch 2 lines | Tiny | Minimal |
| 3 | Progress | Patch 1 attr + 3 JS lines | Small | Minimal |
