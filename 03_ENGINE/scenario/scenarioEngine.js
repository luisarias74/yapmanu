/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LaLanguishEngines = root.LaLanguishEngines || {};
    root.LaLanguishEngines.scenarioEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function cloneObject(value) {
    return value && typeof value === 'object' ? Object.assign({}, value) : {};
  }

  // From index.final.html approx. lines 4201-4232.
  function startScenarioSession(input) {
    var scenarioId = input && input.scenarioId;
    var scenarioLibrary = cloneArray(input && input.scenarioLibrary);
    var state = cloneObject(input && input.state);
    var scenario = null;
    var index;

    for (index = 0; index < scenarioLibrary.length; index += 1) {
      if (scenarioLibrary[index] && scenarioLibrary[index].id === scenarioId) {
        scenario = scenarioLibrary[index];
        break;
      }
    }

    if (!scenario) {
      return {
        found: false,
        fallback: {
          type: 'start_new_speak_session',
          phrase: null
        },
        effects: [{
          type: 'start_new_speak_session',
          phrase: null
        }]
      };
    }

    return {
      found: true,
      scenario: scenario,
      state: Object.assign({}, state, {
        isAssistPractice: false,
        assistPracticePhrase: '',
        assistPracticeCategory: '',
        activeScenario: scenario,
        scenarioTurnIndex: -1,
        lastScenarioMatchedVariant: null,
        scenarioMemory: {},
        speakUsedPhrases: [],
        speakAttemptCount: 0,
        speakWeakAttempts: 0,
        speakSessionStruggled: false,
        speakSequenceIndex: 0,
        speakTargetPhrase: '',
        speakSequence: [],
        interactionCount: 0
      }),
      effects: [
        { type: 'session_complete_visibility', visible: false },
        { type: 'clear_messages' },
        { type: 'set_speak_mode_label', label: 'Scenario Mode' },
        { type: 'show_phrase_context', phrase: '' },
        { type: 'cancel_timer', timer: 'speakNextStepTimer' },
        { type: 'set_luna_state', state: 'idle' },
        { type: 'schedule_advance_scenario_turn', delay: 650 }
      ]
    };
  }

  // From index.final.html approx. lines 4235-4271.
  function advanceScenarioTurn(input) {
    var state = cloneObject(input && input.state);
    var activeScenario = state.activeScenario;
    var getLearnerState = input && input.getLearnerState;
    var resolveScenarioLunaText = input && input.resolveScenarioLunaText;
    var getTimingProfile = input && input.getTimingProfile;
    var speakPracticeSequences = cloneObject(input && input.speakPracticeSequences);
    var buildStageCue = input && input.buildStageCue;
    var effects = [];
    var scenarioTurnIndex;
    var turn;
    var stage;
    var phrase;
    var step;
    var stagedCue;

    if (!activeScenario) {
      return {
        state: state,
        advanced: false,
        effects: effects
      };
    }

    scenarioTurnIndex = (typeof state.scenarioTurnIndex === 'number' ? state.scenarioTurnIndex : -1) + 1;
    state.scenarioTurnIndex = scenarioTurnIndex;

    if (scenarioTurnIndex >= cloneArray(activeScenario.turns).length) {
      return {
        state: state,
        advanced: true,
        completed: true,
        effects: [{
          type: 'finish_scenario'
        }]
      };
    }

    turn = activeScenario.turns[scenarioTurnIndex];
    stage = typeof getLearnerState === 'function' ? (getLearnerState() || 'starting') : 'starting';

    if (turn.type === 'setup' || turn.type === 'luna') {
      effects.push({
        type: 'add_ai_message',
        message: typeof resolveScenarioLunaText === 'function' ? resolveScenarioLunaText(turn) : turn.text
      });
      effects.push({
        type: 'schedule_advance_scenario_turn',
        delay: typeof getTimingProfile === 'function'
          ? getTimingProfile('transition', state.speakTargetPhrase || '', stage)
          : null
      });
      return {
        state: state,
        advanced: true,
        stage: stage,
        turn: turn,
        effects: effects
      };
    }

    if (turn.type === 'response') {
      phrase = turn.phrase;
      state.lastScenarioMatchedVariant = null;
      state.speakTargetPhrase = phrase;
      state.speakAttemptCount = 0;
      state.speakWeakAttempts = 0;
      state.speakSessionStruggled = false;
      state.speakSequenceIndex = 0;
      state.interactionCount = 0;
      state.speakSequence = cloneArray(speakPracticeSequences[phrase] || []);
      step = state.speakSequence[0];
      stagedCue = step && !step.done && typeof buildStageCue === 'function'
        ? buildStageCue(step, stage, phrase)
        : null;

      effects.push({ type: 'hear_again_suggested', suggested: false });
      effects.push({ type: 'hide_beginner_help' });
      effects.push({ type: 'show_phrase_context', phrase: phrase });

      if (stagedCue) {
        effects.push({
          type: 'schedule_stage_cue',
          delay: typeof getTimingProfile === 'function' ? getTimingProfile('first_cue', phrase, stage) : null,
          cue: stagedCue
        });
      }
    }

    return {
      state: state,
      advanced: true,
      stage: stage,
      turn: turn,
      effects: effects
    };
  }

  // From index.final.html approx. lines 4274-4320.
  function finishScenario(input) {
    var state = cloneObject(input && input.state);
    var scenario = state.activeScenario;
    var scenarioMemory = cloneObject(state.scenarioMemory);
    var sessionState = cloneObject(input && input.sessionState);
    var effects = [];
    var responseTurn;
    var responseRecord;
    var wasCorrect;
    var chainedResponse;
    var performance;
    var outroText;

    if (!scenario) {
      return {
        state: state,
        sessionState: sessionState,
        completed: false,
        effects: effects
      };
    }

    state.activeScenario = null;
    state.scenarioTurnIndex = -1;

    effects.push({
      type: 'mark_scenario_done',
      scenarioId: scenario.id
    });

    if (scenario.source === 'assist') {
      responseTurn = cloneArray(scenario.turns).find(function (turn) {
        return turn.type === 'response';
      });

      if (responseTurn && responseTurn.phrase) {
        responseRecord = cloneArray(scenarioMemory.responses).find(function (record) {
          return record.target === responseTurn.phrase;
        });
        wasCorrect = !!(responseRecord && (responseRecord.exact || responseRecord.matched));

        effects.push({
          type: 'mark_assist_scenario_used',
          phrase: responseTurn.phrase
        });
        effects.push({
          type: 'record_assist_learning_result',
          phrase: responseTurn.phrase,
          wasCorrect: wasCorrect
        });
      }
    }

    sessionState.lastMode = 'scenario';
    sessionState.lastResult = 'success';
    sessionState.lastPhrase = state.speakTargetPhrase;

    outroText = typeof scenario.outro === 'function'
      ? scenario.outro(scenarioMemory)
      : scenario.outro;

    effects.push({
      type: 'add_ai_message',
      message: outroText
    });

    if (state.wasAssistChainedScenario && state.assistChainedPhrase) {
      chainedResponse = cloneArray(scenarioMemory.responses).find(function (record) {
        return record.target === state.assistChainedPhrase;
      });
      performance = chainedResponse && (chainedResponse.exact || chainedResponse.matched)
        ? 'clean'
        : 'struggled';

      effects.push({
        type: 'record_assist_context_use',
        phrase: state.assistChainedPhrase
      });
      effects.push({
        type: 'schedule_post_scenario_reinforcement',
        delay: 2800,
        args: {
          phrase: state.assistChainedPhrase,
          category: state.assistChainedCategory,
          performance: performance,
          tone: scenario.tone || '',
          pressure: state.assistChainedPressure
        }
      });
      effects.push({
        type: 'schedule_return_home',
        delay: 4800
      });

      state.wasAssistChainedScenario = false;
      state.assistChainedPhrase = '';
      state.assistChainedCategory = '';
      state.assistChainedPressure = '';
    } else {
      effects.push({
        type: 'schedule_return_home',
        delay: 2800
      });
    }

    return {
      state: state,
      sessionState: sessionState,
      scenarioMemory: scenarioMemory,
      completed: true,
      effects: effects
    };
  }

  return {
    startScenarioSession: startScenarioSession,
    advanceScenarioTurn: advanceScenarioTurn,
    finishScenario: finishScenario
  };
}));
