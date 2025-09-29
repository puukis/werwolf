// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

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

  const cloneLobby = (lobby) => ({ ...lobby });

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

      if (pathname === '/api/roles-config') {
        if (method === 'GET') {
          return response(200, { config: storedRoleSchema ? { ...storedRoleSchema } : null, source: storedRoleSchema ? 'custom' : 'default' });
        }
        if (method === 'PUT' || method === 'POST') {
          const next = payload && typeof payload === 'object' ? payload.config ?? payload : null;
          storedRoleSchema = next ? { ...next } : null;
          const status = method === 'POST' ? 201 : 200;
          return response(status, { config: storedRoleSchema ? { ...storedRoleSchema } : null, source: storedRoleSchema ? 'custom' : 'default' });
        }
        if (method === 'DELETE') {
          storedRoleSchema = null;
          return empty();
        }
      }

      if (pathname === '/api/analytics' && method === 'GET') {
        return response(200, {
          summary: { sessionCount: sessions.length },
          winrates: [],
          highlights: [],
          meta: {},
        });
      }

      if (pathname === '/api/lobbies') {
        if (method === 'GET') {
          return response(200, { lobbies: lobbies.map(cloneLobby) });
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
          return response(201, { lobby: cloneLobby(newLobby), lobbies: lobbies.map(cloneLobby) });
        }
      }

      if (pathname === '/api/lobbies/join' && method === 'POST') {
        return response(200, { lobby: lobbies[0] ? cloneLobby(lobbies[0]) : null, lobbies: lobbies.map(cloneLobby) });
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
  };

  return backend;
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Ereignis-Engine', () => {
  let testApi;
  let randomSpy;
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
      players: ['Alice', 'Bob'],
      rolesAssigned: ['Dorfbewohner', 'Werwolf'],
      deadPlayers: [],
      lovers: [],
      nightSteps: [],
      currentNightVictims: [],
      dayCount: 0,
      nightMode: false,
      dayMode: false,
      mayor: null,
      nightIndex: 0,
      nightCounter: 0,
      peaceDays: 0
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    if (randomSpy) {
      randomSpy.mockRestore();
      randomSpy = null;
    }
    delete window.__WERWOLF_TEST_BOOT__;
  });

  test('Blutmond-Pity-Zähler erhöht sich und wird beim Auslösen zurückgesetzt', () => {
    const randomSequence = [0.9, 0.9, 0.9, 0.9, 0.0, 0.9];
    randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => {
      return randomSequence.length ? randomSequence.shift() : 0.9;
    });

    expect(backend.getStorage('bloodMoonPityTimer')).toBeNull();

    testApi.triggerNightEvents();
    expect(backend.getStorage('bloodMoonPityTimer')).toBe('1');

    testApi.triggerNightEvents();
    expect(backend.getStorage('bloodMoonPityTimer')).toBe('2');

    testApi.triggerNightEvents();
    expect(backend.getStorage('bloodMoonPityTimer')).toBe('0');

    const dashboardEvents = testApi.getDashboardSnapshot().events;
    expect(dashboardEvents).toContain('Blutmond aktiv');
    expect(dashboardEvents.some(event => event.includes('Modifikator: 🌕 Blutmond'))).toBe(true);

    const engineState = testApi.getEventEngineState();
    expect(engineState.scheduler.activeModifiers.some(mod => mod.originCardId === 'blood-moon')).toBe(true);
  });

  test('Phoenix Pulse wird eingeplant und bei der Wiederbelebung abgeschlossen', () => {
    const randomSequence = [0.9, 0.0];
    randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => {
      return randomSequence.length ? randomSequence.shift() : 0.9;
    });

    testApi.triggerNightEvents();

    const engineState = testApi.getEventEngineState();
    expect(engineState.scheduler.queuedEffects.some(entry => entry.cardId === 'phoenix-pulse')).toBe(true);

    const events = testApi.getDashboardSnapshot().events;
    expect(events).toContain('Phoenix Pulse geladen');
    expect(events.some(event => event.includes('Geplant: 🔥 Phoenix Pulse'))).toBe(true);

    testApi.setState({
      currentNightVictims: ['Alice'],
      deadPlayers: ['Alice'],
      phoenixPulsePending: true,
      phoenixPulseJustResolved: false
    });

    const revived = testApi.resolvePhoenixPulse();
    expect(revived).toEqual(['Alice']);

    const afterState = testApi.getEventEngineState();
    expect(afterState.scheduler.queuedEffects.length).toBe(0);
    expect(testApi.getState().phoenixPulsePending).toBe(false);
  });
});
