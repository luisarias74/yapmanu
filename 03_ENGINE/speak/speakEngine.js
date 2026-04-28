/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LaLanguishEngines = root.LaLanguishEngines || {};
    root.LaLanguishEngines.speakEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function cloneObject(value) {
    return value && typeof value === 'object' ? Object.assign({}, value) : {};
  }

  function defaultPick(list, randomFn) {
    if (!Array.isArray(list) || list.length === 0) return null;
    var rand = typeof randomFn === 'function' ? randomFn : Math.random;
    return list[Math.floor(rand() * list.length)];
  }

  // From index.final.html approx. lines 4079-4107.
  function pickNextSpeakPhrase(input) {
    var speakPhrasePool = cloneArray(input && input.speakPhrasePool);
    var speakUsedPhrases = cloneArray(input && input.speakUsedPhrases);
    var speakTargetPhrase = input && input.speakTargetPhrase || '';
    var getPhraseMastery = input && input.getPhraseMastery;
    var getAssistLearningEntry = input && input.getAssistLearningEntry;
    var randomFn = input && input.randomFn;
    var masteryWeights = { 0: 8, 1: 6, 2: 4, 3: 2, 4: 1 };
    var almBoostMap = { 0: 6, 1: 4, 2: 2, 3: 0 };
    var candidates = speakPhrasePool.filter(function (phrase) {
      return speakUsedPhrases.indexOf(phrase) === -1;
    });

    if (candidates.length === 0) {
      speakUsedPhrases = speakTargetPhrase ? [speakTargetPhrase] : [];
      candidates = speakPhrasePool.filter(function (phrase) {
        return speakUsedPhrases.indexOf(phrase) === -1;
      });
      if (candidates.length === 0) {
        return {
          phrase: speakPhrasePool[0] || '',
          candidates: candidates,
          weightedPool: cloneArray(speakPhrasePool[0] ? [speakPhrasePool[0]] : []),
          resetUsedPhrasesTo: speakUsedPhrases
        };
      }
    }

    var weighted = [];
    candidates.forEach(function (phrase) {
      var mastery = typeof getPhraseMastery === 'function' ? getPhraseMastery(phrase) : 0;
      var base = masteryWeights[mastery] || 1;
      var almEntry = typeof getAssistLearningEntry === 'function' ? getAssistLearningEntry(phrase) : null;
      var assistBoost = almEntry ? (almBoostMap[almEntry.masteryLevel] || 0) : 0;
      var weight = base + assistBoost;
      var index;
      for (index = 0; index < weight; index += 1) {
        weighted.push(phrase);
      }
    });

    return {
      phrase: defaultPick(weighted, randomFn),
      candidates: candidates,
      weightedPool: weighted,
      resetUsedPhrasesTo: speakUsedPhrases
    };
  }

  function buildPracticeResetPatch(nextPhrase, sequence) {
    return {
      speakTargetPhrase: nextPhrase,
      speakAttemptCount: 0,
      speakWeakAttempts: 0,
      speakSessionStruggled: false,
      speakSequenceIndex: 0,
      interactionCount: 0,
      speakSequence: cloneArray(sequence)
    };
  }

  // From index.final.html approx. lines 4110-4157.
  function startNextPhrase(input) {
    var state = cloneObject(input && input.state);
    var sequenceMap = cloneObject(input && input.speakPracticeSequences);
    var getMasteryTransition = input && input.getMasteryTransition;
    var getAssistLearningEntry = input && input.getAssistLearningEntry;
    var clearAssistChainState = input && input.clearAssistChainState;
    var getLearnerState = input && input.getLearnerState;
    var buildStageCue = input && input.buildStageCue;
    var getTimingProfile = input && input.getTimingProfile;
    var pick = input && input.pick;
    var randomFn = input && input.randomFn;
    var transitions = [
      'Nice. Let\'s try a new one.',
      'Good. Moving on.',
      'Keep going — new phrase:'
    ];
    var selection = pickNextSpeakPhrase({
      speakPhrasePool: input && input.speakPhrasePool,
      speakUsedPhrases: state.speakUsedPhrases,
      speakTargetPhrase: state.speakTargetPhrase,
      getPhraseMastery: input && input.getPhraseMastery,
      getAssistLearningEntry: getAssistLearningEntry,
      randomFn: randomFn
    });
    var nextPhrase = selection.phrase;
    var memTransition = typeof getMasteryTransition === 'function' ? getMasteryTransition(nextPhrase) : null;
    var assistEntry = typeof getAssistLearningEntry === 'function' ? getAssistLearningEntry(nextPhrase) : null;
    var assistRef = null;
    var usedPhrases = cloneArray(selection.resetUsedPhrasesTo);
    var stage;
    var firstStep;
    var stagedCue;
    var effects = [];
    var nextState;

    if (!memTransition && assistEntry && (typeof randomFn === 'function' ? randomFn() : Math.random()) < 0.5) {
      assistRef = assistEntry.timesPracticed === 0
        ? (typeof pick === 'function'
            ? pick(['You looked this one up earlier.', 'Let\'s practice what you asked about.'])
            : defaultPick(['You looked this one up earlier.', 'Let\'s practice what you asked about.'], randomFn))
        : (typeof pick === 'function'
            ? pick(['You asked about this one earlier.', 'Let\'s come back to this one.'])
            : defaultPick(['You asked about this one earlier.', 'Let\'s come back to this one.'], randomFn));
    }

    usedPhrases.push(nextPhrase);
    state.speakUsedPhrases = usedPhrases;
    nextState = Object.assign(
      {},
      state,
      buildPracticeResetPatch(nextPhrase, sequenceMap[nextPhrase] || []),
      {
        speakUsedPhrases: usedPhrases,
        isAssistPractice: false,
        assistPracticePhrase: '',
        assistPracticeCategory: ''
      }
    );

    if (!state.isAssistPractice) {
      nextState.isAssistPractice = !!state.isAssistPractice;
      nextState.assistPracticePhrase = state.assistPracticePhrase || '';
      nextState.assistPracticeCategory = state.assistPracticeCategory || '';
    } else if (typeof clearAssistChainState === 'function') {
      Object.assign(nextState, clearAssistChainState(state));
    }

    stage = typeof getLearnerState === 'function' ? (getLearnerState() || 'starting') : 'starting';
    firstStep = nextState.speakSequence[0] || null;
    stagedCue = firstStep && !firstStep.done && typeof buildStageCue === 'function'
      ? buildStageCue(firstStep, stage, nextPhrase)
      : null;

    effects.push({
      type: 'session_complete_visibility',
      visible: false
    });
    effects.push({
      type: 'hear_again_suggested',
      suggested: false
    });
    effects.push({
      type: 'show_phrase_context',
      phrase: nextPhrase
    });
    effects.push({
      type: 'cancel_timer',
      timer: 'speakPhraseTransitionTimer'
    });
    effects.push({
      type: 'schedule_message',
      delay: typeof getTimingProfile === 'function' ? getTimingProfile('transition', nextPhrase, stage) : null,
      message: assistRef || memTransition || transitions[usedPhrases.length % transitions.length]
    });

    if (stagedCue) {
      effects.push({
        type: 'schedule_stage_cue',
        delay: typeof getTimingProfile === 'function' ? getTimingProfile('first_cue', nextPhrase, stage) : null,
        cue: stagedCue
      });
    }

    return {
      state: nextState,
      nextPhrase: nextPhrase,
      stage: stage,
      stagedCue: stagedCue,
      phraseSelection: selection,
      effects: effects
    };
  }

  // From index.final.html approx. lines 4159-4197.
  function startNewSpeakSession(input) {
    var requestedPhrase = input && input.phrase;
    var state = cloneObject(input && input.state);
    var speakPracticeSequences = cloneObject(input && input.speakPracticeSequences);
    var getLearnerState = input && input.getLearnerState;
    var buildStageCue = input && input.buildStageCue;
    var getTimingProfile = input && input.getTimingProfile;
    var initialPhrase = requestedPhrase && speakPracticeSequences[requestedPhrase]
      ? requestedPhrase
      : pickNextSpeakPhrase({
          speakPhrasePool: input && input.speakPhrasePool,
          speakUsedPhrases: [],
          speakTargetPhrase: '',
          getPhraseMastery: input && input.getPhraseMastery,
          getAssistLearningEntry: input && input.getAssistLearningEntry,
          randomFn: input && input.randomFn
        }).phrase;
    var intros = {
      starting: 'Hi Luis… ready to practice?',
      building: 'Let\'s keep going.',
      settling: 'Ready when you are.',
      ready_more: null
    };
    var nextState = Object.assign({}, state, buildPracticeResetPatch(initialPhrase, speakPracticeSequences[initialPhrase] || []), {
      speakUsedPhrases: [initialPhrase]
    });
    var stage = typeof getLearnerState === 'function' ? (getLearnerState() || 'starting') : 'starting';
    var step = nextState.speakSequence[0];
    var stagedCue = step && !step.done && typeof buildStageCue === 'function'
      ? buildStageCue(step, stage, initialPhrase)
      : null;
    var introMessage = Object.prototype.hasOwnProperty.call(intros, stage)
      ? intros[stage]
      : intros.starting;
    var effects = [
      { type: 'session_complete_visibility', visible: false },
      { type: 'clear_messages' },
      { type: 'set_speak_mode_label', label: 'Speak Mode' },
      { type: 'show_phrase_context', phrase: initialPhrase },
      { type: 'cancel_timer', timer: 'speakNextStepTimer' },
      { type: 'set_luna_state', state: 'idle' }
    ];

    effects.push({
      type: 'schedule_session_open',
      delay: 650,
      introMessage: introMessage,
      stagedCue: stagedCue,
      stagedCueDelay: stagedCue && typeof getTimingProfile === 'function'
        ? getTimingProfile('session_start', initialPhrase, stage)
        : null
    });

    return {
      state: nextState,
      firstPhrase: initialPhrase,
      stage: stage,
      introMessage: introMessage,
      stagedCue: stagedCue,
      effects: effects
    };
  }

  return {
    pickNextSpeakPhrase: pickNextSpeakPhrase,
    startNextPhrase: startNextPhrase,
    startNewSpeakSession: startNewSpeakSession
  };
}));
