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
      if (!activeScenario) return;
      scenarioTurnIndex++;

      if (scenarioTurnIndex >= activeScenario.turns.length) {
        finishScenario();
        return;
      }

      const turn = activeScenario.turns[scenarioTurnIndex];
      const stage = getLearnerState() || 'starting';

      if (turn.type === 'setup' || turn.type === 'luna') {
        addAIMessage(resolveScenarioLunaText(turn));
        window.setTimeout(() => advanceScenarioTurn(), getTimingProfile('transition', speakTargetPhrase || '', stage));

      } else if (turn.type === 'response') {
        lastScenarioMatchedVariant = null;
        const phrase = turn.phrase;
        speakTargetPhrase = phrase;
        speakAttemptCount = 0;
        speakWeakAttempts = 0;
        speakSessionStruggled = false;
        speakSequenceIndex = 0;
        interactionCount = 0;
        hearAgainBtn.classList.remove('is-suggested');
        hideBeginnerHelp();
        speakSequence = speakPracticeSequences[phrase] || [];
        showPhraseContext(phrase);
        const step = speakSequence[0];
        const staged = (step && !step.done) ? buildStageCue(step, stage, phrase) : null;
        if (staged) {
          window.setTimeout(() => addAIMessage(staged.cue, staged.coach, true, staged.meaning),
            getTimingProfile('first_cue', phrase, stage));
        }
        // Flow pauses here — resumes via advanceScenarioTurn() when done:true fires in success path
      }
    }

    function finishScenario() {
      const scenario = activeScenario;
      activeScenario = null;
      scenarioTurnIndex = -1;
      markScenarioDone(scenario.id);

      // Capture chain-completion context before any state clearing
      const _wasChained = wasAssistChainedScenario;
      const _chainedPhrase = assistChainedPhrase;
      const _chainedCategory = assistChainedCategory;
      const _chainedTone = _wasChained ? (scenario.tone || '') : '';
      const _chainedPressure = _wasChained ? assistChainedPressure : '';

      if (scenario.source === 'assist') {
        const responseTurn = scenario.turns.find(t => t.type === 'response');
        if (responseTurn && responseTurn.phrase) {
          markAssistScenarioUsed(responseTurn.phrase);
          const responseRecord = scenarioMemory.responses && scenarioMemory.responses.find(r => r.target === responseTurn.phrase);
          const wasCorrect = !!(responseRecord && (responseRecord.exact || responseRecord.matched));
          recordAssistLearningResult(responseTurn.phrase, wasCorrect);
        }
      }
      sessionState.lastMode = 'scenario';
      sessionState.lastResult = 'success';
      sessionState.lastPhrase = speakTargetPhrase;
      const outroText = typeof scenario.outro === 'function'
        ? scenario.outro(scenarioMemory)
        : scenario.outro;
      addAIMessage(outroText);

      if (_wasChained && _chainedPhrase) {
        // Determine performance from scenario response record
        const _rec = scenarioMemory.responses && scenarioMemory.responses.find(r => r.target === _chainedPhrase);
        const _perf = (_rec && (_rec.exact || _rec.matched)) ? 'clean' : 'struggled';
        recordAssistContextUse(_chainedPhrase);
        wasAssistChainedScenario = false;
        assistChainedPhrase = '';
        assistChainedCategory = '';
        assistChainedPressure = '';
        window.setTimeout(() => {
          const _r = getAssistPostScenarioReinforcement(_chainedPhrase, _chainedCategory, _perf, _chainedTone, _chainedPressure);
          addAIMessage(_r.message + ' ' + _r.nextPrompt, '', true);
