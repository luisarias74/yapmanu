/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LaLanguishVoice = root.LaLanguishVoice || {};
    root.LaLanguishVoice.speechRecognitionAdapter = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function noop() {}

  function createSpeechRecognitionAdapter(options) {
    options = options || {};

    var rootRef = options.root || (typeof window !== 'undefined' ? window : null);
    var transcriptNormalizer = typeof options.normalizeTranscript === 'function'
      ? options.normalizeTranscript
      : function (value) { return String(value || '').trim(); };

    var callbacks = {
      onStart: typeof options.onStart === 'function' ? options.onStart : noop,
      onTranscript: typeof options.onTranscript === 'function' ? options.onTranscript : noop,
      onNoTranscript: typeof options.onNoTranscript === 'function' ? options.onNoTranscript : noop,
      onError: typeof options.onError === 'function' ? options.onError : noop,
      onEnd: typeof options.onEnd === 'function' ? options.onEnd : noop,
      onUnsupported: typeof options.onUnsupported === 'function' ? options.onUnsupported : noop
    };

    var recognitionInstance = null;
    var listening = false;
    var transcript = '';

    function getSpeechRecognitionCtor() {
      if (!rootRef) return null;
      return rootRef.SpeechRecognition || rootRef.webkitSpeechRecognition || null;
    }

    function isSupported() {
      return !!getSpeechRecognitionCtor();
    }

    function isListening() {
      return listening;
    }

    function resetState() {
      listening = false;
      recognitionInstance = null;
    }

    function extractTranscript(event) {
      var raw = '';
      try {
        raw = (((event || {}).results || [])[0] || [])[0].transcript || '';
      } catch (_) {
        raw = '';
      }
      return transcriptNormalizer(String(raw).trim());
    }

    function stopListening() {
      if (!recognitionInstance) {
        listening = false;
        return false;
      }

      try {
        recognitionInstance.stop();
        return true;
      } catch (_) {
        resetState();
        return false;
      }
    }

    function startListening() {
      var SpeechRecognitionCtor;

      if (!isSupported()) {
        resetState();
        callbacks.onUnsupported({
          type: 'unsupported'
        });
        return {
          started: false,
          reason: 'unsupported'
        };
      }

      if (listening) {
        return {
          started: false,
          reason: 'already_listening'
        };
      }

      SpeechRecognitionCtor = getSpeechRecognitionCtor();
      recognitionInstance = new SpeechRecognitionCtor();
      transcript = '';
      listening = true;

      recognitionInstance.lang = options.lang || 'en-US';
      recognitionInstance.interimResults = false;
      recognitionInstance.maxAlternatives = 1;

      recognitionInstance.onstart = function () {
        callbacks.onStart({
          type: 'start'
        });
      };

      recognitionInstance.onresult = function (event) {
        transcript = extractTranscript(event);
        listening = false;
        callbacks.onTranscript({
          type: 'transcript',
          transcript: transcript,
          rawEvent: event
        });
      };

      recognitionInstance.onerror = function (event) {
        resetState();
        callbacks.onError({
          type: 'error',
          error: event && event.error ? event.error : null,
          rawEvent: event
        });
      };

      recognitionInstance.onend = function (event) {
        var finalTranscript = transcript;
        resetState();
        callbacks.onEnd({
          type: 'end',
          transcript: finalTranscript,
          hadTranscript: !!finalTranscript,
          rawEvent: event
        });
        if (!finalTranscript) {
          callbacks.onNoTranscript({
            type: 'no_transcript'
          });
        }
      };

      try {
        recognitionInstance.start();
        return {
          started: true
        };
      } catch (error) {
        resetState();
        callbacks.onError({
          type: 'error',
          error: error,
          rawEvent: null
        });
        return {
          started: false,
          reason: 'start_failed',
          error: error
        };
      }
    }

    return {
      createSpeechRecognitionAdapter: createSpeechRecognitionAdapter,
      startListening: startListening,
      stopListening: stopListening,
      isSupported: isSupported,
      isListening: isListening
    };
  }

  return {
    createSpeechRecognitionAdapter: createSpeechRecognitionAdapter
  };
}));
