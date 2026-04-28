/* eslint-disable no-undef */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LaLanguishEngines = root.LaLanguishEngines || {};
    root.LaLanguishEngines.progressEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_MASTERY_KEY = 'lalanguish_mastery_v1';
  var DEFAULT_SCENARIO_KEY = 'lalanguish_scenarios_v1';

  function safeReadJson(storage, key, fallbackValue) {
    if (!storage || typeof storage.getItem !== 'function') return fallbackValue;
    try {
      var raw = storage.getItem(key);
      return JSON.parse(raw || JSON.stringify(fallbackValue));
    } catch (_) {
      return fallbackValue;
    }
  }

  function safeWriteJson(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') {
      return { ok: false, reason: 'storage_unavailable', key: key, value: value };
    }
    try {
      storage.setItem(key, JSON.stringify(value));
      return { ok: true, key: key, value: value };
    } catch (error) {
      return { ok: false, reason: 'storage_write_failed', key: key, value: value, error: error };
    }
  }

  // From index.final.html approx. lines 2211-2214.
  function loadMasteryMap(storage, options) {
    var key = (options && options.masteryKey) || DEFAULT_MASTERY_KEY;
    return safeReadJson(storage, key, {});
  }

  // From index.final.html approx. lines 2216-2218.
  function saveMasteryMap(storage, masteryMap, options) {
    var key = (options && options.masteryKey) || DEFAULT_MASTERY_KEY;
    return safeWriteJson(storage, key, masteryMap || {});
  }

  // From index.final.html approx. lines 2223-2225.
  function getPhraseMastery(phrase, masteryMap) {
    if (!phrase || !masteryMap) return 0;
    return typeof masteryMap[phrase] === 'number' ? masteryMap[phrase] : 0;
  }

  function computeNextMastery(current, result) {
    var next = current;

    if (result === 'struggle') {
      next = current >= 3 ? 2 : 1;
    } else if (result === 'helped') {
      next = Math.min(3, Math.max(2, current));
    } else if (result === 'clean') {
      next = current >= 3 ? 4 : 3;
    } else if (result === 'repeat_success') {
      next = current < 2 ? 2 : current;
    } else if (result === 'understand_success') {
      next = Math.max(1, current);
    }

    return next;
  }

  // From index.final.html approx. lines 2228-2258.
  function updatePhraseMastery(input) {
    var phrase = input && input.phrase;
    var result = input && input.result;
    var masteryMap = Object.assign({}, (input && input.masteryMap) || {});
    var getAssistLearningEntry = input && input.getAssistLearningEntry;
    var current = getPhraseMastery(phrase, masteryMap);
    var next = current;
    var effects = [];

    if (!phrase) {
      return {
        phrase: phrase,
        result: result,
        current: current,
        next: next,
        changed: false,
        masteryMap: masteryMap,
        effects: effects
      };
    }

    next = computeNextMastery(current, result);

    if (next !== current) {
      masteryMap[phrase] = next;
      effects.push({
        type: 'persist_mastery_map',
        payload: masteryMap
      });
    }

    if (typeof getAssistLearningEntry === 'function' && getAssistLearningEntry(phrase)) {
      effects.push({
        type: 'record_assist_learning_result',
        phrase: phrase,
        wasCorrect: result === 'clean' || result === 'repeat_success' || result === 'understand_success'
      });
    }

    return {
      phrase: phrase,
      result: result,
      current: current,
      next: next,
      changed: next !== current,
      masteryMap: masteryMap,
      effects: effects
    };
  }

  // From index.final.html approx. lines 2263-2264.
  function loadScenarioDoneMap(storage, options) {
    var key = (options && options.scenarioKey) || DEFAULT_SCENARIO_KEY;
    return safeReadJson(storage, key, {});
  }

  // From index.final.html approx. lines 2266-2269.
  function markScenarioDone(input) {
    var scenarioId = input && input.scenarioId;
    var doneMap = Object.assign({}, (input && input.doneMap) || {});
    var timestamp = Object.prototype.hasOwnProperty.call(input || {}, 'timestamp')
      ? input.timestamp
      : Date.now();

    if (!scenarioId) {
      return {
        scenarioId: scenarioId,
        timestamp: timestamp,
        doneMap: doneMap,
        changed: false
      };
    }

    doneMap[scenarioId] = timestamp;

    return {
      scenarioId: scenarioId,
      timestamp: timestamp,
      doneMap: doneMap,
      changed: true,
      effects: [{
        type: 'persist_scenario_done_map',
        payload: doneMap
      }]
    };
  }

  // From index.final.html approx. line 2271.
  function isScenarioDone(scenarioId, doneMap) {
    return !!(doneMap && doneMap[scenarioId]);
  }

  // From index.final.html approx. lines 2276-2284.
  function recordRepeatOutcome(input) {
    var phrase = input && input.phrase;
    var success = !!(input && input.success);
    var record = Object.assign({}, (input && input.repeatPhraseRecord) || {});

    if (!phrase) {
      return {
        phrase: phrase,
        success: success,
        repeatPhraseRecord: record,
        entry: null,
        changed: false
      };
    }

    var entry = Object.assign({ hits: 0, misses: 0 }, record[phrase] || {});
    if (success) entry.hits += 1;
    else entry.misses += 1;
    record[phrase] = entry;

    return {
      phrase: phrase,
      success: success,
      repeatPhraseRecord: record,
      entry: entry,
      changed: true
    };
  }

  return {
    DEFAULT_MASTERY_KEY: DEFAULT_MASTERY_KEY,
    DEFAULT_SCENARIO_KEY: DEFAULT_SCENARIO_KEY,
    safeReadJson: safeReadJson,
    safeWriteJson: safeWriteJson,
    loadMasteryMap: loadMasteryMap,
    saveMasteryMap: saveMasteryMap,
    getPhraseMastery: getPhraseMastery,
    computeNextMastery: computeNextMastery,
    updatePhraseMastery: updatePhraseMastery,
    loadScenarioDoneMap: loadScenarioDoneMap,
    markScenarioDone: markScenarioDone,
    isScenarioDone: isScenarioDone,
    recordRepeatOutcome: recordRepeatOutcome
  };
}));
