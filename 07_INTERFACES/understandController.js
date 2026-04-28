/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('../03_ENGINE/understand/understandEngine.js')
    );
  } else {
    root.LaLanguishControllers = root.LaLanguishControllers || {};
    root.LaLanguishControllers.understandController = factory(
      root.LaLanguishEngines && root.LaLanguishEngines.understandEngine
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (understandEngine) {
  'use strict';

  var DEFAULT_LESSON_POOL = [
    { phrase: 'I am tired', meaning: 'Estoy cansado' },
    { phrase: 'I am hungry', meaning: 'Tengo hambre' },
    { phrase: 'I am ready', meaning: 'Estoy listo' },
    { phrase: 'I feel good', meaning: 'Me siento bien' },
    { phrase: 'I need help', meaning: 'Necesito ayuda' }
  ];

  var controllerState = createInitialState();

  function createInitialState() {
    return {
      initialized: false,
      lessonPool: cloneArray(DEFAULT_LESSON_POOL),
      currentLesson: null,
      practiceTarget: '',
      practiceAttempts: 0,
      keywords: [],
      understandPlayTimer: null,
      understandRecognitionActive: false,
      dom: {},
      deps: {
        updatePhraseMastery: null,
        returnToHome: null,
        sessionState: null,
        onMicRequested: null,
        micAdapter: null,
        micHarness: null
      }
    };
  }

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function cloneObject(value) {
    return value && typeof value === 'object' ? Object.assign({}, value) : {};
  }

  function ensureEngine() {
    if (!understandEngine) {
      throw new Error('understandEngine is required before using understandController.');
    }
    return understandEngine;
  }

  function getRootDocument(customRoot) {
    if (customRoot && customRoot.document) return customRoot.document;
    if (customRoot && customRoot.getElementById) return customRoot;
    if (typeof document !== 'undefined') return document;
    return null;
  }

  function getDefaultDom(doc) {
    if (!doc) return {};
    return {
      lunaOrb: doc.getElementById('understand-luna-orb'),
      stateLabel: doc.getElementById('understand-state-label'),
      lunaSubtitle: doc.getElementById('understand-luna-subtitle'),
      phrase: doc.getElementById('understand-phrase'),
      meaning: doc.getElementById('understand-meaning'),
      feedback: doc.getElementById('understand-feedback'),
      listenBtn: doc.getElementById('understand-listen-btn'),
      meaningBtn: doc.getElementById('understand-meaning-btn'),
      listenActions: doc.getElementById('understand-listen-actions'),
      reflectActions: doc.getElementById('understand-reflect-actions'),
      practice: doc.getElementById('understand-practice'),
      practiceCopy: doc.getElementById('understand-practice-copy'),
      keywords: doc.getElementById('understand-keywords'),
      input: doc.getElementById('understand-input'),
      micBtn: doc.getElementById('understand-mic-btn'),
      checkBtn: doc.getElementById('understand-check-btn'),
      nextActions: doc.getElementById('understand-next-actions'),
      nextBtn: doc.getElementById('understand-next-btn'),
      yesBtn: doc.getElementById('understand-yes-btn'),
      notYetBtn: doc.getElementById('understand-notyet-btn'),
      homeBtn: doc.getElementById('understand-home-btn')
    };
  }

  function mergeState(patch) {
    if (!patch || typeof patch !== 'object') return controllerState;
    Object.keys(patch).forEach(function (key) {
      controllerState[key] = patch[key];
    });
    return controllerState;
  }

  function setUnderstandLunaState(state, subtitle) {
    var dom = controllerState.dom;
    if (dom.lunaOrb) dom.lunaOrb.className = 'luna-orb ' + state;
    if (dom.stateLabel) dom.stateLabel.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    if (dom.lunaSubtitle && subtitle) dom.lunaSubtitle.textContent = subtitle;
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle('hidden', !!hidden);
  }

  function applyStatePatch(patch) {
    if (!patch || typeof patch !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(patch, 'lesson')) {
      controllerState.currentLesson = patch.lesson;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'practiceTarget')) {
      controllerState.practiceTarget = patch.practiceTarget;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'practiceAttempts')) {
      controllerState.practiceAttempts = patch.practiceAttempts;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'keywords')) {
      controllerState.keywords = cloneArray(patch.keywords);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'understandRecognitionActive')) {
      controllerState.understandRecognitionActive = !!patch.understandRecognitionActive;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sessionState') && controllerState.deps.sessionState) {
      Object.assign(controllerState.deps.sessionState, patch.sessionState);
    }
  }

  function renderKeywordButtons(keywordDescriptors) {
    var dom = controllerState.dom;
    var doc = controllerState.dom.documentRef;

    if (!dom.keywords || !doc) return;

    dom.keywords.innerHTML = '';

    cloneArray(keywordDescriptors).forEach(function (descriptor) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'understand-keyword-btn' + (descriptor.active ? ' active' : '');
      button.textContent = descriptor.word;

      // Temporary compatibility glue:
      // the current app still relies on DOM buttons and click handlers.
      // Later this selection model should move into FlutterFlow action wiring.
      button.addEventListener('click', function () {
        var engine = ensureEngine();
        var result = engine.selectUnderstandKeyword({
          word: descriptor.word,
          lesson: controllerState.currentLesson
        });

        applyStatePatch(result);
        applyUnderstandUI(result.ui);
        renderKeywordButtons(result.keywords);
        focusUnderstandInput();
      });

      dom.keywords.appendChild(button);
    });
  }

  // Controller logic:
  // This is the one place where engine-style UI descriptors are translated
  // into the current DOM model. In a later platform migration, this mapper
  // should be replaced by FlutterFlow/Supabase-bound view actions.
  function applyUnderstandUI(ui) {
    var dom = controllerState.dom;
    if (!ui || typeof ui !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(ui, 'phraseText') && dom.phrase) {
      dom.phrase.textContent = ui.phraseText;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'phrasePlaceholder') && dom.phrase) {
      dom.phrase.classList.toggle('placeholder', !!ui.phrasePlaceholder);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'meaningText') && dom.meaning) {
      dom.meaning.textContent = ui.meaningText;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'meaningHidden')) {
      setHidden(dom.meaning, ui.meaningHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'feedback') && dom.feedback) {
      dom.feedback.textContent = ui.feedback;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'listenButtonDisabled') && dom.listenBtn) {
      dom.listenBtn.disabled = !!ui.listenButtonDisabled;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'listenButtonText') && dom.listenBtn) {
      dom.listenBtn.textContent = ui.listenButtonText;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'meaningButtonHidden')) {
      setHidden(dom.meaningBtn, ui.meaningButtonHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'listenActionsHidden')) {
      setHidden(dom.listenActions, ui.listenActionsHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'reflectActionsHidden')) {
      setHidden(dom.reflectActions, ui.reflectActionsHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'practiceHidden')) {
      setHidden(dom.practice, ui.practiceHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'nextActionsHidden')) {
      setHidden(dom.nextActions, ui.nextActionsHidden);
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'practiceCopy') && dom.practiceCopy) {
      dom.practiceCopy.textContent = ui.practiceCopy;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'inputPlaceholder') && dom.input) {
      dom.input.placeholder = ui.inputPlaceholder;
    }
    if (Object.prototype.hasOwnProperty.call(ui, 'inputValue') && dom.input) {
      dom.input.value = ui.inputValue;
    }
  }

  function focusUnderstandInput() {
    var dom = controllerState.dom;
    if (dom.input && typeof dom.input.focus === 'function') {
      dom.input.focus();
    }
  }

  function setRecognitionActive(active) {
    controllerState.understandRecognitionActive = !!active;
  }

  function applyMicRetryState(message) {
    setRecognitionActive(false);
    setUnderstandLunaState('idle', 'Try it one more time.');
    applyUnderstandUI({
      feedback: message
    });
  }

  function handleUnderstandMicUnsupported() {
    setRecognitionActive(false);
    setUnderstandLunaState('idle', 'Try it one more time.');
    applyUnderstandUI({
      feedback: 'Type it if your browser does not support the mic.'
    });
    focusUnderstandInput();

    return {
      supported: false,
      handled: true
    };
  }

  function handleUnderstandMicNoTranscript() {
    applyMicRetryState('Say it clearly.');
    return {
      handled: true,
      reason: 'no_transcript'
    };
  }

  function handleUnderstandMicError(errorEvent) {
    applyMicRetryState('Type it if the mic missed you.');
    return {
      handled: true,
      reason: 'error',
      error: errorEvent || null
    };
  }

  function handleUnderstandMicStart() {
    setRecognitionActive(true);
    setUnderstandLunaState('listening', 'Now say it.');
    applyUnderstandUI({
      feedback: 'Listening...'
    });

    return {
      handled: true,
      listening: true
    };
  }

  function handleUnderstandMicEnd(event) {
    setRecognitionActive(false);
    return {
      handled: true,
      event: event || null
    };
  }

  function createUnderstandMicHarness(micAdapter) {
    var harness = {
      onStart: function () {
        return handleUnderstandMicStart();
      },
      onTranscript: function (event) {
        var transcript = event && event.transcript ? event.transcript : '';
        return handleUnderstandMicTranscriptController(transcript);
      },
      onNoTranscript: function () {
        return handleUnderstandMicNoTranscript();
      },
      onError: function (event) {
        return handleUnderstandMicError(event);
      },
      onEnd: function (event) {
        return handleUnderstandMicEnd(event);
      },
      onUnsupported: function () {
        return handleUnderstandMicUnsupported();
      }
    };

    if (micAdapter) {
      controllerState.deps.micAdapter = micAdapter;
    }
    controllerState.deps.micHarness = harness;
    return harness;
  }

  function attachUnderstandMicAdapter(micAdapter, existingHarness) {
    controllerState.deps.micAdapter = micAdapter || null;
    if (existingHarness) {
      controllerState.deps.micHarness = existingHarness;
      return existingHarness;
    }
    return createUnderstandMicHarness(micAdapter || null);
  }

  function scheduleTimeout(timerName, delay, fn) {
    var timerApi = (typeof window !== 'undefined') ? window : null;
    if (!timerApi || typeof timerApi.setTimeout !== 'function') return null;
    controllerState[timerName] = timerApi.setTimeout(function () {
      controllerState[timerName] = null;
      fn();
    }, delay);
    return controllerState[timerName];
  }

  function cancelTimeout(timerName) {
    var timerApi = (typeof window !== 'undefined') ? window : null;
    if (!timerApi || typeof timerApi.clearTimeout !== 'function') return;
    if (controllerState[timerName]) {
      timerApi.clearTimeout(controllerState[timerName]);
      controllerState[timerName] = null;
    }
  }

  // Controller logic:
  // Interprets the engine's effect list and converts it into the existing
  // imperative browser actions the current single-file app expects.
  function runUnderstandEffects(effects) {
    cloneArray(effects).forEach(function (effect) {
      if (!effect || typeof effect !== 'object') return;

      if (!effect.type) {
        applyStatePatch(effect);
        applyUnderstandUI(effect.ui);
        if (effect.keywords) renderKeywordButtons(effect.keywords);
        return;
      }

      if (effect.type === 'cancel_timer' && effect.timer === 'understandPlayTimer') {
        cancelTimeout('understandPlayTimer');
        return;
      }

      if (effect.type === 'schedule_playback_complete') {
        scheduleTimeout('understandPlayTimer', effect.delay, function () {
          if (effect.payload) {
            applyStatePatch(effect.payload);
            if (effect.payload.lunaState) {
              setUnderstandLunaState(effect.payload.lunaState.state, effect.payload.lunaState.subtitle);
            }
            applyUnderstandUI(effect.payload.ui);
          }
        });
        return;
      }

      if (effect.type === 'update_phrase_mastery') {
        if (typeof controllerState.deps.updatePhraseMastery === 'function') {
          controllerState.deps.updatePhraseMastery(effect.phrase, effect.result);
        }
        return;
      }

      if (effect.type === 'schedule_return_home') {
        scheduleTimeout('understandPlayTimer', effect.delay, function () {
          if (typeof controllerState.deps.returnToHome === 'function') {
            controllerState.deps.returnToHome();
          }
        });
        return;
      }

      if (effect.type === 'focus_input') {
        focusUnderstandInput();
        return;
      }

      if (effect.type === 'mic_fallback') {
        if (effect.ui) applyUnderstandUI(effect.ui);
        focusUnderstandInput();
        return;
      }

      if (effect.type === 'state_patch') {
        applyStatePatch(effect.patch || {});
        if (effect.patch && effect.patch.ui) applyUnderstandUI(effect.patch.ui);
      }
    });
  }

  function applyEngineResult(result) {
    if (!result || typeof result !== 'object') return result;

    applyStatePatch(result);

    if (result.lunaState) {
      setUnderstandLunaState(result.lunaState.state, result.lunaState.subtitle);
    }

    applyUnderstandUI(result.ui);

    if (result.keywords) {
      renderKeywordButtons(result.keywords);
    }

    runUnderstandEffects(result.effects);
    return result;
  }

  function initUnderstandController(options) {
    var doc = getRootDocument(options && options.root);
    var domOverrides = cloneObject(options && options.dom);
    var dom = Object.assign(getDefaultDom(doc), domOverrides);
    dom.documentRef = doc;

    ensureEngine();
    controllerState = createInitialState();
    mergeState({
      initialized: true,
      lessonPool: cloneArray((options && options.lessonPool) || DEFAULT_LESSON_POOL),
      dom: dom,
      deps: {
        updatePhraseMastery: options && options.updatePhraseMastery || null,
        returnToHome: options && options.returnToHome || null,
        sessionState: options && options.sessionState || null,
        onMicRequested: options && options.onMicRequested || null,
        micAdapter: options && options.micAdapter || null,
        micHarness: null
      }
    });

    if (controllerState.deps.micAdapter) {
      controllerState.deps.micHarness = createUnderstandMicHarness(controllerState.deps.micAdapter);
    }

    return getUnderstandControllerState();
  }

  function getUnderstandControllerState() {
    return {
      initialized: controllerState.initialized,
      lessonPool: cloneArray(controllerState.lessonPool),
      currentLesson: controllerState.currentLesson,
      practiceTarget: controllerState.practiceTarget,
      practiceAttempts: controllerState.practiceAttempts,
      keywords: cloneArray(controllerState.keywords),
      understandRecognitionActive: controllerState.understandRecognitionActive,
      hasMicAdapter: !!controllerState.deps.micAdapter
    };
  }

  function startUnderstandLessonController() {
    var engine = ensureEngine();
    return applyEngineResult(engine.startNewUnderstandLesson({
      lessonPool: controllerState.lessonPool,
      randomFn: Math.random
    }));
  }

  function handleUnderstandListenController() {
    var engine = ensureEngine();
    return applyEngineResult(engine.beginUnderstandPlayback({
      lesson: controllerState.currentLesson
    }));
  }

  function handleUnderstandRevealController() {
    var engine = ensureEngine();
    var result = engine.revealUnderstandMeaning();
    result.effects = cloneArray(result.effects).concat([{ type: 'focus_input' }]);
    return applyEngineResult(result);
  }

  function handleUnderstandCheckController(inputText) {
    var engine = ensureEngine();
    return applyEngineResult(engine.runUnderstandPracticeCheck({
      text: inputText,
      practiceTarget: controllerState.practiceTarget,
      practiceAttempts: controllerState.practiceAttempts
    }));
  }

  function handleUnderstandMicTranscriptController(transcript) {
    var cleanTranscript = String(transcript || '').trim();
    controllerState.understandRecognitionActive = false;

    if (!cleanTranscript) {
      setUnderstandLunaState('idle', 'Try it one more time.');
      applyUnderstandUI({
        feedback: 'Say it clearly.'
      });
      return {
        accepted: false,
        transcript: cleanTranscript,
        placeholder: true
      };
    }

    if (controllerState.dom.input) {
      controllerState.dom.input.value = cleanTranscript;
    }

    return handleUnderstandCheckController(cleanTranscript);
  }

  function handleUnderstandNextController() {
    var engine = ensureEngine();
    return applyEngineResult(engine.moveToUnderstandReflection());
  }

  function handleUnderstandReflectionController(understood) {
    var engine = ensureEngine();
    return applyEngineResult(engine.handleUnderstandReflection({
      understood: understood,
      lesson: controllerState.currentLesson,
      sessionState: controllerState.deps.sessionState || {}
    }));
  }

  function requestUnderstandMicController() {
    // Temporary compatibility glue:
    // the original app owns SpeechRecognition startup and browser permission flow.
    // This controller only exposes a safe hook so the adapter can be adopted
    // without replacing working mic behavior yet.
    if (controllerState.understandRecognitionActive) {
      return { delegated: true, alreadyActive: true };
    }

    if (controllerState.deps.micAdapter && typeof controllerState.deps.micAdapter.startListening === 'function') {
      handleUnderstandMicStart();
      return controllerState.deps.micAdapter.startListening();
    }

    if (typeof controllerState.deps.onMicRequested === 'function') {
      handleUnderstandMicStart();
      controllerState.deps.onMicRequested({
        lesson: controllerState.currentLesson,
        practiceTarget: controllerState.practiceTarget
      });
      return { delegated: true };
    }

    handleUnderstandMicUnsupported();

    return {
      delegated: false,
      placeholder: true
    };
  }

  return {
    initUnderstandController: initUnderstandController,
    getUnderstandControllerState: getUnderstandControllerState,
    startUnderstandLessonController: startUnderstandLessonController,
    handleUnderstandListenController: handleUnderstandListenController,
    handleUnderstandRevealController: handleUnderstandRevealController,
    handleUnderstandCheckController: handleUnderstandCheckController,
    handleUnderstandMicTranscriptController: handleUnderstandMicTranscriptController,
    handleUnderstandMicStart: handleUnderstandMicStart,
    handleUnderstandMicNoTranscript: handleUnderstandMicNoTranscript,
    handleUnderstandMicError: handleUnderstandMicError,
    handleUnderstandMicEnd: handleUnderstandMicEnd,
    handleUnderstandMicUnsupported: handleUnderstandMicUnsupported,
    handleUnderstandNextController: handleUnderstandNextController,
    handleUnderstandReflectionController: handleUnderstandReflectionController,
    requestUnderstandMicController: requestUnderstandMicController,
    createUnderstandMicHarness: createUnderstandMicHarness,
    attachUnderstandMicAdapter: attachUnderstandMicAdapter
  };
}));
