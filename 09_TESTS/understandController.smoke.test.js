const assert = require('assert');

const controller = require('../07_INTERFACES/understandController.js');

function createClassList() {
  const set = new Set();
  return {
    add(name) {
      set.add(name);
    },
    remove(name) {
      set.delete(name);
    },
    toggle(name, force) {
      if (force === true) set.add(name);
      else if (force === false) set.delete(name);
      else if (set.has(name)) set.delete(name);
      else set.add(name);
    },
    contains(name) {
      return set.has(name);
    }
  };
}

function createElement(id) {
  return {
    id: id,
    textContent: '',
    placeholder: '',
    value: '',
    disabled: false,
    className: '',
    type: '',
    children: [],
    listeners: {},
    focusCount: 0,
    innerHTML: '',
    classList: createClassList(),
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    },
    focus() {
      this.focusCount += 1;
    }
  };
}

function createMockDocument() {
  const ids = [
    'understand-luna-orb',
    'understand-state-label',
    'understand-luna-subtitle',
    'understand-phrase',
    'understand-meaning',
    'understand-feedback',
    'understand-listen-btn',
    'understand-meaning-btn',
    'understand-listen-actions',
    'understand-reflect-actions',
    'understand-practice',
    'understand-practice-copy',
    'understand-keywords',
    'understand-input',
    'understand-mic-btn',
    'understand-check-btn',
    'understand-next-actions',
    'understand-next-btn',
    'understand-yes-btn',
    'understand-notyet-btn',
    'understand-home-btn'
  ];
  const elements = {};
  ids.forEach(function (id) {
    elements[id] = createElement(id);
  });

  return {
    elements: elements,
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      const el = createElement(tagName);
      el.tagName = tagName;
      return el;
    }
  };
}

function setupController() {
  const documentMock = createMockDocument();
  const sessionState = {};
  const masteryCalls = [];
  let homeCalls = 0;

  controller.initUnderstandController({
    root: documentMock,
    sessionState: sessionState,
    updatePhraseMastery: function (phrase, result) {
      masteryCalls.push({ phrase: phrase, result: result });
    },
    returnToHome: function () {
      homeCalls += 1;
    }
  });

  return {
    documentMock: documentMock,
    sessionState: sessionState,
    masteryCalls: masteryCalls,
    getHomeCalls() {
      return homeCalls;
    }
  };
}

function createFakeMicAdapter() {
  let harness = null;
  let startCalls = 0;
  let listening = false;

  return {
    attachHarness(nextHarness) {
      harness = nextHarness;
    },
    startListening() {
      startCalls += 1;
      listening = true;
      if (harness && typeof harness.onStart === 'function') {
        harness.onStart({ type: 'start' });
      }
      return { started: true };
    },
    stopListening() {
      listening = false;
      return true;
    },
    isSupported() {
      return true;
    },
    isListening() {
      return listening;
    },
    emitTranscript(transcript) {
      listening = false;
      return harness.onTranscript({ type: 'transcript', transcript: transcript });
    },
    emitNoTranscript() {
      listening = false;
      if (harness && typeof harness.onEnd === 'function') {
        harness.onEnd({ type: 'end', hadTranscript: false });
      }
      return harness.onNoTranscript({ type: 'no_transcript' });
    },
    emitError(error) {
      listening = false;
      return harness.onError({ type: 'error', error: error || 'network' });
    },
    emitUnsupported() {
      listening = false;
      return harness.onUnsupported({ type: 'unsupported' });
    },
    emitEnd(hadTranscript) {
      listening = false;
      return harness.onEnd({ type: 'end', hadTranscript: !!hadTranscript });
    },
    getStartCalls() {
      return startCalls;
    }
  };
}

function assertListeningUI(documentMock) {
  assert.strictEqual(
    documentMock.getElementById('understand-feedback').textContent,
    'Listening...'
  );
  assert.strictEqual(
    documentMock.getElementById('understand-state-label').textContent,
    'Listening'
  );
  assert.strictEqual(
    documentMock.getElementById('understand-luna-subtitle').textContent,
    'Now say it.'
  );
}

