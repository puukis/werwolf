// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

function createBackendMock() {
  const storage = new Map();
  let savedNames = [];
  let savedRoles = [];
  let theme = null;
  let sessions = [];

  const normalizeTheme = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    return trimmed === 'dark' || trimmed === 'light' ? trimmed : null;
  };

  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  });

  const empty = () => ({
    ok: true,
    status: 204,
    async json() {
      return {};
    },
  });

  const backend = {
    fetch: jest.fn(async (url, options = {}) => {
      const { pathname } = new URL(url, 'http://localhost');
      const method = (options.method || 'GET').toUpperCase();
      let payload = null;
      if (options.body) {
        try {
          payload = JSON.parse(options.body);
        } catch (error) {
          payload = null;
        }
      }

      if (pathname === '/api/theme') {
        if (method === 'GET') {
          return response(200, { theme });
        }
        if (method === 'PUT') {
          const normalized = normalizeTheme(payload?.theme);
          if (!normalized) {
            return response(400, { error: 'Ungültiges Theme.' });
          }
          theme = normalized;
          storage.set('theme', normalized);
          return response(200, { theme });
        }
      }

      if (pathname === '/api/saved-names') {
        if (method === 'GET') {
          return response(200, { names: savedNames.slice() });
        }
        if (method === 'PUT') {
          const names = Array.isArray(payload?.names)
            ? payload.names.filter((name) => typeof name === 'string' && name.trim().length > 0)
            : [];
          savedNames = names.map((name) => name.trim());
          storage.set('werwolfSavedNames', savedNames.slice());
          return response(200, { names: savedNames.slice() });
        }
      }

      if (pathname === '/api/role-presets') {
        if (method === 'GET') {
          return response(200, { roles: savedRoles.slice() });
        }
        if (method === 'PUT') {
          const roles = Array.isArray(payload?.roles)
            ? payload.roles
                .filter((role) => role && typeof role.name === 'string' && role.name.trim().length > 0)
                .map((role) => ({
                  name: role.name.trim(),
                  quantity: Number.isFinite(role.quantity) ? Math.max(0, Math.round(role.quantity)) : 0,
                }))
            : [];
          savedRoles = roles;
          storage.set('werwolfSavedRoles', roles.map((role) => ({ ...role })));
          return response(200, { roles: roles.map((role) => ({ ...role })) });
        }
      }

      if (pathname.startsWith('/api/storage/')) {
        const key = decodeURIComponent(pathname.replace('/api/storage/', ''));
        if (method === 'GET') {
          return response(200, { key, value: storage.has(key) ? storage.get(key) : null });
        }
        if (method === 'PUT') {
          const value = payload ? payload.value ?? null : null;
          storage.set(key, value);
          return response(200, { key, value });
        }
        if (method === 'DELETE') {
          storage.delete(key);
          return empty();
        }
      }

      if (pathname === '/api/sessions') {
        if (method === 'GET') {
          const ordered = sessions.slice().sort((a, b) => b.timestamp - a.timestamp);
          return response(200, { sessions: ordered.slice(0, 20) });
        }
        if (method === 'POST') {
          if (!payload || typeof payload.session !== 'object') {
            return response(400, { error: 'Ungültige Session.' });
          }
          const timestamp = Number(payload.session.timestamp || Date.now());
          const normalized = { ...payload.session, timestamp };
          sessions = sessions.filter((session) => session.timestamp !== timestamp);
          sessions.push(normalized);
          sessions.sort((a, b) => b.timestamp - a.timestamp);
          sessions = sessions.slice(0, 20);
          return response(201, { session: normalized, sessions: sessions.slice() });
        }
      }

      if (pathname.startsWith('/api/sessions/')) {
        if (method === 'DELETE') {
          const timestamp = Number(pathname.split('/').pop());
          sessions = sessions.filter((session) => session.timestamp !== timestamp);
          return empty();
        }
      }

      return response(404, { error: 'Nicht gefunden' });
    }),
    reset() {
      storage.clear();
      savedNames = [];
      savedRoles = [];
      theme = null;
      sessions = [];
    },
    setTheme(value) {
      theme = typeof value === 'string' ? value : null;
      if (theme) {
        storage.set('theme', theme);
      } else {
        storage.delete('theme');
      }
    },
    getTheme() {
      return theme;
    },
    getStorage(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
  };

  return backend;
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

  describe('Narrator dashboard integrations', () => {
    let testApi;
    let backend;

    beforeEach(async () => {
      jest.resetModules();
      jest.clearAllTimers();
      const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);

      document.body.innerHTML = bodyMatch ? bodyMatch[1].replace(/<script[^>]*src="script\.js"[^>]*><\/script>/i, '') : '';
      document.head.innerHTML = headMatch ? headMatch[1] : '';

      window.alert = jest.fn();
      window.confirm = jest.fn(() => true);
      backend = createBackendMock();
      backend.reset();
      global.fetch = backend.fetch;
      window.matchMedia = window.matchMedia || jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      }));

      require('../script.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flushAsync();

      testApi = window.__WERWOLF_TEST__;
      if (!testApi) {
        throw new Error('Test API not available');
      }

      testApi.setState({
        players: [],
        rolesAssigned: [],
      deadPlayers: [],
      lovers: [],
      nightSteps: [],
      currentNightVictims: [],
      dayCount: 0,
      nightMode: false,
      dayMode: false,
      mayor: null,
      silencedPlayer: null,
      nightIndex: 0,
      nightCounter: 0,
      peaceDays: 0
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  function getDashboardSnapshot() {
    return testApi.getDashboardSnapshot();
  }

  function dispatchEvent(element, type) {
    element.dispatchEvent(new Event(type, { bubbles: true }));
  }

  test('updates dashboard after night kill resolution', () => {
    testApi.setState({
      players: ['Alice', 'Bob', 'Clara', 'Dieter'],
      rolesAssigned: ['Werwolf', 'Seer', 'Dorfbewohner', 'Dorfbewohner'],
      deadPlayers: [],
      nightMode: true,
      dayMode: false,
      nightSteps: ['Werwolf'],
      currentNightVictims: [],
      dayCount: 0,
      mayor: null,
      nightIndex: 0
    });

    const preKill = getDashboardSnapshot();
    expect(preKill.teamCounts).toContain('Dorfbewohner: 3');
    expect(preKill.events).toContain('Keine offenen Ereignisse');

    testApi.setState({
      currentNightVictims: ['Clara'],
      deadPlayers: ['Clara']
    });
    testApi.handlePlayerDeath('Clara');

    const postKill = getDashboardSnapshot();
    expect(postKill.teamCounts).toContain('Dorfbewohner: 2');
    expect(postKill.events).toContain('Ausstehende Nachtopfer: Clara');
  });

  test('reflects mayor election on dashboard', () => {
    testApi.setState({
      players: ['Alice', 'Bob', 'Clara'],
      rolesAssigned: ['Dorfbewohner', 'Dorfbewohner', 'Werwolf'],
      deadPlayers: [],
      dayMode: true,
      nightMode: false,
      dayCount: 1,
      mayor: null
    });

    testApi.electMayor();
    const bobButton = Array.from(document.querySelectorAll('#day-choices .player-btn')).find(btn => btn.textContent === 'Bob');
    expect(bobButton).toBeTruthy();
    bobButton.click();

    document.getElementById('day-lynch-btn').click();
    document.getElementById('confirm-btn').click();

    const snapshot = getDashboardSnapshot();
    expect(snapshot.mayor).toBe('Bürgermeister: Bob');
  });

  test('macro execution refreshes dashboard state', () => {
    testApi.setState({
      players: ['Alice', 'Bob', 'Clara'],
      rolesAssigned: ['Werwolf', 'Seer', 'Dorfbewohner'],
      deadPlayers: ['Clara'],
      dayMode: true,
      nightMode: false,
      dayCount: 2,
      mayor: 'Bob'
    });

    const before = getDashboardSnapshot();
    expect(before.teamCounts).toContain('Dorfbewohner: 1');

    const executed = testApi.runMacro('revive-all');
    expect(executed).toBe(true);

    const after = getDashboardSnapshot();
    expect(after.teamCounts).toContain('Dorfbewohner: 2');
    expect(testApi.getState().deadPlayers).toEqual([]);
    expect(testApi.getActionLog()[0].label).toContain('Makro: Alle Spieler wiederbeleben');
  });

  test('saving a session surfaces the confirmation modal', async () => {
    const modal = document.getElementById('confirmation-modal');
    expect(modal.style.display).not.toBe('flex');

    document.getElementById('save-game-btn').click();
    await flushAsync();

    expect(window.alert).not.toHaveBeenCalled();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('confirm-btn').textContent).toBe('Okay');

    document.getElementById('confirm-btn').click();

    const latest = testApi.getActionLog()[0];
    expect(latest.label).toBe('Session gespeichert');
    expect(latest.type).toBe('info');
  });

  test('saving empty player names logs an error via modal', async () => {
    const playersInput = document.getElementById('players');
    playersInput.value = '';

    document.getElementById('save-names-manually').click();
    await flushAsync();

    const modal = document.getElementById('confirmation-modal');
    expect(window.alert).not.toHaveBeenCalled();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('confirmation-title').textContent).toBe('Speichern nicht möglich');

    document.getElementById('confirm-btn').click();

    const latest = testApi.getActionLog()[0];
    expect(latest.type).toBe('error');
    expect(latest.label).toBe('Speichern der Namen fehlgeschlagen');
  });

  test('bodyguard job chance slider syncs UI, state, and storage', () => {
    const slider = document.getElementById('bodyguard-job-chance');
    const display = document.getElementById('bodyguard-job-chance-display');

    expect(slider).toBeTruthy();
    expect(display).toBeTruthy();
    expect(display.textContent).toBe('0%');

    slider.value = '37';
    dispatchEvent(slider, 'input');

    expect(display.textContent).toBe('37%');
    expect(testApi.getState().jobConfig.bodyguardChance).toBeCloseTo(0.37, 2);

    slider.value = '80';
    dispatchEvent(slider, 'change');

    expect(display.textContent).toBe('80%');
    const storedConfigRaw = backend.getStorage('werwolfJobConfig');
    expect(storedConfigRaw).not.toBeNull();
    const storedConfig = JSON.parse(storedConfigRaw);
    expect(storedConfig.bodyguardChance).toBeCloseTo(0.8, 5);

    testApi.setState({ jobConfig: { bodyguardChance: 0.25 } });
    expect(slider.value).toBe('25');
    expect(display.textContent).toBe('25%');
  });

  test('doctor job chance slider syncs UI, state, and storage', () => {
    const slider = document.getElementById('doctor-job-chance');
    const display = document.getElementById('doctor-job-chance-display');

    expect(slider).toBeTruthy();
    expect(display).toBeTruthy();
    expect(display.textContent).toBe('0%');

    slider.value = '45';
    dispatchEvent(slider, 'input');

    expect(display.textContent).toBe('45%');
    expect(testApi.getState().jobConfig.doctorChance).toBeCloseTo(0.45, 2);

    slider.value = '70';
    dispatchEvent(slider, 'change');

    const storedConfigRaw = backend.getStorage('werwolfJobConfig');
    expect(storedConfigRaw).not.toBeNull();
    const storedConfig = JSON.parse(storedConfigRaw);
    expect(storedConfig.doctorChance).toBeCloseTo(0.7, 5);

    testApi.setState({ jobConfig: { doctorChance: 0.2 } });
    expect(slider.value).toBe('20');
    expect(display.textContent).toBe('20%');
  });

  test('phoenix pulse status reflects availability, charge, and resolution', () => {
    const eventsToggle = document.getElementById('events-enabled');
    const phoenixToggle = document.getElementById('phoenix-pulse-enabled');
    const status = document.getElementById('phoenix-pulse-status');

    expect(eventsToggle).toBeTruthy();
    expect(phoenixToggle).toBeTruthy();
    expect(status).toBeTruthy();
    expect(status.textContent).toBe('Phoenix Pulse: –');

    eventsToggle.checked = false;
    dispatchEvent(eventsToggle, 'change');
    expect(status.textContent).toBe('Phoenix Pulse: deaktiviert');

    eventsToggle.checked = true;
    dispatchEvent(eventsToggle, 'change');
    expect(status.textContent).toBe('Phoenix Pulse: –');

    testApi.setState({
      phoenixPulsePending: true,
      phoenixPulseJustResolved: false,
      phoenixPulseRevivedPlayers: []
    });

    expect(status.textContent).toBe('Phoenix Pulse: bereit');
    expect(status.classList.contains('active')).toBe(true);
    expect(document.body.classList.contains('phoenix-pulse-charged')).toBe(true);

    testApi.setState({
      phoenixPulsePending: false,
      phoenixPulseJustResolved: true,
      phoenixPulseRevivedPlayers: ['Alice', 'Bob']
    });

    expect(status.textContent).toBe('Phoenix Pulse: Alice, Bob zurück');
    expect(status.classList.contains('resolved')).toBe(true);
    expect(document.body.classList.contains('phoenix-pulse-charged')).toBe(false);

    phoenixToggle.checked = false;
    dispatchEvent(phoenixToggle, 'change');
    expect(status.textContent).toBe('Phoenix Pulse: deaktiviert');
  });

  test('phase timer manager supports pause, resume, and cancellation flows', () => {
    jest.useFakeTimers();
    const originalOnChange = testApi.renderNarratorDashboard;
    const onChangeSpy = jest.fn();
    testApi.phaseTimerManager.setOnChange(onChangeSpy);

    try {
      const callback = jest.fn();
      const cleanupCallback = jest.fn();

      const timerId = testApi.phaseTimerManager.schedule(callback, 5000, 'Test Timer');
      let entry = testApi.phaseTimerManager.list().find(item => item.id === timerId);
      expect(entry).toBeDefined();
      const initialRemaining = entry.remaining;
      expect(initialRemaining).toBeGreaterThan(0);
      expect(onChangeSpy).toHaveBeenCalled();

      const cancelId = testApi.phaseTimerManager.schedule(cleanupCallback, 8000, 'Cleanup Timer');
      expect(testApi.phaseTimerManager.cancel(cancelId)).toBe(true);
      expect(testApi.phaseTimerManager.list().some(item => item.id === cancelId)).toBe(false);
      expect(cleanupCallback).not.toHaveBeenCalled();
      onChangeSpy.mockClear();

      jest.advanceTimersByTime(2000);
      entry = testApi.phaseTimerManager.list().find(item => item.id === timerId);
      expect(entry.remaining).toBeLessThan(initialRemaining);

      expect(testApi.phaseTimerManager.pause()).toBe(true);
      const pausedSnapshot = testApi.phaseTimerManager.list().find(item => item.id === timerId).remaining;
      expect(testApi.phaseTimerManager.pause()).toBe(false);
      expect(onChangeSpy).toHaveBeenCalled();
      onChangeSpy.mockClear();

      jest.advanceTimersByTime(2000);
      const stillPaused = testApi.phaseTimerManager.list().find(item => item.id === timerId).remaining;
      expect(stillPaused).toBeCloseTo(pausedSnapshot, 0);

      expect(testApi.phaseTimerManager.resume()).toBe(true);
      expect(testApi.phaseTimerManager.resume()).toBe(false);
      expect(onChangeSpy).toHaveBeenCalled();
      onChangeSpy.mockClear();

      jest.advanceTimersByTime(5000);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(testApi.phaseTimerManager.list()).toHaveLength(0);
      expect(onChangeSpy).toHaveBeenCalled();
    } finally {
      testApi.phaseTimerManager.cancelAll();
      testApi.phaseTimerManager.setOnChange(originalOnChange);
      jest.useRealTimers();
    }
  });
});
