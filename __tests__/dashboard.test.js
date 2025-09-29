// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

const defaultRoleSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'roles.json'), 'utf8')
);

function createBackendMock() {
  const storage = new Map();
  let savedNames = [];
  let savedRoles = [];
  let theme = null;
  let sessions = [];
  let loggedIn = true;
  let storedRoleSchema = null;
  let lobbies = [];
  let lobbyCounter = 2;
  const lobbyMembers = new Map();
  const defaultUser = {
    id: 1,
    email: 'test@narrator.de',
    displayName: 'Testleitung',
    isAdmin: true,
  };

  const clone = (value) => (value === null || value === undefined ? null : JSON.parse(JSON.stringify(value)));
  const lobbyClone = (lobby) => ({ ...lobby });

  const resetLobbies = () => {
    lobbies = [
      {
        id: 1,
        name: 'Persönliche Lobby',
        isPersonal: true,
        isOwner: true,
        isAdmin: true,
        joinCode: 'TEAM001',
      },
    ];
    lobbyMembers.clear();
    lobbyMembers.set(1, [
      {
        userId: defaultUser.id,
        displayName: defaultUser.displayName,
        email: defaultUser.email,
        isOwner: true,
        isAdmin: true,
      },
    ]);
    lobbyCounter = 2;
  };

  resetLobbies();

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

      if (pathname === '/api/roles-config') {
        if (method === 'GET') {
          const schema = storedRoleSchema ? clone(storedRoleSchema) : clone(defaultRoleSchema);
          const source = storedRoleSchema ? 'custom' : 'default';
          return response(200, { config: schema, source });
        }
        if (method === 'PUT' || method === 'POST') {
          const next = payload && typeof payload === 'object'
            ? (payload.config ?? payload)
            : null;
          storedRoleSchema = next ? clone(next) : null;
          const status = method === 'POST' ? 201 : 200;
          return response(status, { config: storedRoleSchema ? clone(storedRoleSchema) : null, source: 'custom' });
        }
        if (method === 'DELETE') {
          storedRoleSchema = null;
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

      if (pathname === '/api/auth/me' && method === 'GET') {
        return response(200, { user: loggedIn ? { ...defaultUser } : null });
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        loggedIn = true;
        return response(200, { user: { ...defaultUser } });
      }

      if (pathname === '/api/auth/register' && method === 'POST') {
        loggedIn = true;
        const displayName = typeof payload?.displayName === 'string' ? payload.displayName : defaultUser.displayName;
        const email = typeof payload?.email === 'string' ? payload.email : defaultUser.email;
        return response(201, { user: { ...defaultUser, displayName, email } });
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        loggedIn = false;
        return empty();
      }

      if (pathname === '/api/analytics' && method === 'GET') {
        return response(200, {
          summary: { sessionCount: sessions.length, players: savedNames.length },
          winrates: [],
          highlights: [],
          meta: {},
        });
      }

      if (pathname === '/api/lobbies') {
        if (method === 'GET') {
          return response(200, { lobbies: lobbies.map(lobbyClone) });
        }
        if (method === 'POST') {
          const name = typeof payload?.name === 'string' && payload.name.trim().length > 0
            ? payload.name.trim()
            : `Lobby ${lobbyCounter}`;
          const newLobby = {
            id: lobbyCounter++,
            name,
            isPersonal: false,
            isOwner: true,
            isAdmin: true,
            joinCode: `TEAM${String(Math.random()).slice(2, 6).toUpperCase()}`,
          };
          lobbies.push(newLobby);
          lobbyMembers.set(newLobby.id, [
            {
              userId: defaultUser.id,
              displayName: defaultUser.displayName,
              email: defaultUser.email,
              isOwner: true,
              isAdmin: true,
            },
          ]);
          return response(201, { lobby: lobbyClone(newLobby), lobbies: lobbies.map(lobbyClone) });
        }
      }

      if (pathname === '/api/lobbies/join' && method === 'POST') {
        return response(200, { lobby: lobbies[0] ? lobbyClone(lobbies[0]) : null, lobbies: lobbies.map(lobbyClone) });
      }

      const membersMatch = pathname.match(/^\/api\/lobbies\/(\d+)\/members$/);
      if (membersMatch && method === 'GET') {
        const lobbyId = Number(membersMatch[1]);
        const members = lobbyMembers.get(lobbyId) || [];
        return response(200, { members: members.map((member) => ({ ...member })) });
      }

      const lobbyMatch = pathname.match(/^\/api\/lobbies\/(\d+)$/);
      if (lobbyMatch && method === 'DELETE') {
        const lobbyId = Number(lobbyMatch[1]);
        if (lobbyId === 1) {
          return response(400, { error: 'Persönliche Lobby kann nicht verlassen werden.' });
        }
        lobbies = lobbies.filter((entry) => entry.id !== lobbyId);
        lobbyMembers.delete(lobbyId);
        return empty();
      }

      return response(404, { error: 'Nicht gefunden' });
    }),
    reset() {
      storage.clear();
      savedNames = [];
      savedRoles = [];
      theme = null;
      sessions = [];
      loggedIn = true;
      storedRoleSchema = null;
      resetLobbies();
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
    setRoleSchema(schema) {
      storedRoleSchema = schema ? clone(schema) : null;
    }
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

      window.__WERWOLF_TEST_BOOT__ = {
        user: {
          id: 1,
          email: 'test@narrator.de',
          displayName: 'Testleitung',
          isAdmin: true,
        },
      };

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
    delete window.__WERWOLF_TEST_BOOT__;
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

  test('custom role schema updates night order and role info', () => {
    const customSchema = {
      version: 1,
      categories: [
        { id: 'village', label: 'Dorfbewohner' },
        { id: 'werwolf', label: 'Werwölfe' },
        { id: 'special', label: 'Sonderrollen' }
      ],
      roles: [
        { name: 'Dorfbewohner', category: 'village', description: 'Schläft ruhig.', abilities: [] },
        { name: 'Werwolf', category: 'werwolf', description: 'Jagt nachts.', abilities: [] },
        { name: 'Traumwächter', category: 'special', description: 'Bewacht die Träume des Dorfs.', abilities: ['Kann Visionen deuten.'] }
      ],
      jobs: [
        { name: 'Orakel', description: 'Deutet Visionen der Traumwächterin.', eligibleRoles: ['Traumwächter'] }
      ],
      night: {
        sequence: [
          { id: 'Orakel', prompt: 'Das Orakel erwacht.', requires: { jobs: ['Orakel'] } },
          { id: 'Traumwächter', prompt: 'Die Traumwächterin sucht eine Vision.', requires: { roles: ['Traumwächter'] } },
          { id: 'Werwolf', prompt: 'Werwölfe wählen ihr Opfer.', requires: { roles: ['Werwolf'] } }
        ]
      }
    };

    backend.setRoleSchema(customSchema);
    testApi.setRoleSchema(customSchema);

    testApi.setState({
      players: ['Anna', 'Boris', 'Clara'],
      rolesAssigned: ['Traumwächter', 'Werwolf', 'Dorfbewohner'],
      jobsAssigned: [['Orakel'], [], []],
      deadPlayers: []
    });

    const sequence = testApi.generateNightSequence();
    expect(sequence).toEqual(['Orakel', 'Traumwächter', 'Werwolf']);
    expect(testApi.getNightPrompt('Traumwächter')).toBe('Die Traumwächterin sucht eine Vision.');

    testApi.showRoleInfo('Traumwächter', { jobs: ['Orakel'] });
    const modal = document.getElementById('role-info-modal');
    expect(modal.style.display).toBe('flex');
    const abilityItems = Array.from(document.querySelectorAll('#role-info-desc .role-info-abilities li')).map((li) => li.textContent);
    expect(abilityItems).toContain('Kann Visionen deuten.');
    const jobBadge = document.querySelector('#role-info-desc .job-badge');
    expect(jobBadge).toBeTruthy();
    expect(jobBadge.textContent).toBe('Orakel');
    const jobDescription = document.querySelector('#role-info-desc .job-description-text');
    expect(jobDescription).toBeTruthy();
    expect(jobDescription.textContent).toBe('Deutet Visionen der Traumwächterin.');
    modal.querySelector('.close-modal').click();
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

  test('test api exposes ambience snapshot and manual setter', () => {
    const state = testApi.getState();
    expect(state.ambience).toEqual(expect.objectContaining({
      activePlaylist: null,
      manualPlaylist: null,
      activeLighting: null,
      manualLighting: null
    }));

    testApi.setManualAmbience({ playlist: 'nightwatch', lighting: 'witch' });
    let snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBe('nightwatch');
    expect(snapshot.manualLighting).toBe('witch');
    expect(snapshot.playlistSource).toBe('manual');
    expect(snapshot.lightingSource).toBe('manual');

    testApi.setManualAmbience({ playlist: null, lighting: null });
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBeNull();
    expect(snapshot.manualLighting).toBeNull();
  });

  test('admin ambience controls toggle manual state', async () => {
    testApi.setManualAmbience({ playlist: null, lighting: null });
    const playlistButtons = Array.from(document.querySelectorAll('#ambience-playlists .ambience-toggle'));
    expect(playlistButtons.length).toBeGreaterThan(1);

    const playlistToggle = playlistButtons.find(btn => btn.dataset.id);
    expect(playlistToggle).toBeDefined();
    playlistToggle.click();
    await flushAsync();

    let snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBe(playlistToggle.dataset.id);
    expect(playlistToggle.getAttribute('aria-pressed')).toBe('true');

    const stopBtn = playlistButtons.find(btn => btn.textContent.includes('Stop'));
    expect(stopBtn).toBeDefined();
    stopBtn.click();

    await flushAsync();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activePlaylist).toBeNull();
    expect(snapshot.playlistSource).toBe('manual');
    expect(stopBtn.getAttribute('aria-pressed')).toBe('true');
    expect(playlistToggle.getAttribute('aria-pressed')).toBe('false');

    stopBtn.click();
    await flushAsync();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBeNull();
    expect(stopBtn.getAttribute('aria-pressed')).toBe('false');

    const lightingButtons = Array.from(document.querySelectorAll('#ambience-lighting .ambience-toggle'));
    expect(lightingButtons.length).toBeGreaterThan(1);

    const lightingToggle = lightingButtons.find(btn => btn.dataset.id && btn.dataset.id !== '');
    expect(lightingToggle).toBeDefined();
    lightingToggle.click();

    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBe(lightingToggle.dataset.id);
    expect(lightingToggle.getAttribute('aria-pressed')).toBe('true');

    const neutralBtn = lightingButtons.find(btn => btn.textContent.includes('Neutral'));
    expect(neutralBtn).toBeDefined();
    neutralBtn.click();

    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBe(neutralBtn.dataset.id);
    expect(snapshot.activeLighting).toBeNull();
    expect(snapshot.lightingSource).toBe('manual');
    expect(neutralBtn.getAttribute('aria-pressed')).toBe('true');
    expect(lightingToggle.getAttribute('aria-pressed')).toBe('false');

    neutralBtn.click();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBeNull();
    expect(neutralBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('night step ambience temporarily overrides blood moon event', () => {
    testApi.setManualAmbience({ playlist: null, lighting: null });
    testApi.triggerAmbienceEvent('blood-moon', true);

    let snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('blood-moon');
    expect(snapshot.lightingSource).toBe('event');

    testApi.previewNightStep('Seer');
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('seer');
    expect(snapshot.lightingSource).toBe('step');

    testApi.previewNightStep(null);
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('blood-moon');
    expect(snapshot.lightingSource).toBe('event');

    testApi.triggerAmbienceEvent('blood-moon', false);
    snapshot = testApi.getAmbienceState();
    expect(snapshot.lightingSource === 'event').toBe(false);
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
