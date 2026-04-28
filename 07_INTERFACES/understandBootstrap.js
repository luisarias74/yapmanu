/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./understandController.js'),
      require('../06_VOICE/mic/speechRecognitionAdapter.js')
    );
  } else {
    root.LaLanguishUnderstandBootstrap = factory(
      root.LaLanguishControllers && root.LaLanguishControllers.understandController,
      root.LaLanguishVoice && root.LaLanguishVoice.speechRecognitionAdapter
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (understandControllerModule, speechRecognitionModule) {
  'use strict';

  function noop() {}

  function safeFn(fn, fallback) {
    return typeof fn === 'function' ? fn : (fallback || noop);
  }

  function init(config) {
    config = config || {};

    var controller = understandControllerModule;
    var speechFactory = speechRecognitionModule && speechRecognitionModule.createSpeechRecognitionAdapter;
    var lessonPool = Array.isArray(config.lessonPool) ? config.lessonPool : [];
    var normalizeTranscript = safeFn(config.normalizeTranscript, function (value) {
      return String(value || '').trim();
    });

    if (!controller || typeof controller.initUnderstandController !== 'function') {
      throw new Error('Understand controller bootstrap requires understandController.js to be loaded first.');
    }

    if (!speechFactory) {
      throw new Error('Understand controller bootstrap requires speechRecognitionAdapter.js to be loaded first.');
    }

    controller.initUnderstandController({
      root: config.root || root.document,
      lessonPool: lessonPool,
      sessionState: config.sessionState || null,
      updatePhraseMastery: config.updatePhraseMastery || null,
      returnToHome: config.returnToHome || null
    });

    var harness = controller.createUnderstandMicHarness();
    var micAdapter = speechFactory({
      root: root,
      normalizeTranscript: normalizeTranscript,
      onStart: harness.onStart,
      onTranscript: harness.onTranscript,
      onNoTranscript: harness.onNoTranscript,
      onError: harness.onError,
      onEnd: harness.onEnd,
      onUnsupported: harness.onUnsupported
    });

    controller.attachUnderstandMicAdapter(micAdapter, harness);

    var debug = {
      active: true,
      controller: controller,
      micAdapter: micAdapter,
      micHarness: harness,
      requestMic: safeFn(controller.requestUnderstandMicController),
      startLesson: safeFn(controller.startUnderstandLessonController),
      listen: safeFn(controller.handleUnderstandListenController),
      reveal: safeFn(controller.handleUnderstandRevealController),
      check: safeFn(controller.handleUnderstandCheckController),
      next: safeFn(controller.handleUnderstandNextController),
      reflect: safeFn(controller.handleUnderstandReflectionController),
      state: safeFn(controller.getUnderstandControllerState)
    };

    root.LaLanguishUnderstandDebug = debug;
    console.log('Understand controller bootstrap loaded');
    return debug;
  }

  return {
    init: init
  };
}));
