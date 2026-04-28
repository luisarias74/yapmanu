/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LaLanguishEngines = root.LaLanguishEngines || {};
    root.LaLanguishEngines.understandEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function cloneObject(value) {
    return value && typeof value === 'object' ? Object.assign({}, value) : {};
  }

  // From index.final.html approx. lines 3088-3094.
  function normalizeRepeatText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Logic extracted from renderUnderstandKeywords() approx. lines 4366-4388.
  function buildUnderstandKeywords(lesson, activeTarget) {
    var words = (lesson && lesson.phrase ? lesson.phrase : '')
      .split(' ')
      .map(function (word) { return word.trim(); })
      .filter(Boolean)
      .filter(function (word, index, arr) { return arr.indexOf(word) === index; });

    return words.map(function (word) {
      return {
        word: word,
        active: word === activeTarget
      };
    });
  }

  // Logic extracted from the click-handler inside renderUnderstandKeywords() approx. lines 4379-4385.
  function selectUnderstandKeyword(input) {
    var word = input && input.word || '';
    var lesson = input && input.lesson || null;

    return {
      practiceTarget: word,
      practiceAttempts: 0,
      keywords: buildUnderstandKeywords(lesson, word),
      ui: {
        practiceCopy: 'Now say it. Or repeat: "' + word + '".',
        inputPlaceholder: 'Say or type "' + word + '"...'
      }
    };
  }

  // From index.final.html approx. lines 4391-4400.
  function resetUnderstandPractice(input) {
    var lesson = input && input.lesson || null;
    var practiceTarget = lesson ? lesson.phrase : '';

    return {
      practiceTarget: practiceTarget,
      practiceAttempts: 0,
      keywords: buildUnderstandKeywords(lesson, practiceTarget),
      ui: {
        inputValue: '',
        inputPlaceholder: 'Say it or type it softly...',
        practiceCopy: 'Now say it.',
        practiceHidden: true,
        nextActionsHidden: true
      }
    };
  }

  // From index.final.html approx. lines 4402-4406.
  function finishUnderstandPractice(canAdvance) {
    return {
      canAdvance: !!canAdvance,
      ui: {
        nextActionsHidden: !canAdvance
      }
    };
  }

  // From index.final.html approx. lines 4408-4432.
  function runUnderstandPracticeCheck(input) {
    var text = input && input.text;
    var practiceTarget = input && input.practiceTarget || '';
    var practiceAttempts = input && input.practiceAttempts || 0;
    var heard = normalizeRepeatText(text);
    var target = normalizeRepeatText(practiceTarget);
    var strong = !!(target && (heard === target || heard.indexOf(target) !== -1 || target.indexOf(heard) !== -1));
    var nextAttempts = practiceAttempts;

    if (!heard) {
      return {
        accepted: false,
        ignored: true,
        practiceAttempts: nextAttempts,
        effects: []
      };
    }

    if (strong) {
      return {
        accepted: true,
        strong: true,
        practiceAttempts: nextAttempts,
        lunaState: { state: 'speaking', subtitle: 'Good.' },
        ui: { feedback: 'Good.' },
        effects: [finishUnderstandPractice(true)]
      };
    }

    nextAttempts += 1;
    if (nextAttempts < 2) {
      return {
        accepted: false,
        strong: false,
        practiceAttempts: nextAttempts,
        lunaState: { state: 'idle', subtitle: 'Say it clearly.' },
        ui: { feedback: 'Say it clearly.' },
        effects: []
      };
    }

    return {
      accepted: true,
      strong: false,
      practiceAttempts: nextAttempts,
      lunaState: { state: 'idle', subtitle: 'Good. Keep it in mind.' },
      ui: { feedback: 'Good. Keep it in mind.' },
      effects: [finishUnderstandPractice(true)]
    };
  }

  // From index.final.html approx. lines 4478-4497.
  function startNewUnderstandLesson(input) {
    var lessonPool = cloneArray(input && input.lessonPool);
    var randomFn = input && input.randomFn;
    var lesson = lessonPool.length
      ? lessonPool[Math.floor((typeof randomFn === 'function' ? randomFn() : Math.random()) * lessonPool.length)]
      : null;
    var reset = resetUnderstandPractice({ lesson: lesson });

    return {
      lesson: lesson,
      practiceTarget: reset.practiceTarget,
      practiceAttempts: reset.practiceAttempts,
      keywords: reset.keywords,
      lunaState: { state: 'idle', subtitle: 'Ready when you are.' },
      ui: {
        phraseText: 'Listen first',
        phrasePlaceholder: true,
        meaningText: lesson ? 'Meaning: ' + lesson.meaning : 'Meaning:',
        meaningHidden: true,
        meaningButtonHidden: true,
        reflectActionsHidden: true,
        listenActionsHidden: false,
        listenButtonDisabled: false,
        listenButtonText: 'Listen',
        feedback: 'Tap Listen to hear the phrase.'
      },
      effects: [
        { type: 'cancel_timer', timer: 'understandPlayTimer' },
        reset
      ]
    };
  }

  // Logic extracted from understandListenBtn click handler approx. lines 4522-4537.
  function beginUnderstandPlayback(input) {
    var lesson = input && input.lesson || null;

    return {
      lesson: lesson,
      lunaState: { state: 'speaking', subtitle: 'Listen closely.' },
      ui: {
        listenButtonDisabled: true,
        listenButtonText: 'Playing...',
        feedback: 'Hear it softly.'
      },
      effects: [{
        type: 'schedule_playback_complete',
        delay: 1800,
        payload: revealUnderstoodPhrase({ lesson: lesson })
      }]
    };
  }

  // Logic extracted from understandListenBtn timeout body approx. lines 4528-4536.
  function revealUnderstoodPhrase(input) {
    var lesson = input && input.lesson || null;

    return {
      lesson: lesson,
      lunaState: { state: 'idle', subtitle: 'How did that feel?' },
      ui: {
        phraseText: lesson ? lesson.phrase : '',
        phrasePlaceholder: false,
        meaningButtonHidden: false,
        feedback: 'Tap Show meaning when ready, or listen again.',
        listenButtonDisabled: false,
        listenButtonText: 'Listen'
      }
    };
  }

  // Logic extracted from understandMeaningBtn click handler approx. lines 4540-4548.
  function revealUnderstandMeaning() {
    return {
      lunaState: { state: 'idle', subtitle: 'Now say it.' },
      ui: {
        meaningHidden: false,
        meaningButtonHidden: true,
        practiceHidden: false,
        listenActionsHidden: false,
        reflectActionsHidden: true,
        feedback: 'Now say it.'
      }
    };
  }

  // Logic extracted from understandNextBtn click handler approx. lines 4566-4571.
  function moveToUnderstandReflection() {
    return {
      lunaState: { state: 'idle', subtitle: 'Take your time.' },
      ui: {
        nextActionsHidden: true,
        listenActionsHidden: true,
        reflectActionsHidden: false,
        feedback: 'Did that feel familiar?'
      }
    };
  }

  // From index.final.html approx. lines 4499-4519.
  function handleUnderstandReflection(input) {
    var understood = !!(input && input.understood);
    var lesson = input && input.lesson || null;
    var sessionState = cloneObject(input && input.sessionState);
    var reset;
    var effects = [];

    if (understood) {
      sessionState.lastMode = 'understand';
      sessionState.lastResult = 'success';
      sessionState.lastPhrase = lesson ? lesson.phrase : null;

      effects.push({
        type: 'update_phrase_mastery',
        phrase: lesson ? lesson.phrase : null,
        result: 'understand_success'
      });
      effects.push({
        type: 'schedule_return_home',
        delay: 1800
      });

      return {
        understood: true,
        sessionState: sessionState,
        lunaState: { state: 'speaking', subtitle: 'Good. That phrase is settling in.' },
        ui: { feedback: 'Nice. You recognized it clearly.' },
        effects: effects
      };
    }

    reset = resetUnderstandPractice({ lesson: lesson });
    effects.push(reset);

    return {
      understood: false,
      sessionState: sessionState,
      practiceTarget: reset.practiceTarget,
      practiceAttempts: reset.practiceAttempts,
      keywords: reset.keywords,
      lunaState: { state: 'idle', subtitle: 'No rush. Hear it one more time.' },
      ui: {
        feedback: 'That\'s okay. Take another listen.',
        reflectActionsHidden: true,
        meaningHidden: true,
        listenActionsHidden: false,
        meaningButtonHidden: true,
        listenButtonDisabled: false,
        listenButtonText: 'Listen again'
      },
      effects: effects
    };
  }

  return {
    normalizeRepeatText: normalizeRepeatText,
    buildUnderstandKeywords: buildUnderstandKeywords,
    selectUnderstandKeyword: selectUnderstandKeyword,
    resetUnderstandPractice: resetUnderstandPractice,
    finishUnderstandPractice: finishUnderstandPractice,
    runUnderstandPracticeCheck: runUnderstandPracticeCheck,
    startNewUnderstandLesson: startNewUnderstandLesson,
    beginUnderstandPlayback: beginUnderstandPlayback,
    revealUnderstoodPhrase: revealUnderstoodPhrase,
    revealUnderstandMeaning: revealUnderstandMeaning,
    moveToUnderstandReflection: moveToUnderstandReflection,
    handleUnderstandReflection: handleUnderstandReflection
  };
}));
