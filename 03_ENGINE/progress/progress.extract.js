    // - feel immediate and natural
    // - reinforce real-life phrases
    // - stay lightweight and non-intrusive
    let isAssistPractice = false;   // true when Speak/Repeat launched from Assist Try button
    let assistPracticePhrase = '';  // the exact phrase being practiced from Assist
    let assistPracticeCategory = ''; // its inferred category
    // Assist → Scenario chaining should:
    // - follow successful speaking
    // - turn phrases into context
    // - stay optional and lightweight
    // - never replace the main curriculum
    let pendingAssistScenarioChain = false;
    let assistChainPhrase = '';
    let assistChainCategory = '';
    let assistChainScenarioId = '';
    let assistChainTone = '';
    let assistChainPressure = ''; // 'low' | 'medium' | 'high'
    // Assist chain completion should:
    // - reward real contextual use
    // - stay brief
    // - strengthen memory without adding friction
    let wasAssistChainedScenario = false;
    let assistChainedPhrase = '';
    let assistChainedCategory = '';
    let assistChainedPressure = '';
    let lastSpokenPhrase = '';

    // ── Phrase mastery tracking ───────────────────────────────────────────────
    // Scores: 0=unseen, 1=struggled, 2=completed with help, 3=clean once, 4=clean twice
    const MASTERY_KEY = 'lalanguish_mastery_v1';

    function loadMasteryMap() {
      try { return JSON.parse(localStorage.getItem(MASTERY_KEY) || '{}'); }
      catch (_) { return {}; }
    }

    function saveMasteryMap() {
      try { localStorage.setItem(MASTERY_KEY, JSON.stringify(masteryMap)); }
      catch (_) {}
    }

    let masteryMap = loadMasteryMap();

    function getPhraseMastery(phrase) {
      return typeof masteryMap[phrase] === 'number' ? masteryMap[phrase] : 0;
    }

    // result: 'struggle' | 'helped' | 'clean' | 'repeat_success' | 'understand_success'
    function updatePhraseMastery(phrase, result) {
      if (!phrase) return;
      const current = getPhraseMastery(phrase);
      let next = current;

      if (result === 'struggle') {
        // At least 1; gracefully pull back high mastery by one level
        next = current >= 3 ? 2 : 1;
      } else if (result === 'helped') {
        // Completed with stumbles — floor at 2, cap at 3
        next = Math.min(3, Math.max(2, current));
      } else if (result === 'clean') {
        // Clean completion — 3 first time, 4 on repeat clean
        next = current >= 3 ? 4 : 3;
      } else if (result === 'repeat_success') {
        // Successful Repeat confirms recall — advances to 2 if below, otherwise holds
        next = current < 2 ? 2 : current;
      } else if (result === 'understand_success') {
        // Understand marks first contact — floor at 1
        next = Math.max(1, current);
      }

      if (next !== current) {
        masteryMap[phrase] = next;
        saveMasteryMap();
      }
      // Mirror result into assist learning memory if this phrase came from Assist
      if (getAssistLearningEntry && getAssistLearningEntry(phrase)) {
        const wasCorrect = (result === 'clean' || result === 'repeat_success' || result === 'understand_success');
        recordAssistLearningResult(phrase, wasCorrect);
      }
    }

    // ── Scenario completion tracking ──────────────────────────────────────────
    const SCENARIO_KEY = 'lalanguish_scenarios_v1';
    function loadScenarioDone() {
      try { return JSON.parse(localStorage.getItem(SCENARIO_KEY) || '{}'); } catch (_) { return {}; }
    }
    function markScenarioDone(id) {
      const done = loadScenarioDone();
      done[id] = Date.now();
      try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(done)); } catch (_) {}
    }
    function isScenarioDone(id) { return !!loadScenarioDone()[id]; }
    // ─────────────────────────────────────────────────────────────────────────

    const repeatPhraseRecord = {};

    function recordRepeatOutcome(phrase, success) {
      if (!repeatPhraseRecord[phrase]) {
        repeatPhraseRecord[phrase] = { hits: 0, misses: 0 };
      }
      if (success) {
        repeatPhraseRecord[phrase].hits += 1;
      } else {
        repeatPhraseRecord[phrase].misses += 1;
      }
    }
