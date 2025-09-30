// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);

function createBackendMock() {
  const storage = new Map();
  let savedNames = [];
  let savedRoles = [];
  const themePresets = {
    version: 1,
    presets: [
      {
        id: 'default',
        name: 'Standardkulisse',
        description: 'Standardkulisse',
        preview: { accent: '#22c55e', background: '' },
        variants: {
          light: {
            label: 'Tag',
            variables: {
              '--bg-image': 'none',
              '--bg-overlay': 'none',
            },
          },
          dark: {
            label: 'Nacht',
            variables: {
              '--bg-image': 'none',
              '--bg-overlay': 'none',
            },
          },
        },
      },
    ],
  };
  let theme = null;
  let themeSelection = {
    presetId: themePresets.presets[0].id,
    variant: 'light',
    custom: {},
    updatedAt: null,
  };
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

  const toLobbyResponse = (lobby) => ({ ...lobby });

  const ensureLobbies = () => {
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

  ensureLobbies();

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

  const cloneThemePresets = () => JSON.parse(JSON.stringify(themePresets));

  const buildThemeState = () => {
    const preset = themePresets.presets[0];
    const resolved = {};
    Object.entries(preset.variants).forEach(([variantKey, variantConfig]) => {
      resolved[variantKey] = {
        variables: { ...(variantConfig.variables || {}) },
        assets: {
          presetBackgroundImage: variantConfig.variables?.['--bg-image'] || null,
        },
      };
    });
    return {
      presetsVersion: themePresets.version,
      preset: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        preview: { ...preset.preview },
      },
      selection: {
        presetId: themeSelection.presetId,
        variant: themeSelection.variant,
        custom: { ...(themeSelection.custom || {}) },
        updatedAt: themeSelection.updatedAt || undefined,
      },
      resolved,
      warnings: [],
    };
  };

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

      if (pathname.startsWith('/api/themes') && method === 'GET') {
        return response(200, cloneThemePresets());
      }

      if (pathname === '/api/theme') {
        if (method === 'GET') {
          if (!themeSelection) {
            themeSelection = {
              presetId: themePresets.presets[0].id,
              variant: theme || 'light',
              custom: {},
            };
          }
          if (theme) {
            themeSelection.variant = normalizeTheme(theme) || themeSelection.variant;
          }
          return response(200, buildThemeState());
        }
        if (method === 'PUT') {
          let update = payload?.selection ?? payload?.theme ?? payload;
          if (typeof update === 'string') {
            update = { variant: update };
          }
          const normalized = normalizeTheme(update?.variant);
          if (!normalized) {
            return response(400, { error: 'Ungültiges Theme.' });
          }
          themeSelection = {
            ...themeSelection,
            presetId: update?.presetId || themeSelection.presetId,
            variant: normalized,
            custom: update?.custom && typeof update.custom === 'object' ? { ...update.custom } : { ...(themeSelection.custom || {}) },
            updatedAt: new Date().toISOString(),
          };
          theme = normalized;
          storage.set('theme', normalized);
          return response(200, buildThemeState());
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
          summary: { sessionCount: sessions.length, players: savedNames.length },
          winrates: [],
          highlights: [],
          meta: {},
        });
      }

      if (pathname === '/api/lobbies') {
        if (method === 'GET') {
          return response(200, { lobbies: lobbies.map(toLobbyResponse) });
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
          return response(201, { lobby: toLobbyResponse(newLobby), lobbies: lobbies.map(toLobbyResponse) });
        }
      }

      if (pathname === '/api/lobbies/join' && method === 'POST') {
        return response(200, { lobby: lobbies[0] ? toLobbyResponse(lobbies[0]) : null, lobbies: lobbies.map(toLobbyResponse) });
      }

      const lobbyMembersMatch = pathname.match(/^\/api\/lobbies\/(\d+)\/members$/);
      if (lobbyMembersMatch && method === 'GET') {
        const lobbyId = Number(lobbyMembersMatch[1]);
        const members = lobbyMembers.get(lobbyId) || [];
        return response(200, { members: members.map((member) => ({ ...member })) });
      }

      const lobbyIdMatch = pathname.match(/^\/api\/lobbies\/(\d+)$/);
      if (lobbyIdMatch && method === 'DELETE') {
        const lobbyId = Number(lobbyIdMatch[1]);
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
      themeSelection = {
        presetId: themePresets.presets[0].id,
        variant: 'light',
        custom: {},
        updatedAt: null,
      };
      sessions = [];
      loggedIn = true;
      storedRoleSchema = null;
      ensureLobbies();
    },
    setTheme(value) {
      const normalized = normalizeTheme(value);
      if (normalized) {
        theme = normalized;
        themeSelection = {
          ...themeSelection,
          presetId: themeSelection.presetId || themePresets.presets[0].id,
          variant: normalized,
          updatedAt: new Date().toISOString(),
        };
        storage.set('theme', normalized);
      } else {
        theme = null;
        themeSelection = {
          presetId: themePresets.presets[0].id,
          variant: 'light',
          custom: {},
          updatedAt: null,
        };
        storage.delete('theme');
      }
    },
    getTheme() {
      return themeSelection?.variant || 'light';
    },
    getStorage(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
  };

  return backend;
}

