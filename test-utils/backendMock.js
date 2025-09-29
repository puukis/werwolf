function createBackendMock() {
  const defaultUser = {
    id: 1,
    email: 'test@narrator.de',
    displayName: 'Testleitung',
    isAdmin: true,
  };

  const ownerStorage = new Map();
  const lobbyState = new Map();
  const defaultLobbies = () => [{ id: 1, name: 'Test-Lobby', joinCode: 'start', ownerId: defaultUser.id }];
  let lobbies = defaultLobbies();
  let nextLobbyId = 2;
  let theme = null;
  let loggedIn = true;

  const normalizeTheme = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    return trimmed === 'dark' || trimmed === 'light' ? trimmed : null;
  };

  const ensureLobbyState = (lobbyId) => {
    if (!lobbyState.has(lobbyId)) {
      lobbyState.set(lobbyId, {
        savedNames: [],
        savedRoles: [],
        storage: new Map(),
        sessions: [],
      });
    }
    return lobbyState.get(lobbyId);
  };

  const getLobbyIdFromHeaders = (options = {}) => {
    const headers = options.headers || {};
    const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-werwolf-lobby');
    if (headerKey) {
      const parsed = Number(headers[headerKey]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return lobbies[0]?.id || null;
  };

  const serializeLobby = (lobby) => ({
    id: lobby.id,
    name: lobby.name,
    joinCode: lobby.joinCode,
    role: 'owner',
    ownerId: lobby.ownerId,
  });

  if (lobbies.length > 0) {
    ensureLobbyState(lobbies[0].id);
  }

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
          ownerStorage.set('theme', normalized);
          return response(200, { theme });
        }
      }

      if (pathname === '/api/lobbies') {
        if (method === 'GET') {
          return response(200, { lobbies: lobbies.map((lobby) => serializeLobby(lobby)) });
        }
        if (method === 'POST') {
          const name = typeof payload?.name === 'string' && payload.name.trim().length > 0
            ? payload.name.trim()
            : `Lobby ${nextLobbyId}`;
          const lobby = {
            id: nextLobbyId++,
            name,
            joinCode: `code${Math.random().toString(16).slice(2, 8)}`,
            ownerId: defaultUser.id,
          };
          lobbies.push(lobby);
          ensureLobbyState(lobby.id);
          return response(201, { lobby: serializeLobby(lobby) });
        }
      }

      if (pathname === '/api/lobbies/join' && method === 'POST') {
        const code = typeof payload?.joinCode === 'string' ? payload.joinCode.trim() : '';
        const lobby = lobbies.find((entry) => entry.joinCode === code);
        if (!lobby) {
          return response(404, { error: 'Lobby nicht gefunden.' });
        }
        ensureLobbyState(lobby.id);
        return response(200, { lobby: serializeLobby(lobby) });
      }

      if (pathname.startsWith('/api/lobbies/') && pathname.endsWith('/join-code') && method === 'POST') {
        const lobbyId = Number(pathname.split('/')[3]);
        const lobby = lobbies.find((entry) => entry.id === lobbyId);
        if (!lobby) {
          return response(404, { error: 'Lobby nicht gefunden.' });
        }
        lobby.joinCode = `code${Math.random().toString(16).slice(2, 8)}`;
        return response(200, { joinCode: lobby.joinCode });
      }

      if (pathname.startsWith('/api/lobbies/') && method === 'PUT') {
        const lobbyId = Number(pathname.split('/')[3]);
        const lobby = lobbies.find((entry) => entry.id === lobbyId);
        if (!lobby) {
          return response(404, { error: 'Lobby nicht gefunden.' });
        }
        if (typeof payload?.name === 'string' && payload.name.trim().length > 0) {
          lobby.name = payload.name.trim();
        }
        return response(200, { lobby: serializeLobby(lobby) });
      }

      if (pathname.startsWith('/api/lobbies/') && method === 'DELETE') {
        const parts = pathname.split('/');
        const lobbyId = Number(parts[3]);
        if (Number.isFinite(lobbyId)) {
          lobbies = lobbies.filter((entry) => entry.id !== lobbyId);
          lobbyState.delete(lobbyId);
        }
        if (lobbies.length === 0) {
          lobbies = defaultLobbies();
        }
        return empty();
      }

      if (pathname.endsWith('/members/me') && pathname.startsWith('/api/lobbies/') && method === 'DELETE') {
        const lobbyId = Number(pathname.split('/')[3]);
        if (Number.isFinite(lobbyId)) {
          lobbies = lobbies.filter((entry) => entry.id !== lobbyId);
          lobbyState.delete(lobbyId);
        }
        if (lobbies.length === 0) {
          lobbies = defaultLobbies();
        }
        return empty();
      }

      if (pathname === '/api/saved-names') {
        const lobbyId = getLobbyIdFromHeaders(options);
        const state = ensureLobbyState(lobbyId);
        if (method === 'GET') {
          return response(200, { names: state.savedNames.slice() });
        }
        if (method === 'PUT') {
          const names = Array.isArray(payload?.names)
            ? payload.names.filter((name) => typeof name === 'string' && name.trim().length > 0)
            : [];
          state.savedNames = names.map((name) => name.trim());
          return response(200, { names: state.savedNames.slice() });
        }
      }

      if (pathname === '/api/role-presets') {
        const lobbyId = getLobbyIdFromHeaders(options);
        const state = ensureLobbyState(lobbyId);
        if (method === 'GET') {
          return response(200, { roles: state.savedRoles.map((role) => ({ ...role })) });
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
          state.savedRoles = roles.map((role) => ({ ...role }));
          return response(200, { roles: state.savedRoles.map((role) => ({ ...role })) });
        }
      }

      if (pathname.startsWith('/api/storage/')) {
        const key = decodeURIComponent(pathname.replace('/api/storage/', ''));
        const lobbyId = getLobbyIdFromHeaders(options);
        const state = ensureLobbyState(lobbyId);
        if (method === 'GET') {
          return response(200, { key, value: state.storage.has(key) ? state.storage.get(key) : null });
        }
        if (method === 'PUT') {
          const value = payload ? payload.value ?? null : null;
          state.storage.set(key, value);
          return response(200, { key, value });
        }
        if (method === 'DELETE') {
          state.storage.delete(key);
          return empty();
        }
      }

      if (pathname === '/api/sessions') {
        const lobbyId = getLobbyIdFromHeaders(options);
        const state = ensureLobbyState(lobbyId);
        if (method === 'GET') {
          const ordered = state.sessions.slice().sort((a, b) => b.timestamp - a.timestamp);
          return response(200, { sessions: ordered.slice(0, 20) });
        }
        if (method === 'POST') {
          if (!payload || typeof payload.session !== 'object') {
            return response(400, { error: 'Ungültige Session.' });
          }
          const timestamp = Number(payload.session.timestamp || Date.now());
          const normalized = { ...payload.session, timestamp };
          state.sessions = state.sessions.filter((session) => session.timestamp !== timestamp);
          state.sessions.push(normalized);
          state.sessions.sort((a, b) => b.timestamp - a.timestamp);
          state.sessions = state.sessions.slice(0, 20);
          return response(201, { session: normalized, sessions: state.sessions.slice() });
        }
      }

      if (pathname.startsWith('/api/sessions/')) {
        const lobbyId = getLobbyIdFromHeaders(options);
        const state = ensureLobbyState(lobbyId);
        if (method === 'DELETE') {
          const timestamp = Number(pathname.split('/').pop());
          state.sessions = state.sessions.filter((session) => session.timestamp !== timestamp);
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

      return response(404, { error: 'Nicht gefunden' });
    }),
    reset() {
      ownerStorage.clear();
      lobbyState.clear();
      lobbies = defaultLobbies();
      ensureLobbyState(lobbies[0].id);
      nextLobbyId = 2;
      theme = null;
      loggedIn = true;
    },
    setTheme(value) {
      theme = typeof value === 'string' ? value : null;
      if (theme) {
        ownerStorage.set('theme', theme);
      } else {
        ownerStorage.delete('theme');
      }
    },
    getTheme() {
      return theme;
    },
    getStorage(key, lobbyId = lobbies[0]?.id) {
      if (!Number.isFinite(lobbyId)) {
        return null;
      }
      const state = ensureLobbyState(lobbyId);
      return state.storage.has(key) ? state.storage.get(key) : null;
    },
  };

  return backend;
}

module.exports = { createBackendMock };

