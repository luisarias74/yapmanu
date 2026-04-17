window.LaLanguishApp = (() => {
  const PREFIX = 'lalanguish_';

  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return value;
    },
    remove(key) {
      localStorage.removeItem(PREFIX + key);
    },
    clearAll() {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(PREFIX))
        .forEach((key) => localStorage.removeItem(key));
    }
  };

  const today = () => new Date().toISOString().split('T')[0];

  function ensureDefaultState() {
    if (store.get('xp') === null) store.set('xp', 0);
    if (store.get('streak') === null) store.set('streak', 0);
    if (store.get('stamps') === null) store.set('stamps', []);
    if (store.get('completed') === null) store.set('completed', []);
    if (store.get('mode') === null) store.set('mode', 'teach');
    return {
      xp: store.get('xp', 0),
      streak: store.get('streak', 0),
      stamps: store.get('stamps', []),
      completed: store.get('completed', []),
      mode: store.get('mode', 'teach')
    };
  }

  function saveProfile(profile) {
    const clean = {
      name: (profile.name || 'Carolina').trim(),
      job: (profile.job || '').trim(),
      pets: (profile.pets || '').trim(),
      hobbies: (profile.hobbies || '').trim(),
      level: profile.level || 'beginner',
      focus: profile.focus || 'speak',
      joined: profile.joined || new Date().toISOString()
    };

    store.set('profile', clean);
    ensureDefaultState();
    if (!store.get('last_active')) store.set('last_active', today());
    return clean;
  }

  function updateDailyPresence() {
    const currentDay = today();
    const lastActive = store.get('last_active');
    let streak = store.get('streak', 0);

    if (!lastActive) {
      streak = 1;
    } else if (lastActive !== currentDay) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      streak = lastActive === yesterday ? streak + 1 : 1;
    }

    store.set('streak', streak);
    store.set('last_active', currentDay);
    return streak;
  }

  function getSnapshot() {
    ensureDefaultState();
    return {
      profile: store.get('profile'),
      xp: store.get('xp', 0),
      streak: store.get('streak', 0),
      stamps: store.get('stamps', []),
      completed: store.get('completed', []),
      mode: store.get('mode', 'teach'),
      apiKey: store.get('api_key', '')
    };
  }

  function setApiKey(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) {
      store.remove('api_key');
      return '';
    }
    store.set('api_key', cleaned);
    return cleaned;
  }

  return {
    store,
    today,
    ensureDefaultState,
    saveProfile,
    updateDailyPresence,
    getSnapshot,
    setApiKey
  };
})();