async function bootstrap({ savedTheme, matchMediaDark = false } = {}) {
  jest.resetModules();
  jest.clearAllTimers();

  const backend = createBackendMock();
  backend.reset();
  if (typeof savedTheme === 'string') {
    backend.setTheme(savedTheme);
  }
  global.fetch = backend.fetch;

  document.body.innerHTML = bodyMatch
    ? bodyMatch[1].replace(/<script[^>]*src="script\.js"[^>]*><\/script>/i, '')
    : '';
  document.head.innerHTML = headMatch ? headMatch[1] : '';

  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);

  const themeListeners = [];
  const mediaQueryList = {
    matches: !!matchMediaDark,
    addEventListener: jest.fn((event, cb) => {
      if (event === 'change' && typeof cb === 'function') {
        themeListeners.push(cb);
      }
    }),
    removeEventListener: jest.fn(),
  };
  window.matchMedia = jest.fn(() => mediaQueryList);

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
  await new Promise((resolve) => setTimeout(resolve, 0));

  const testApi = window.__WERWOLF_TEST__;
  if (!testApi) {
    throw new Error('Test API not available');
  }

  delete window.__WERWOLF_TEST_BOOT__;

  testApi.setState({ peaceDays: 0 });

  return {
    backend,
    testApi,
    triggerThemeChange(matches) {
      themeListeners.forEach((listener) => listener({ matches }));
    },
  };
}

