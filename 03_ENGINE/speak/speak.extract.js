          addAIMessage(step.cue);
          return;
        }
        const stage = getLearnerState() || 'starting';
        const staged = buildStageCue(step, stage, speakTargetPhrase);
        addAIMessage(staged.cue, staged.coach, true, staged.meaning);
      }, delay);
    }

    function pickNextSpeakPhrase() {
      // Mastery weight: lower mastery = more tickets = more likely to be chosen
      const masteryWeights = { 0: 8, 1: 6, 2: 4, 3: 2, 4: 1 };

      // Exclude phrases already used this session to avoid same-session loops
      let candidates = speakPhrasePool.filter(p => !speakUsedPhrases.includes(p));

      // Pool exhausted — reset but keep the most recent phrase out to avoid instant repeat
      if (candidates.length === 0) {
        speakUsedPhrases = speakTargetPhrase ? [speakTargetPhrase] : [];
        candidates = speakPhrasePool.filter(p => !speakUsedPhrases.includes(p));
        if (candidates.length === 0) return speakPhrasePool[0];
      }

      // Build weighted pool: each phrase gets N tickets proportional to its weight.
      // Assist phrases with low learning-memory mastery get a boost so they surface early.
      // Boost reduces as the learner demonstrates success (masteryLevel 0→3).
      const almBoostMap = { 0: 6, 1: 4, 2: 2, 3: 0 };
      const weighted = [];
      for (const phrase of candidates) {
        const mastery = getPhraseMastery(phrase);
        const base = masteryWeights[mastery] || 1;
        const almEntry = getAssistLearningEntry(phrase);
        const assistBoost = almEntry ? (almBoostMap[almEntry.masteryLevel] || 0) : 0;
        const w = base + assistBoost;
        for (let i = 0; i < w; i++) weighted.push(phrase);
      }

      return weighted[Math.floor(Math.random() * weighted.length)];
    }

    function startNextPhrase() {
      // Normal Speak Mode: weighted random phrase selection
      const transitions = [
        'Nice. Let\u2019s try a new one.',
        'Good. Moving on.',
        'Keep going \u2014 new phrase:'
      ];
      const next = pickNextSpeakPhrase();
      const memT = getMasteryTransition(next);
      const _almEntry = getAssistLearningEntry(next);
      const assistRef = (!memT && _almEntry && Math.random() < 0.5)
        ? (_almEntry.timesPracticed === 0
            ? pick(['You looked this one up earlier.', 'Let\u2019s practice what you asked about.'])
            : pick(['You asked about this one earlier.', 'Let\u2019s come back to this one.']))
        : null;
      const t = assistRef || memT || transitions[speakUsedPhrases.length % transitions.length];
      // Moving to a new phrase ends any Assist-practice context — the Try button applied only
      // to the looked-up phrase, not to subsequent curriculum phrases in the same session.
      if (isAssistPractice) {
        isAssistPractice = false;
        assistPracticePhrase = '';
        assistPracticeCategory = '';
        _clearAssistChainState();
      }
      speakUsedPhrases.push(next);
      speakTargetPhrase = next;
      speakAttemptCount = 0;
      speakWeakAttempts = 0;
      speakSessionStruggled = false;
      speakSequenceIndex = 0;
      interactionCount = 0;
      sessionComplete.classList.remove('visible');
      hearAgainBtn.classList.remove('is-suggested');
      speakSequence = speakPracticeSequences[next] || [];
      showPhraseContext(next);
      const firstStep = speakSequence[0] || null;
      const stage = getLearnerState() || 'starting';
      const staged = (firstStep && !firstStep.done) ? buildStageCue(firstStep, stage, next) : null;

      if (speakPhraseTransitionTimer) window.clearTimeout(speakPhraseTransitionTimer);
      speakPhraseTransitionTimer = window.setTimeout(() => {
        speakPhraseTransitionTimer = null;
        addAIMessage(t);
        if (staged) {
          window.setTimeout(() => addAIMessage(staged.cue, staged.coach, true, staged.meaning), getTimingProfile('first_cue', next, stage));
        }
      }, getTimingProfile('transition', next, stage));
    }

    function startNewSpeakSession(phrase) {
      speakUsedPhrases = [];
      speakAttemptCount = 0;
      speakWeakAttempts = 0;
      speakSessionStruggled = false;
      speakSequenceIndex = 0;
      interactionCount = 0;
      sessionComplete.classList.remove('visible');
      messageList.innerHTML = '';
      setSpeakModeLabel('Speak Mode');
      const first = (phrase && speakPracticeSequences[phrase]) ? phrase : pickNextSpeakPhrase();
      speakUsedPhrases.push(first);
      speakTargetPhrase = first;
      speakSequence = speakPracticeSequences[first] || [];
      showPhraseContext(first);
      if (speakNextStepTimer) {
        window.clearTimeout(speakNextStepTimer);
        speakNextStepTimer = null;
      }
      setLunaState('idle');
      const stage = getLearnerState() || 'starting';
      const intros = {
        starting:   'Hi Luis\u2026 ready to practice?',
        building:   'Let\u2019s keep going.',
        settling:   'Ready when you are.',
        ready_more: null
      };
      const introMsg = intros[stage] !== undefined ? intros[stage] : 'Hi Luis\u2026 ready to practice?';
      const step = speakSequence[0];
      const staged = (step && !step.done) ? buildStageCue(step, stage, first) : null;

      window.setTimeout(() => {
        if (introMsg) {
          addAIMessage(introMsg);
          if (staged) window.setTimeout(() => addAIMessage(staged.cue, staged.coach, true, staged.meaning), getTimingProfile('session_start', first, stage));
        } else if (staged) {
          addAIMessage(staged.cue, staged.coach, true, staged.meaning);
        }
      }, 650);
    }

    // ── Scenario session ──────────────────────────────────────────────────────
    function startScenarioSession(scenarioId) {
      const scenario = scenarioLibrary.find(s => s.id === scenarioId);
      if (!scenario) { startNewSpeakSession(null); return; }

      // Assist practice context ends when a scenario session begins; the chained-completion
      // state (wasAssistChainedScenario etc.) is kept separately and handled in finishScenario.
      isAssistPractice = false;
      assistPracticePhrase = '';
      assistPracticeCategory = '';

      activeScenario = scenario;
      scenarioTurnIndex = -1;
      lastScenarioMatchedVariant = null;
      scenarioMemory = {};

      speakUsedPhrases = [];
      speakAttemptCount = 0;
      speakWeakAttempts = 0;
      speakSessionStruggled = false;
      speakSequenceIndex = 0;
      speakTargetPhrase = '';
      speakSequence = [];
      interactionCount = 0;
      sessionComplete.classList.remove('visible');
      messageList.innerHTML = '';
      setSpeakModeLabel('Scenario Mode');
      showPhraseContext('');

      if (speakNextStepTimer) { window.clearTimeout(speakNextStepTimer); speakNextStepTimer = null; }
      setLunaState('idle');

      window.setTimeout(() => advanceScenarioTurn(), 650);
    }

    function advanceScenarioTurn() {