function runSmokeTests() {
  {
    const ctx = setupController();
    const fakeMicAdapter = createFakeMicAdapter();
    const harness = controller.attachUnderstandMicAdapter(fakeMicAdapter);
    fakeMicAdapter.attachHarness(harness);

    assert.ok(harness);
    assert.strictEqual(typeof harness.onStart, 'function');
    assert.strictEqual(controller.getUnderstandControllerState().hasMicAdapter, true);
  }

  {
    const ctx = setupController();
    const fakeMicAdapter = createFakeMicAdapter();
    const harness = controller.attachUnderstandMicAdapter(fakeMicAdapter);
    fakeMicAdapter.attachHarness(harness);

    controller.startUnderstandLessonController();
    controller.handleUnderstandRevealController();

    const firstRequest = controller.requestUnderstandMicController();
    const secondRequest = controller.requestUnderstandMicController();

    assert.deepStrictEqual(firstRequest, { started: true });
    assert.strictEqual(secondRequest.alreadyActive, true);
    assert.strictEqual(fakeMicAdapter.getStartCalls(), 1);
    assertListeningUI(ctx.documentMock);
  }

  {
    const ctx = setupController();
    const harness = controller.createUnderstandMicHarness();

    harness.onStart({ type: 'start' });
    assertListeningUI(ctx.documentMock);
    assert.strictEqual(
      controller.getUnderstandControllerState().understandRecognitionActive,
      true
    );
  }

  {
    const ctx = setupController();
    const fakeMicAdapter = createFakeMicAdapter();
    const harness = controller.attachUnderstandMicAdapter(fakeMicAdapter);
    fakeMicAdapter.attachHarness(harness);

    controller.startUnderstandLessonController();
    controller.handleUnderstandRevealController();

    const lesson = controller.getUnderstandControllerState().currentLesson;
    fakeMicAdapter.emitTranscript(lesson.phrase);

    assert.strictEqual(
      ctx.documentMock.getElementById('understand-input').value,
      lesson.phrase
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      'Good.'
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-state-label').textContent,
      'Speaking'
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-next-actions').classList.contains('hidden'),
      false
    );
  }

  {
    const ctx = setupController();
    const harness = controller.createUnderstandMicHarness();

    harness.onNoTranscript({ type: 'no_transcript' });

    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      'Say it clearly.'
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-state-label').textContent,
      'Idle'
    );
    assert.strictEqual(
      controller.getUnderstandControllerState().understandRecognitionActive,
      false
    );
  }

  {
    const ctx = setupController();
    const harness = controller.createUnderstandMicHarness();

    harness.onError({ type: 'error', error: 'network' });

    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      'Type it if the mic missed you.'
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-state-label').textContent,
      'Idle'
    );
    assert.strictEqual(
      controller.getUnderstandControllerState().understandRecognitionActive,
      false
    );
  }

  {
    const ctx = setupController();
    const harness = controller.createUnderstandMicHarness();

    harness.onUnsupported({ type: 'unsupported' });

    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      'Type it if your browser does not support the mic.'
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-input').focusCount > 0,
      true
    );
    assert.strictEqual(
      controller.getUnderstandControllerState().understandRecognitionActive,
      false
    );
  }

  {
    const ctx = setupController();
    const harness = controller.createUnderstandMicHarness();

    harness.onStart({ type: 'start' });
    assert.strictEqual(controller.getUnderstandControllerState().understandRecognitionActive, true);
    harness.onEnd({ type: 'end', hadTranscript: false });
    assert.strictEqual(controller.getUnderstandControllerState().understandRecognitionActive, false);
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      'Listening...'
    );
  }

  {
    const ctx = setupController();
    const fakeMicAdapter = createFakeMicAdapter();
    const harness = controller.attachUnderstandMicAdapter(fakeMicAdapter);
    fakeMicAdapter.attachHarness(harness);

    controller.startUnderstandLessonController();
    controller.handleUnderstandRevealController();

    const lesson = controller.getUnderstandControllerState().currentLesson;
    fakeMicAdapter.emitTranscript(lesson.phrase);
    const feedbackAfterTranscript = ctx.documentMock.getElementById('understand-feedback').textContent;
    const inputAfterTranscript = ctx.documentMock.getElementById('understand-input').value;
    const nextHiddenAfterTranscript = ctx.documentMock
      .getElementById('understand-next-actions')
      .classList
      .contains('hidden');

    fakeMicAdapter.emitEnd(true);

    assert.strictEqual(
      ctx.documentMock.getElementById('understand-feedback').textContent,
      feedbackAfterTranscript
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-input').value,
      inputAfterTranscript
    );
    assert.strictEqual(
      ctx.documentMock.getElementById('understand-next-actions').classList.contains('hidden'),
      nextHiddenAfterTranscript
    );
    assert.strictEqual(
      controller.getUnderstandControllerState().understandRecognitionActive,
      false
    );
  }

  console.log('understandController smoke test: PASS');
}

try {
  runSmokeTests();
} catch (error) {
  console.error('understandController smoke test: FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