describe('State management and utility flows', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  test('setState converts legacy Bodyguard roles into jobs and updates trackers', async () => {
    const { testApi } = await bootstrap();

    testApi.setState({
      players: ['Anna', 'Bert', 'Clara'],
      rolesAssigned: ['Bodyguard', 'Werwolf', 'Dorfbewohner'],
      jobsAssigned: [[], [], []],
      deadPlayers: [],
    });

    const state = testApi.getState();
    expect(state.rolesAssigned).toEqual(['Dorfbewohner', 'Werwolf', 'Dorfbewohner']);
    expect(state.jobsAssigned[0]).toContain('Bodyguard');
    expect(state.bodyguardPlayers).toEqual(['Anna']);
  });

  test('explicit bodyguardPlayers reassignment replaces the current holder', async () => {
    const { testApi } = await bootstrap();

    testApi.setState({
      players: ['Anna', 'Bert', 'Clara'],
      rolesAssigned: ['Dorfbewohner', 'Dorfbewohner', 'Dorfbewohner'],
      jobsAssigned: [[], [], []],
    });

    testApi.setState({ bodyguardPlayers: ['Bert'] });
    let state = testApi.getState();
    expect(state.bodyguardPlayers).toEqual(['Bert']);
    expect(state.jobsAssigned[1]).toContain('Bodyguard');
    expect(state.jobsAssigned[0]).toEqual([]);

    testApi.setState({ bodyguardPlayers: ['Clara'] });
    state = testApi.getState();
    expect(state.bodyguardPlayers).toEqual(['Clara']);
    expect(state.jobsAssigned[2]).toContain('Bodyguard');
    expect(state.jobsAssigned[1]).toEqual([]);
  });

  test('jobConfig updates clamp bodyguard chance and persist to storage', async () => {
    const { testApi, backend } = await bootstrap();
    const slider = document.getElementById('bodyguard-job-chance');
    const display = document.getElementById('bodyguard-job-chance-display');

    testApi.setState({ jobConfig: { bodyguardChance: 1.5 } });
    let state = testApi.getState();
    expect(state.jobConfig.bodyguardChance).toBeCloseTo(1, 5);
    expect(slider.value).toBe('100');
    expect(display.textContent).toBe('100%');
    expect(JSON.parse(backend.getStorage('werwolfJobConfig')).bodyguardChance).toBe(1);

    testApi.setState({ jobConfig: { bodyguardChance: -0.3 } });
    state = testApi.getState();
    expect(state.jobConfig.bodyguardChance).toBeCloseTo(0, 5);
    expect(slider.value).toBe('0');
    expect(display.textContent).toBe('0%');
    expect(JSON.parse(backend.getStorage('werwolfJobConfig')).bodyguardChance).toBe(0);
  });

  test('reset-witch macro refreshes potions and records an action', async () => {
    const { testApi } = await bootstrap();

    testApi.setState({ healRemaining: 0, poisonRemaining: 0 });
    const executed = testApi.runMacro('reset-witch');

    expect(executed).toBe(true);
    const state = testApi.getState();
    expect(state.healRemaining).toBe(1);
    expect(state.poisonRemaining).toBe(1);
    const logEntry = testApi.getActionLog()[0];
    expect(logEntry.label).toBe('Makro: Hexentränke auffrischen');
    expect(logEntry.type).toBe('macro');
    expect(logEntry.detail).toContain('Heil 0');
  });

  test('reset-witch macro logs a no-op when both potions are available', async () => {
    const { testApi } = await bootstrap();

    const executed = testApi.runMacro('reset-witch');

    expect(executed).toBe(false);
    const logEntry = testApi.getActionLog()[0];
    expect(logEntry.label).toBe('Makro: Hexentränke auffrischen');
    expect(logEntry.detail).toContain('bereits über beide Tränke');
  });

  test('rewind-night macro revives current victims and clears pending list', async () => {
    const { testApi } = await bootstrap();

    testApi.setState({
      players: ['Anna', 'Bert'],
      rolesAssigned: ['Werwolf', 'Dorfbewohner'],
      jobsAssigned: [[], []],
      deadPlayers: ['Bert'],
      currentNightVictims: ['Bert'],
    });

    const executed = testApi.runMacro('rewind-night');
    expect(executed).toBe(true);

    const state = testApi.getState();
    expect(state.deadPlayers).toEqual([]);
    expect(state.currentNightVictims).toEqual([]);
    const logEntry = testApi.getActionLog()[0];
    expect(logEntry.label).toBe('Makro: Letzte Nacht rückgängig');
    expect(logEntry.detail).toContain('Bert');
  });

  test('running an unknown macro returns false without crashing', async () => {
    const { testApi } = await bootstrap();

    const beforeLog = testApi.getActionLog().slice();
    const executed = testApi.runMacro('does-not-exist');

    expect(executed).toBe(false);
    expect(testApi.getActionLog()).toEqual(beforeLog);
  });

  test('theme initialization respects stored preference and responds to changes without preference', async () => {
    let env = await bootstrap({ savedTheme: 'dark', matchMediaDark: false });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(env.backend.getTheme()).toBe('dark');
    env.triggerThemeChange(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    env = await bootstrap({ matchMediaDark: false });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(env.backend.getTheme()).toBe('light');
    env.triggerThemeChange(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(env.backend.getTheme()).toBe('dark');
  });

  test('job chances persist across rounds and assigned cards display the jobs', async () => {
    const { testApi } = await bootstrap();

    const bodyguardSlider = document.getElementById('bodyguard-job-chance');
    const doctorSlider = document.getElementById('doctor-job-chance');

    bodyguardSlider.value = '100';
    bodyguardSlider.dispatchEvent(new Event('input', { bubbles: true }));
    bodyguardSlider.dispatchEvent(new Event('change', { bubbles: true }));

    doctorSlider.value = '100';
    doctorSlider.dispatchEvent(new Event('input', { bubbles: true }));
    doctorSlider.dispatchEvent(new Event('change', { bubbles: true }));

    const playersInput = document.getElementById('players');
    playersInput.value = 'Anna\nBert\nClara';
    playersInput.dispatchEvent(new Event('input', { bubbles: true }));

    const findRow = (name) => Array.from(document.querySelectorAll('.role-row'))
      .find((row) => row.querySelector("input[type='text']").value === name);

    findRow('Dorfbewohner').querySelector('.qty-display').textContent = '2';
    findRow('Werwolf').querySelector('.qty-display').textContent = '1';

    document.getElementById('assign').click();

    const roleTexts = Array.from(document.querySelectorAll('.reveal-card .role-name'))
      .map((el) => el.textContent);

    expect(roleTexts.some((text) => text.includes('Bodyguard'))).toBe(true);
    expect(roleTexts.some((text) => text.includes('Arzt'))).toBe(true);

    expect(bodyguardSlider.value).toBe('100');
    expect(document.getElementById('bodyguard-job-chance-display').textContent).toBe('100%');
    expect(doctorSlider.value).toBe('100');
    expect(document.getElementById('doctor-job-chance-display').textContent).toBe('100%');

    document.getElementById('finish-btn').click();

    expect(bodyguardSlider.value).toBe('100');
    expect(document.getElementById('bodyguard-job-chance-display').textContent).toBe('100%');
    expect(doctorSlider.value).toBe('100');
    expect(document.getElementById('doctor-job-chance-display').textContent).toBe('100%');

    playersInput.value = 'Anna\nBert\nClara';
    playersInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('assign').click();

    const secondRoleTexts = Array.from(document.querySelectorAll('.reveal-card .role-name'))
      .map((el) => el.textContent);

    expect(secondRoleTexts.some((text) => text.includes('Bodyguard'))).toBe(true);
    expect(secondRoleTexts.some((text) => text.includes('Arzt'))).toBe(true);

    expect(bodyguardSlider.value).toBe('100');
    expect(document.getElementById('bodyguard-job-chance-display').textContent).toBe('100%');
    expect(doctorSlider.value).toBe('100');
    expect(document.getElementById('doctor-job-chance-display').textContent).toBe('100%');

    const state = testApi.getState();
    expect(state.jobConfig.bodyguardChance).toBe(1);
    expect(state.jobConfig.doctorChance).toBe(1);
  });
});
