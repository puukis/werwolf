/* Rollen Geber – Client-side JS */

let authManager = null;

const apiClient = (() => {
  const baseUrl = '/api';
  const storageCache = new Map();
  const inflightReads = new Map();

  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const config = { method, headers };

    if (options.body !== undefined) {
      config.body = options.body;
      if (!headers['Content-Type'] && method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
      }
    }

    config.credentials = 'include';

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, config);
    } catch (networkError) {
      const error = new Error('Verbindung zum Server konnte nicht hergestellt werden.');
      error.cause = networkError;
      throw error;
    }

    if (!response.ok) {
      let message = `Anfrage fehlgeschlagen (${response.status})`;
      try {
        if (typeof response.json === 'function') {
          const data = await response.json();
          if (data && typeof data.error === 'string') {
            message = data.error;
          } else if (data && typeof data.message === 'string') {
            message = data.message;
          }
        } else if (typeof response.text === 'function') {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }
      } catch (error) {
        // ignore parsing issues – fall back to default message
      }
      const error = new Error(message);
      error.status = response.status;
      if (error.status === 401 && authManager && typeof authManager.handleUnauthorized === 'function') {
        authManager.handleUnauthorized(message);
      }
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    if (typeof response.json === 'function') {
      try {
        return await response.json();
      } catch (error) {
        return null;
      }
    }

    if (typeof response.text === 'function') {
      const text = await response.text();
      if (!text) {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  function cacheValue(key, value) {
    storageCache.set(key, value ?? null);
  }

  function clearCaches() {
    storageCache.clear();
    inflightReads.clear();
  }

  async function getStorageItem(key) {
    if (storageCache.has(key)) {
      return storageCache.get(key);
    }
    if (inflightReads.has(key)) {
      return inflightReads.get(key);
    }

    const promise = request(`/storage/${encodeURIComponent(key)}`)
      .then((data) => {
        const value = data && Object.prototype.hasOwnProperty.call(data, 'value')
          ? data.value
          : null;
        cacheValue(key, value);
        inflightReads.delete(key);
        return value;
      })
      .catch((error) => {
        inflightReads.delete(key);
        throw error;
      });

    inflightReads.set(key, promise);
    return promise;
  }

  function getCachedStorageItem(key) {
    return storageCache.has(key) ? storageCache.get(key) : null;
  }

  async function setStorageItem(key, value) {
    cacheValue(key, value);
    await request(`/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    return value;
  }

  async function removeStorageItem(key) {
    storageCache.delete(key);
    await request(`/storage/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  async function prefetchStorage(keys) {
    await Promise.all(
      keys.map((key) =>
        getStorageItem(key).catch(() => null)
      )
    );
  }

  return {
    request,
    clearCaches,
    storage: {
      getItem: getStorageItem,
      getCachedItem: getCachedStorageItem,
      setItem: setStorageItem,
      removeItem: removeStorageItem,
      prefetch: prefetchStorage,
    },
    theme: {
      async get() {
        const data = await request('/theme');
        return typeof data?.theme === 'string' ? data.theme : null;
      },
      async set(theme) {
        await request('/theme', {
          method: 'PUT',
          body: JSON.stringify({ theme }),
        });
        cacheValue('theme', theme);
        return theme;
      },
    },
    savedNames: {
      async get() {
        const data = await request('/saved-names');
        const names = Array.isArray(data?.names) ? data.names : [];
        cacheValue('werwolfSavedNames', names);
        return names;
      },
      async set(names) {
        await request('/saved-names', {
          method: 'PUT',
          body: JSON.stringify({ names }),
        });
        cacheValue('werwolfSavedNames', names);
        return names;
      },
    },
    rolePresets: {
      async get() {
        const data = await request('/role-presets');
        const roles = Array.isArray(data?.roles) ? data.roles : [];
        cacheValue('werwolfSavedRoles', roles);
        return roles;
      },
      async set(roles) {
        await request('/role-presets', {
          method: 'PUT',
          body: JSON.stringify({ roles }),
        });
        cacheValue('werwolfSavedRoles', roles);
        return roles;
      },
    },
    sessions: {
      async list() {
        const data = await request('/sessions');
        return Array.isArray(data?.sessions) ? data.sessions : [];
      },
      async create(session) {
        return request('/sessions', {
          method: 'POST',
          body: JSON.stringify({ session }),
        });
      },
      async remove(timestamp) {
        await request(`/sessions/${encodeURIComponent(timestamp)}`, {
          method: 'DELETE',
        });
      },
    },
    auth: {
      async me() {
        const data = await request('/auth/me');
        return data?.user ?? null;
      },
      async login(credentials) {
        const data = await request('/auth/login', {
          method: 'POST',
          body: JSON.stringify(credentials),
        });
        return data?.user ?? null;
      },
      async register(payload) {
        const data = await request('/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return data?.user ?? null;
      },
      async logout() {
        await request('/auth/logout', { method: 'POST' });
      },
    },
  };
})();

function createAuthManager() {
  const welcomeScreen = document.getElementById('welcome-screen');
  const authTabs = Array.from(document.querySelectorAll('[data-auth-target]'));
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authForms = { login: loginForm, register: registerForm };
  const authMessage = document.getElementById('auth-message');
  const loginEmailInput = document.getElementById('login-email');
  const loginPasswordInput = document.getElementById('login-password');
  const registerNameInput = document.getElementById('register-display-name');
  const registerEmailInput = document.getElementById('register-email');
  const registerPasswordInput = document.getElementById('register-password');
  const registerAdminInput = document.getElementById('register-admin-code');
  const userChip = document.getElementById('user-chip');
  const userNameEl = document.getElementById('user-name');
  const userRoleEl = document.getElementById('user-role');
  const logoutBtn = document.getElementById('logout-btn');

  let activeForm = 'login';
  let messageTimeout = null;
  let formPending = false;
  let currentUser = null;
  const waiters = [];

  const cloneUser = (user) => (user ? { ...user } : null);

  function clearMessage() {
    if (!authMessage) {
      return;
    }
    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }
    authMessage.textContent = '';
    authMessage.classList.remove('visible', 'error', 'success', 'info');
    authMessage.removeAttribute('data-variant');
  }

  function setMessage(text, variant = 'info', { persist = false } = {}) {
    if (!authMessage) {
      return;
    }

    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }

    authMessage.textContent = text;
    authMessage.dataset.variant = variant;
    authMessage.classList.add('visible');
    authMessage.classList.remove('error', 'success', 'info');
    authMessage.classList.add(variant);

    if (!persist) {
      messageTimeout = setTimeout(() => {
        if (authMessage) {
          authMessage.classList.remove('visible', 'error', 'success', 'info');
          authMessage.textContent = '';
          authMessage.removeAttribute('data-variant');
        }
        messageTimeout = null;
      }, 6000);
    }
  }

  function focusActiveForm() {
    const targetInput = activeForm === 'register'
      ? (registerNameInput || registerEmailInput)
      : loginEmailInput;
    if (targetInput) {
      const focusHandler = () => {
        targetInput.focus();
        targetInput.select?.();
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(focusHandler);
      } else {
        setTimeout(focusHandler, 0);
      }
    }
  }

  function toggleScreen(show) {
    if (!welcomeScreen) {
      return;
    }

    if (show) {
      welcomeScreen.classList.add('visible');
      welcomeScreen.setAttribute('aria-hidden', 'false');
      document.body.classList.add('auth-locked');
      focusActiveForm();
    } else {
      welcomeScreen.classList.remove('visible');
      welcomeScreen.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('auth-locked');
    }
  }

  function setActiveForm(target) {
    const normalized = target === 'register' ? 'register' : 'login';
    activeForm = normalized;

    authTabs.forEach((tab) => {
      if (!tab) {
        return;
      }
      const tabTarget = tab.dataset.authTarget;
      const isActive = tabTarget === normalized;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    Object.entries(authForms).forEach(([name, form]) => {
      if (!form) {
        return;
      }
      form.classList.toggle('active', name === normalized);
    });

    if (welcomeScreen?.classList.contains('visible')) {
      focusActiveForm();
    }
  }

  function updateUserChip() {
    if (!userChip) {
      return;
    }

    if (!currentUser) {
      userChip.classList.add('hidden');
      userChip.setAttribute('aria-hidden', 'true');
      if (userNameEl) {
        userNameEl.textContent = '';
      }
      if (userRoleEl) {
        userRoleEl.textContent = '';
        userRoleEl.classList.add('hidden');
      }
      if (logoutBtn) {
        logoutBtn.classList.add('hidden');
        logoutBtn.disabled = false;
      }
      return;
    }

    userChip.classList.remove('hidden');
    userChip.setAttribute('aria-hidden', 'false');
    if (userNameEl) {
      userNameEl.textContent = currentUser.displayName || currentUser.email || 'Spielleitung';
    }
    if (userRoleEl) {
      if (currentUser.isAdmin) {
        userRoleEl.textContent = 'Admin';
        userRoleEl.classList.remove('hidden');
      } else {
        userRoleEl.textContent = '';
        userRoleEl.classList.add('hidden');
      }
    }
    if (logoutBtn) {
      logoutBtn.classList.remove('hidden');
      logoutBtn.disabled = false;
    }
  }

  function resolveWaiters(user) {
    if (!waiters.length) {
      return;
    }
    const snapshot = cloneUser(user);
    while (waiters.length) {
      const resolve = waiters.shift();
      try {
        resolve(snapshot);
      } catch (error) {
        console.error('Auth-Warteschlange fehlgeschlagen:', error);
      }
    }
  }

  function applyUser(user, { refreshCaches = false, suppressScreen = false } = {}) {
    const previousId = currentUser?.id ?? null;
    currentUser = user ? cloneUser(user) : null;

    const nextId = currentUser?.id ?? null;
    const shouldRefreshCaches = refreshCaches || previousId !== nextId;
    if (shouldRefreshCaches) {
      apiClient.clearCaches();
    }

    updateUserChip();

    if (currentUser) {
      if (!suppressScreen) {
        toggleScreen(false);
      }
      clearMessage();
      resolveWaiters(currentUser);
    } else if (!suppressScreen) {
      setActiveForm('login');
      toggleScreen(true);
    }
  }

  function handleUnauthorized(message) {
    if (message) {
      setMessage(message, 'error', { persist: true });
    }
    applyUser(null, { refreshCaches: true });
    setActiveForm('login');
  }

  function waitForAuth() {
    if (currentUser) {
      return Promise.resolve(cloneUser(currentUser));
    }
    return new Promise((resolve) => {
      waiters.push((user) => resolve(cloneUser(user)));
    });
  }

  authTabs.forEach((tab) => {
    if (!tab) {
      return;
    }
    tab.addEventListener('click', () => {
      setActiveForm(tab.dataset.authTarget);
      clearMessage();
    });
  });

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (formPending) {
        return;
      }

      const email = loginEmailInput?.value.trim() ?? '';
      const password = loginPasswordInput?.value ?? '';

      if (!email || !password) {
        setMessage('Bitte gib E-Mail und Passwort ein.', 'error');
        return;
      }

      formPending = true;
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
      }

      try {
        const user = await apiClient.auth.login({ email, password });
        if (user) {
          loginForm.reset();
          applyUser(user, { refreshCaches: true });
        } else {
          setMessage('Anmeldung fehlgeschlagen.', 'error', { persist: true });
        }
      } catch (error) {
        setMessage(error?.message || 'Anmeldung fehlgeschlagen.', 'error', { persist: true });
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('loading');
        }
        formPending = false;
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (formPending) {
        return;
      }

      const displayName = registerNameInput?.value.trim() ?? '';
      const email = registerEmailInput?.value.trim() ?? '';
      const password = registerPasswordInput?.value ?? '';
      const adminCodeRaw = registerAdminInput?.value.trim() ?? '';

      if (!displayName || !email || !password) {
        setMessage('Bitte fülle alle Pflichtfelder aus.', 'error');
        return;
      }

      formPending = true;
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
      }

      try {
        const payload = { displayName, email, password };
        if (adminCodeRaw) {
          payload.adminCode = adminCodeRaw;
        }
        const user = await apiClient.auth.register(payload);
        if (user) {
          registerForm.reset();
          applyUser(user, { refreshCaches: true });
        } else {
          setMessage('Registrierung fehlgeschlagen.', 'error', { persist: true });
        }
      } catch (error) {
        setMessage(error?.message || 'Registrierung fehlgeschlagen.', 'error', { persist: true });
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('loading');
        }
        formPending = false;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (formPending) {
        return;
      }
      formPending = true;
      logoutBtn.disabled = true;
      try {
        await apiClient.auth.logout();
        setMessage('Du wurdest abgemeldet. Bis bald!', 'info');
      } catch (error) {
        setMessage(error?.message || 'Abmelden fehlgeschlagen.', 'error', { persist: true });
      } finally {
        applyUser(null, { refreshCaches: true });
        setActiveForm('login');
        formPending = false;
        logoutBtn.disabled = false;
      }
    });
  }

  async function bootstrap() {
    setActiveForm('login');
    updateUserChip();

    const bootUser = typeof window !== 'undefined' && window.__WERWOLF_TEST_BOOT__
      ? window.__WERWOLF_TEST_BOOT__.user
      : null;

    if (bootUser) {
      applyUser(bootUser, { refreshCaches: true, suppressScreen: true });
      toggleScreen(false);
      return cloneUser(currentUser);
    }

    try {
      const user = await apiClient.auth.me();
      if (user) {
        applyUser(user, { suppressScreen: true });
        toggleScreen(false);
        return cloneUser(currentUser);
      }
      setMessage('Bitte melde dich an, um weiterzuspielen.', 'info');
    } catch (error) {
      if (error?.status && error.status !== 401) {
        setMessage(error.message || 'Anmeldung momentan nicht möglich.', 'error', { persist: true });
      }
    }

    setActiveForm('login');
    toggleScreen(true);
    return null;
  }

  return {
    bootstrap,
    waitForAuth,
    getUser() {
      return cloneUser(currentUser);
    },
    forceUser(user, options = {}) {
      applyUser(user, { refreshCaches: true, suppressScreen: Boolean(options?.suppressScreen) });
    },
    handleUnauthorized,
    showLogin() {
      setActiveForm('login');
      toggleScreen(true);
    },
    showRegister() {
      setActiveForm('register');
      toggleScreen(true);
    },
  };
}

let currentTheme = 'light';
let themePreferenceStored = false;

async function setTheme(theme, { persist = true, markPreference = true } = {}) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  if (!persist) {
    return theme;
  }

  try {
    await apiClient.theme.set(theme);
    if (markPreference) {
      themePreferenceStored = true;
    }
  } catch (error) {
    themePreferenceStored = false;
    throw error;
  }

  return theme;
}

// Initialize theme from the backend or system preference
async function initTheme() {
  try {
    const savedTheme = await apiClient.theme.get();
    if (typeof savedTheme === 'string' && savedTheme.trim().length > 0) {
      currentTheme = savedTheme;
      themePreferenceStored = true;
      document.documentElement.setAttribute('data-theme', savedTheme);
      return savedTheme;
    }
  } catch (error) {
    console.error('Theme konnte nicht geladen werden.', error);
  }

  themePreferenceStored = false;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    await setTheme(prefersDark ? 'dark' : 'light', { markPreference: false });
  } catch (error) {
    console.error('Theme konnte nicht gespeichert werden.', error);
  }
  return currentTheme;
}

document.addEventListener("DOMContentLoaded", async () => {
  authManager = createAuthManager();
  await authManager.bootstrap();

  try {
    if (!authManager.getUser()) {
      await authManager.waitForAuth();
    }
  } catch (error) {
    console.error('Anmeldung konnte nicht abgeschlossen werden.', error);
    return;
  }

  const playersInput = document.getElementById('players');
  if (playersInput) {
    playersInput.value = '';
  }

  const storageKeysToPrefetch = [
    'werwolfEventConfig',
    'werwolfJobConfig',
    'werwolfBloodMoonConfig',
    'werwolfPhoenixPulseConfig',
    'werwolfEventEngineState',
    'eventsEnabled',
    'revealDeadRoles',
    'bloodMoonPityTimer',
    'werwolfSavedNames',
    'werwolfSavedRoles',
    'werwolfLastUsed'
  ];

  try {
    await apiClient.storage.prefetch(storageKeysToPrefetch);
  } catch (error) {
    console.error('Persistente Werte konnten nicht geladen werden.', error);
  }

  await initTheme();

  // Sidebar elements and toggle
  const sessionsSidebar = document.getElementById('sessions-sidebar');
  const sessionsList = document.getElementById('sessions-list');
  const sessionsToggle = document.getElementById('sessions-toggle');

  if (sessionsToggle) {
    sessionsToggle.addEventListener('click', () => {
      sessionsSidebar.classList.toggle('show');
      document.body.classList.toggle('sidebar-open');
    });
  }

  const saveGameBtn = document.getElementById('save-game-btn');
  if (saveGameBtn) {
    saveGameBtn.addEventListener('click', async () => {
      await withButtonLoading(saveGameBtn, 'Speichere …', async () => {
        try {
          const session = await saveSession();
          const playerCount = Array.isArray(session.players) ? session.players.length : players.length;
          const detail = playerCount
            ? `${playerCount} Spielende gespeichert.`
            : 'Leerer Spielstand gespeichert.';
          showInfoMessage({
            title: 'Spiel gespeichert',
            text: 'Der aktuelle Spielstand wurde gesichert.',
            confirmText: 'Okay',
            log: { type: 'info', label: 'Session gespeichert', detail }
          });
        } catch (error) {
          showInfoMessage({
            title: 'Speichern fehlgeschlagen',
            text: 'Der aktuelle Spielstand konnte nicht gesichert werden.',
            confirmText: 'Okay',
            log: { type: 'error', label: 'Session speichern fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
          });
        }
      });
    });
  }
  
  // Theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const previousTheme = currentTheme;
      const newTheme = previousTheme === 'dark' ? 'light' : 'dark';
      try {
        await setTheme(newTheme);
      } catch (error) {
        document.documentElement.setAttribute('data-theme', previousTheme);
        currentTheme = previousTheme;
        showInfoMessage({
          title: 'Theme konnte nicht gespeichert werden',
          text: 'Die Verbindung zum Speicher-Backend ist fehlgeschlagen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Theme speichern fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  }

  const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', (event) => {
    if (!themePreferenceStored) {
      setTheme(event.matches ? 'dark' : 'light').catch((error) => {
        console.error('Automatische Theme-Aktualisierung fehlgeschlagen.', error);
      });
    }
  });
  const rolesContainerVillage = document.getElementById("roles-container-village");
  const rolesContainerWerwolf = document.getElementById("roles-container-werwolf");
  const rolesContainerSpecial = document.getElementById("roles-container-special");
  const addRoleBtn = document.getElementById("add-role");
  const assignBtn = document.getElementById("assign");
  const resultOutput = document.getElementById("result-output");
  const nextBtn = document.getElementById("next-btn");
  const finishBtn = document.getElementById("finish-btn");
  const startNightBtn = document.getElementById("start-night-btn");
  const nightOverlay = document.getElementById("night-overlay");
  const nightRoleEl = document.getElementById("night-role");
  const nightTextEl = document.getElementById("night-text");
  const nightNextBtn = document.getElementById("night-next-btn");
  const nightChoices = document.getElementById("night-choices");
  const witchActions = document.getElementById("witch-actions");
  const eventsEnabledCheckbox = document.getElementById('events-enabled');
  const bloodMoonEnabledCheckbox = document.getElementById('blood-moon-enabled');
  const firstNightShieldCheckbox = document.getElementById('first-night-shield');
  const phoenixPulseEnabledCheckbox = document.getElementById('phoenix-pulse-enabled');
  const revealDeadRolesCheckbox = document.getElementById('reveal-dead-roles');
  const bloodMoonChanceInput = document.getElementById('blood-moon-chance');
  const bloodMoonChanceDisplay = document.getElementById('blood-moon-chance-display');
  const phoenixPulseChanceInput = document.getElementById('phoenix-pulse-chance');
  const phoenixPulseChanceDisplay = document.getElementById('phoenix-pulse-chance-display');
  const bodyguardJobChanceInput = document.getElementById('bodyguard-job-chance');
  const bodyguardJobChanceDisplay = document.getElementById('bodyguard-job-chance-display');
  const doctorJobChanceInput = document.getElementById('doctor-job-chance');
  const doctorJobChanceDisplay = document.getElementById('doctor-job-chance-display');
  const eventDeckListEl = document.getElementById('event-deck-list');
  const campaignSelectEl = document.getElementById('campaign-select');
  const campaignPreviewListEl = document.getElementById('campaign-preview-list');
  const eventCardPreviewListEl = document.getElementById('event-card-preview');
  const openConfigBtn = document.getElementById('open-config-btn');
  const configModal = document.getElementById('config-modal');
  const closeConfigBtn = document.getElementById('close-config-btn');
  const closeConfigFooterBtn = document.getElementById('close-config-footer-btn');
  const JOB_CONFIG_STORAGE_KEY = 'werwolfJobConfig';
  const EVENT_CONFIG_STORAGE_KEY = 'werwolfEventConfig';
  const BLOOD_MOON_CONFIG_STORAGE_KEY = 'werwolfBloodMoonConfig';
  const DEFAULT_PHOENIX_PULSE_CHANCE = 0.05;
  const PHOENIX_PULSE_CONFIG_STORAGE_KEY = 'werwolfPhoenixPulseConfig';
  const EVENT_ENGINE_STORAGE_KEY = 'werwolfEventEngineState';
  const defaultJobConfig = { bodyguardChance: 0, doctorChance: 0 };
  let jobConfigSaveTimeout = null;
  const defaultBloodMoonConfig = { baseChance: 0.2 };
  const defaultPhoenixPulseConfig = { chance: DEFAULT_PHOENIX_PULSE_CHANCE };

  function getPersistedValue(key) {
    return apiClient.storage.getCachedItem(key);
  }

  function persistValue(key, value) {
    apiClient.storage.setItem(key, value).catch((error) => {
      console.error(`Speichern des Schlüssels "${key}" fehlgeschlagen.`, error);
    });
  }

  async function refreshPersistedValue(key) {
    try {
      return await apiClient.storage.getItem(key);
    } catch (error) {
      console.error(`Laden des Schlüssels "${key}" fehlgeschlagen.`, error);
      return apiClient.storage.getCachedItem(key);
    }
  }

  async function withButtonLoading(button, loadingText, task) {
    if (!button) {
      return task();
    }
    const originalText = button.textContent;
    button.disabled = true;
    if (typeof loadingText === 'string') {
      button.textContent = loadingText;
    }
    try {
      return await task();
    } finally {
      button.disabled = false;
      if (typeof loadingText === 'string') {
        button.textContent = originalText;
      }
    }
  }

  const eventDeckMetadata = Array.isArray(window.WERWOLF_EVENT_DECKS)
    ? window.WERWOLF_EVENT_DECKS.slice()
    : [];
  const eventCardDefinitions = Array.isArray(window.WERWOLF_EVENT_DEFINITIONS)
    ? window.WERWOLF_EVENT_DEFINITIONS.slice()
    : [];
  const campaignDefinitions = Array.isArray(window.WERWOLF_CAMPAIGNS)
    ? window.WERWOLF_CAMPAIGNS.slice()
    : [];

  if (eventDeckMetadata.length === 0) {
    eventDeckMetadata.push({
      id: 'legacy',
      name: 'Klassisches Deck',
      description: 'Erhält die bekannten Ereignisse Blutmond und Phoenix Pulse.'
    });
  }

  if (eventCardDefinitions.length === 0) {
    eventCardDefinitions.push(
      {
        id: 'blood-moon',
        legacyKey: 'bloodMoon',
        deckId: 'legacy',
        label: '🌕 Blutmond',
        description: 'Der Mond färbt sich rot – die Werwölfe dürfen ein zweites Opfer wählen.',
        cooldownNights: 1,
        pityKey: 'bloodMoonPityTimer',
        trigger(context) {
          if (!context.flags.randomEventsEnabled || !context.flags.bloodMoonEnabled) {
            return { triggered: false, reason: 'disabled' };
          }

          if (context.state.bloodMoonActive) {
            context.storage.setNumber(this.pityKey, 0);
            return { triggered: true, reason: 'forced' };
          }

          const pityTimer = context.storage.getNumber(this.pityKey, 0);
          const chance = context.helpers.getBloodMoonChance(pityTimer);
          const roll = context.random();
          const triggeredByChance = roll < chance;
          let triggered = triggeredByChance;
          let nextPity = triggered ? 0 : pityTimer + 1;
          if (!triggered && nextPity >= 3) {
            triggered = true;
            nextPity = 0;
          }
          context.storage.setNumber(this.pityKey, nextPity);

          return {
            triggered,
            pityTimer,
            chance,
            roll,
            nextPity,
            triggeredByChance
          };
        },
        effect({ scheduler, helpers, meta, nightNumber }) {
          if (!meta || !meta.triggered) {
            return { skipped: true };
          }

          scheduler.addModifier({
            id: 'blood-moon',
            label: '🌕 Blutmond',
            expiresAfterNight: nightNumber,
            originCardId: 'blood-moon'
          });

          return {
            log: {
              type: 'event',
              label: 'Blutmond steigt auf',
              detail: 'Die Werwölfe dürfen in dieser Nacht zwei Opfer wählen.'
            },
            narratorNote: 'Die Werwölfe wählen zwei Opfer.',
            meta
          };
        },
        preview() {
          return 'Werwölfe wählen zwei Opfer.';
        }
      },
      {
        id: 'phoenix-pulse',
        legacyKey: 'phoenixPulse',
        deckId: 'legacy',
        label: '🔥 Phoenix Pulse',
        description: 'Eine uralte Energie lodert durch das Dorf – Nachtopfer werden wiederbelebt.',
        trigger(context) {
          if (!context.flags.randomEventsEnabled || !context.flags.phoenixEnabled) {
            return { triggered: false, reason: 'disabled' };
          }

          const chance = context.helpers.getPhoenixPulseChance();
          const roll = context.random();
          return {
            triggered: roll < chance,
            chance,
            roll
          };
        },
        effect({ scheduler, helpers, meta }) {
          if (!meta || !meta.triggered) {
            return { skipped: true };
          }

          const alreadyQueued = scheduler.getState().queuedEffects.some(
            entry => entry.cardId === 'phoenix-pulse'
          );
          if (alreadyQueued) {
            return { skipped: true, meta };
          }

          scheduler.enqueueResolution({
            cardId: 'phoenix-pulse',
            label: '🔥 Phoenix Pulse',
            meta
          });

          return {
            log: {
              type: 'event',
              label: 'Phoenix Pulse geladen',
              detail: 'Die Phoenix Pulse lädt und wird bei Tagesanbruch explodieren.'
            },
            narratorNote: 'Nachtopfer werden am Morgen wiederbelebt.',
            message: '<br><strong>🔥 Phoenix Pulse:</strong> Eine uralte Energie sammelt sich in dieser Nacht.',
            meta
          };
        },
        preview() {
          return 'Nachtopfer kehren bei Tagesanbruch zurück.';
        }
      }
    );
  }

  if (campaignDefinitions.length === 0) {
    campaignDefinitions.push({
      id: 'legacy',
      name: 'Klassische Ereigniskette',
      description: 'Behält die bisherigen Zufallsereignisse mit sanften Vorahnungen bei.',
      deckConfig: {
        legacy: { weight: 1 }
      },
      script: [
        {
          night: 1,
          eventId: 'phoenix-pulse',
          title: 'Vorzeichen des Phönix',
          description: 'Die Phoenix Pulse knistert schon in der ersten Nacht und lädt garantiert.'
        }
      ]
    });
  }

  function buildDefaultDeckConfig() {
    const config = {};
    const decks = eventDeckMetadata.length > 0
      ? eventDeckMetadata
      : [{ id: 'legacy', name: 'Standard' }];
    decks.forEach(deck => {
      config[deck.id] = { enabled: true, weight: 1 };
    });
    return config;
  }

  function getDefaultCampaignId() {
    const firstCampaign = campaignDefinitions.find(campaign => campaign && campaign.id);
    return firstCampaign ? firstCampaign.id : null;
  }

  const defaultEventConfig = {
    bloodMoonEnabled: true,
    phoenixPulseEnabled: true,
    firstNightShield: true,
    decks: buildDefaultDeckConfig(),
    campaignId: getDefaultCampaignId()
  };

  function setConfigModalVisibility(isOpen) {
    if (!configModal) {
      return;
    }
    configModal.style.display = isOpen ? 'flex' : 'none';
    configModal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openConfigModal() {
    setConfigModalVisibility(true);
    const firstInteractiveElement = configModal?.querySelector('button, input, select, textarea');
    if (firstInteractiveElement && typeof firstInteractiveElement.focus === 'function') {
      firstInteractiveElement.focus();
    }
  }

  function closeConfigModal() {
    setConfigModalVisibility(false);
    if (openConfigBtn && typeof openConfigBtn.focus === 'function') {
      openConfigBtn.focus();
    }
  }
  let eventConfig = loadEventConfig();
  eventConfig.decks = sanitizeDeckConfig(eventConfig.decks || {});
  let jobConfig = loadJobConfig();
  let bloodMoonConfig = loadBloodMoonConfig();
  let phoenixPulseConfig = loadPhoenixPulseConfig();

  setConfigModalVisibility(false);

  if (openConfigBtn && configModal) {
    openConfigBtn.addEventListener('click', () => {
      openConfigModal();
    });
  }

  if (closeConfigBtn) {
    closeConfigBtn.addEventListener('click', () => {
      closeConfigModal();
    });
  }

  if (closeConfigFooterBtn) {
    closeConfigFooterBtn.addEventListener('click', () => {
      closeConfigModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && configModal?.style.display === 'flex') {
      closeConfigModal();
    }
  });

  function cloneDeckConfig(config) {
    return Object.keys(config || {}).reduce((acc, key) => {
      const entry = config[key] || {};
      const weight = Number.isFinite(entry.weight) ? entry.weight : 1;
      acc[key] = {
        enabled: entry.enabled !== false,
        weight: Math.max(0, weight)
      };
      return acc;
    }, {});
  }

  function sanitizeDeckConfig(rawConfig) {
    const base = buildDefaultDeckConfig();
    const overrides = cloneDeckConfig(rawConfig);
    return Object.keys(base).reduce((acc, deckId) => {
      const override = overrides[deckId] || {};
      const normalizedWeight = Number.isFinite(override.weight)
        ? Math.max(0, override.weight)
        : base[deckId].weight;
      acc[deckId] = {
        enabled: override.enabled !== false && normalizedWeight > 0,
        weight: normalizedWeight > 0 ? normalizedWeight : 0
      };
      return acc;
    }, {});
  }

  function loadEventConfig() {
    try {
      const raw = getPersistedValue(EVENT_CONFIG_STORAGE_KEY);
      const defaults = {
        bloodMoonEnabled: defaultEventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: defaultEventConfig.phoenixPulseEnabled,
        firstNightShield: defaultEventConfig.firstNightShield,
        decks: cloneDeckConfig(defaultEventConfig.decks),
        campaignId: defaultEventConfig.campaignId
      };
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        bloodMoonEnabled: parsed.bloodMoonEnabled !== false,
        phoenixPulseEnabled: parsed.phoenixPulseEnabled !== false,
        firstNightShield: parsed.firstNightShield !== false,
        decks: sanitizeDeckConfig(parsed.decks || {}),
        campaignId: typeof parsed.campaignId === 'string'
          ? parsed.campaignId
          : defaults.campaignId
      };
    } catch (error) {
      return {
        bloodMoonEnabled: defaultEventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: defaultEventConfig.phoenixPulseEnabled,
        firstNightShield: defaultEventConfig.firstNightShield,
        decks: cloneDeckConfig(defaultEventConfig.decks),
        campaignId: defaultEventConfig.campaignId
      };
    }
  }

  function saveEventConfig() {
    try {
      const payload = {
        bloodMoonEnabled: !!eventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: !!eventConfig.phoenixPulseEnabled,
        firstNightShield: !!eventConfig.firstNightShield,
        decks: sanitizeDeckConfig(eventConfig.decks || {}),
        campaignId: eventConfig.campaignId || null
      };
      persistValue(EVENT_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function areRandomEventsEnabled() {
    return !eventsEnabledCheckbox || eventsEnabledCheckbox.checked;
  }

  function isBloodMoonEventEnabled() {
    return !!eventConfig.bloodMoonEnabled;
  }

  function isPhoenixPulseEventEnabled() {
    return !!eventConfig.phoenixPulseEnabled;
  }

  function isBloodMoonAvailable() {
    return areRandomEventsEnabled() && isBloodMoonEventEnabled();
  }

  function isPhoenixPulseAvailable() {
    return areRandomEventsEnabled() && isPhoenixPulseEventEnabled();
  }

  function loadJobConfig() {
    try {
      const raw = getPersistedValue(JOB_CONFIG_STORAGE_KEY);
      if (!raw) {
        return { ...defaultJobConfig };
      }
      const parsed = JSON.parse(raw);
      const normalizeChance = (value, fallback) => {
        const rawChance = typeof value === 'number' ? value : fallback;
        return Number.isFinite(rawChance)
          ? Math.min(Math.max(rawChance, 0), 1)
          : fallback;
      };
      return {
        bodyguardChance: normalizeChance(parsed.bodyguardChance, defaultJobConfig.bodyguardChance),
        doctorChance: normalizeChance(parsed.doctorChance, defaultJobConfig.doctorChance)
      };
    } catch (error) {
      return { ...defaultJobConfig };
    }
  }

  function saveJobConfig() {
    if (jobConfigSaveTimeout !== null) {
      clearTimeout(jobConfigSaveTimeout);
      jobConfigSaveTimeout = null;
    }
    try {
      const normalizeChance = (value, fallback) => {
        const numeric = typeof value === 'number' ? value : fallback;
        return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : fallback;
      };
      const payload = {
        bodyguardChance: normalizeChance(jobConfig.bodyguardChance, defaultJobConfig.bodyguardChance),
        doctorChance: normalizeChance(jobConfig.doctorChance, defaultJobConfig.doctorChance)
      };
      persistValue(JOB_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadBloodMoonConfig() {
    try {
      const raw = getPersistedValue(BLOOD_MOON_CONFIG_STORAGE_KEY);
      if (!raw) {
        return { ...defaultBloodMoonConfig };
      }
      const parsed = JSON.parse(raw);
      const rawChance = typeof parsed.baseChance === 'number'
        ? parsed.baseChance
        : defaultBloodMoonConfig.baseChance;
      const normalized = Number.isFinite(rawChance)
        ? Math.min(Math.max(rawChance, 0), 1)
        : defaultBloodMoonConfig.baseChance;
      return { baseChance: normalized };
    } catch (error) {
      return { ...defaultBloodMoonConfig };
    }
  }

  function saveBloodMoonConfig() {
    try {
      const payload = {
        baseChance: Math.min(Math.max(bloodMoonConfig.baseChance || 0, 0), 1)
      };
      persistValue(BLOOD_MOON_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadPhoenixPulseConfig() {
    try {
      const raw = getPersistedValue(PHOENIX_PULSE_CONFIG_STORAGE_KEY);
      if (!raw) {
        return { ...defaultPhoenixPulseConfig };
      }
      const parsed = JSON.parse(raw);
      const rawChance = typeof parsed.chance === 'number'
        ? parsed.chance
        : defaultPhoenixPulseConfig.chance;
      const normalized = Number.isFinite(rawChance)
        ? Math.min(Math.max(rawChance, 0), 1)
        : defaultPhoenixPulseConfig.chance;
      return { chance: normalized };
    } catch (error) {
      return { ...defaultPhoenixPulseConfig };
    }
  }

  function savePhoenixPulseConfig() {
    try {
      const payload = {
        chance: Math.min(Math.max(phoenixPulseConfig.chance || 0, 0), 1)
      };
      persistValue(PHOENIX_PULSE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function setBloodMoonBaseChance(percent, { save = false } = {}) {
    const numeric = Number(percent);
    const sanitizedPercent = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), 0), 100)
      : Math.round((defaultBloodMoonConfig.baseChance || 0) * 100);
    const normalized = sanitizedPercent / 100;
    bloodMoonConfig.baseChance = normalized;
    if (bloodMoonChanceInput && bloodMoonChanceInput.value !== String(sanitizedPercent)) {
      bloodMoonChanceInput.value = String(sanitizedPercent);
    }
    if (bloodMoonChanceDisplay) {
      bloodMoonChanceDisplay.textContent = `${sanitizedPercent}%`;
    }
    if (save) {
      saveBloodMoonConfig();
    }
  }

  function setPhoenixPulseChance(percent, { save = false } = {}) {
    const numeric = Number(percent);
    const sanitizedPercent = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), 0), 100)
      : Math.round((defaultPhoenixPulseConfig.chance || 0) * 100);
    const normalized = sanitizedPercent / 100;
    phoenixPulseConfig.chance = normalized;
    if (phoenixPulseChanceInput && phoenixPulseChanceInput.value !== String(sanitizedPercent)) {
      phoenixPulseChanceInput.value = String(sanitizedPercent);
    }
    if (phoenixPulseChanceDisplay) {
      phoenixPulseChanceDisplay.textContent = `${sanitizedPercent}%`;
    }
    if (save) {
      savePhoenixPulseConfig();
    }
  }

  function getPhoenixPulseChance() {
    const chance = Number.isFinite(phoenixPulseConfig?.chance)
      ? phoenixPulseConfig.chance
      : defaultPhoenixPulseConfig.chance;
    return Math.min(Math.max(chance, 0), 1);
  }

  function getBloodMoonChance(pityTimer) {
    const timer = Number.isFinite(pityTimer) ? Math.max(pityTimer, 0) : 0;
    const baseChance = Number.isFinite(bloodMoonConfig?.baseChance)
      ? Math.min(Math.max(bloodMoonConfig.baseChance, 0), 1)
      : defaultBloodMoonConfig.baseChance;
    return Math.min(baseChance + timer * 0.1, 1);
  }

  function updateBodyguardChanceUI(percent, { save = false } = {}) {
    const numeric = Number(percent);
    const sanitized = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), 0), 100)
      : 0;
    jobConfig.bodyguardChance = sanitized / 100;
    if (bodyguardJobChanceInput && bodyguardJobChanceInput.value !== String(sanitized)) {
      bodyguardJobChanceInput.value = String(sanitized);
    }
    if (bodyguardJobChanceDisplay) {
      bodyguardJobChanceDisplay.textContent = `${sanitized}%`;
    }
    if (save) {
      saveJobConfig();
    }
  }

  function scheduleJobConfigSave() {
    if (jobConfigSaveTimeout !== null) {
      clearTimeout(jobConfigSaveTimeout);
    }
    jobConfigSaveTimeout = setTimeout(() => {
      jobConfigSaveTimeout = null;
      saveJobConfig();
    }, 150);
  }

  updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: false });

  if (bodyguardJobChanceInput) {
    bodyguardJobChanceInput.addEventListener('input', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: false });
      scheduleJobConfigSave();
    });
    bodyguardJobChanceInput.addEventListener('change', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: true });
    });
  }

  function updateDoctorChanceUI(percent, { save = false } = {}) {
    const numeric = Number(percent);
    const sanitized = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), 0), 100)
      : 0;
    jobConfig.doctorChance = sanitized / 100;
    if (doctorJobChanceInput && doctorJobChanceInput.value !== String(sanitized)) {
      doctorJobChanceInput.value = String(sanitized);
    }
    if (doctorJobChanceDisplay) {
      doctorJobChanceDisplay.textContent = `${sanitized}%`;
    }
    if (save) {
      saveJobConfig();
    }
  }

  updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: false });

  if (doctorJobChanceInput) {
    doctorJobChanceInput.addEventListener('input', () => {
      updateDoctorChanceUI(doctorJobChanceInput.value, { save: false });
      scheduleJobConfigSave();
    });
    doctorJobChanceInput.addEventListener('change', () => {
      updateDoctorChanceUI(doctorJobChanceInput.value, { save: true });
    });
  }

  setBloodMoonBaseChance(bloodMoonConfig.baseChance * 100, { save: false });

  if (bloodMoonChanceInput) {
    bloodMoonChanceInput.addEventListener('input', () => {
      setBloodMoonBaseChance(bloodMoonChanceInput.value, { save: false });
      updateBloodMoonOdds();
    });
    bloodMoonChanceInput.addEventListener('change', () => {
      setBloodMoonBaseChance(bloodMoonChanceInput.value, { save: true });
      updateBloodMoonOdds();
    });
  }

  setPhoenixPulseChance((phoenixPulseConfig.chance || 0) * 100, { save: false });

  if (phoenixPulseChanceInput) {
    phoenixPulseChanceInput.addEventListener('input', () => {
      setPhoenixPulseChance(phoenixPulseChanceInput.value, { save: false });
    });
    phoenixPulseChanceInput.addEventListener('change', () => {
      setPhoenixPulseChance(phoenixPulseChanceInput.value, { save: true });
    });
  }

  updateBloodMoonOdds();

  // Load existing sessions on startup
  await loadSessions();

  // Confirmation Modal Elements
  const confirmationModal = document.getElementById('confirmation-modal');
  const confirmationTitle = document.getElementById('confirmation-title');
  const confirmationText = document.getElementById('confirmation-text');
  const confirmBtn = document.getElementById('confirm-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  let onConfirmCallback = null;
  let onCancelCallback = null;
  let logConfirmHandler = null;
  let logCancelHandler = null;

  // Show confirmation modal
  function showConfirmation(titleOrOptions, text, onConfirm, confirmText = 'Bestätigen', showCancel = true, modalClass = '') {
    const options = typeof titleOrOptions === 'object' && titleOrOptions !== null
      ? titleOrOptions
      : {
          title: titleOrOptions,
          text,
          onConfirm,
          confirmText,
          showCancel,
          modalClass
        };

    const {
      title = '',
      text: message = '',
      html = null,
      onConfirm: confirmHandler = () => {},
      onCancel,
      confirmText: confirmLabel = 'Bestätigen',
      cancelText = 'Abbrechen',
      showCancel: shouldShowCancel = true,
      hideConfirm = false,
      modalClass: extraClass = '',
      logOnConfirm = null,
      logOnCancel = null,
      focus = 'confirm'
    } = options;

    confirmationTitle.textContent = title;
    if (html !== null) {
      confirmationText.innerHTML = html;
    } else {
      confirmationText.textContent = message;
    }

    onConfirmCallback = typeof confirmHandler === 'function' ? confirmHandler : () => {};
    onCancelCallback = typeof onCancel === 'function' ? onCancel : null;

    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelText;

    confirmBtn.parentElement.style.display = hideConfirm ? 'none' : 'block';
    cancelBtn.parentElement.style.display = shouldShowCancel ? 'block' : 'none';

    confirmationModal.className = 'modal';
    if (extraClass) {
      confirmationModal.classList.add(extraClass);
    }

    logConfirmHandler = typeof logOnConfirm === 'function'
      ? logOnConfirm
      : logOnConfirm
        ? () => logAction(logOnConfirm)
        : null;

    logCancelHandler = typeof logOnCancel === 'function'
      ? logOnCancel
      : logOnCancel
        ? () => logAction(logOnCancel)
        : null;

    confirmationModal.style.display = 'flex';

    requestAnimationFrame(() => {
      if (focus === 'cancel' && shouldShowCancel) {
        cancelBtn.focus();
      } else if (!hideConfirm) {
        confirmBtn.focus();
      } else if (shouldShowCancel) {
        cancelBtn.focus();
      }
    });
  }

  // Helper for informational modals without cancellation flow
  function showInfoMessage({ title, text = '', html = null, confirmText = 'Okay', log = null, modalClass = '', focus = 'confirm' }) {
    showConfirmation({
      title,
      text,
      html,
      confirmText,
      showCancel: false,
      modalClass,
      logOnConfirm: log,
      focus,
      onConfirm: () => {}
    });
  }

  // Hide confirmation modal
  function hideConfirmation() {
    confirmationModal.style.display = 'none';
    onConfirmCallback = null;
    onCancelCallback = null;
    logConfirmHandler = null;
    logCancelHandler = null;
    confirmBtn.textContent = 'Bestätigen';
    cancelBtn.textContent = 'Abbrechen';
    confirmBtn.parentElement.style.display = 'block';
    cancelBtn.parentElement.style.display = 'block';
    confirmationModal.className = 'modal';
    confirmationText.textContent = '';
  }

  // Add event listeners for confirmation modal
  confirmBtn.addEventListener('click', () => {
    if (onConfirmCallback) {
      onConfirmCallback();
    }
    if (logConfirmHandler) {
      logConfirmHandler();
    }
    hideConfirmation();
  });

  cancelBtn.addEventListener('click', () => {
    if (onCancelCallback) {
      onCancelCallback();
    }
    if (logCancelHandler) {
      logCancelHandler();
    }
    hideConfirmation();
  });

  // Win screen elements
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const winMessage = document.getElementById('win-message');
  const winBtn = document.getElementById('win-btn');

  // Graveyard Modal Elements
  const graveyardModal = document.getElementById('graveyard-modal');
  const graveyardGrid = document.getElementById('graveyard-grid');
  const graveyardCloseBtn = document.getElementById('graveyard-close-btn');
  const phoenixPulseOverlay = document.getElementById('phoenix-pulse-overlay');
  const phoenixPulseMessage = document.getElementById('phoenix-pulse-message');
  const phoenixPulseStatus = document.getElementById('phoenix-pulse-status');

  function showWin(title, message) {
    winTitle.textContent = title;
    winMessage.textContent = message;
    winOverlay.style.display = 'flex';
    winOverlay.classList.add('show');
    winBtn.onclick = () => location.reload();
  }

  // State tracking
  let lovers = [];
  let deadPlayers = [];
  let currentNightVictims = []; // Track players killed in the current night
  let silencedPlayer = null; // Track player silenced by Stumme Jule
  let healRemaining = 1;
  let poisonRemaining = 1;
  let selectedWitchAction = null;
  let bloodMoonActive = false;
  let phoenixPulsePending = false;
  let phoenixPulseJustResolved = false;
  let phoenixPulseRevivedPlayers = [];
  let bodyguardProtectionTarget = null;
  let bodyguardProtectionNight = null;
  let bodyguardSavedTarget = null;
  let bodyguardPlayers = [];
  let doctorPlayers = [];
  let doctorPendingTargets = [];
  let doctorPendingNight = null;
  let doctorTriggerSourceNight = null;
  let doctorLastHealedTarget = null;
  let doctorLastHealedNight = null;

  function setBloodMoonState(isActive) {
    bloodMoonActive = !!isActive;
    if (bloodMoonActive) {
      document.body.classList.add('blood-moon-active');
    } else {
      document.body.classList.remove('blood-moon-active');
    }
    updateBloodMoonOdds();
  }

  function clearBloodMoonState() {
    setBloodMoonState(false);
  }

  function clearPhoenixPulseState() {
    phoenixPulsePending = false;
    phoenixPulseJustResolved = false;
    phoenixPulseRevivedPlayers = [];
    setPhoenixPulseCharged(false);
  }

  function refreshEventUI() {
    updateBloodMoonOdds();
    updatePhoenixPulseStatus();
  }

  const eventModifierHandlers = {
    'blood-moon': {
      apply() {
        setBloodMoonState(true);
        syncBloodMoonUI({ silent: true });
      },
      expire() {
        setBloodMoonState(false);
        syncBloodMoonUI({ silent: true });
      }
    }
  };

  const eventQueueHandlers = {
    'phoenix-pulse': {
      onEnqueue() {
        phoenixPulsePending = true;
        phoenixPulseJustResolved = false;
        setPhoenixPulseCharged(true);
        updatePhoenixPulseStatus();
      },
      onComplete(_meta, payload = {}) {
        if (payload && payload.deferClear) {
          return;
        }
        phoenixPulsePending = false;
        setPhoenixPulseCharged(false);
        updatePhoenixPulseStatus();
      }
    }
  };

  function sanitizeSchedulerState(raw = {}) {
    const normalizeModifier = (modifier) => {
      if (!modifier) {
        return null;
      }
      const id = typeof modifier.id === 'string' && modifier.id.trim()
        ? modifier.id.trim()
        : (typeof modifier.originCardId === 'string' && modifier.originCardId.trim()
          ? modifier.originCardId.trim()
          : `mod-${Date.now()}`);
      const origin = typeof modifier.originCardId === 'string' && modifier.originCardId.trim()
        ? modifier.originCardId.trim()
        : id;
      const expiresAfterNight = Number.isFinite(modifier.expiresAfterNight)
        ? modifier.expiresAfterNight
        : null;
      return {
        id,
        label: modifier.label || id,
        originCardId: origin,
        expiresAfterNight
      };
    };

    const normalizeQueueEntry = (entry) => {
      if (!entry) {
        return null;
      }
      const cardId = typeof entry.cardId === 'string' && entry.cardId.trim()
        ? entry.cardId.trim()
        : (typeof entry.id === 'string' ? entry.id : 'event');
      return {
        id: typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim()
          : `${cardId}-${Date.now()}`,
        cardId,
        label: entry.label || cardId,
        meta: entry.meta || null,
        night: Number.isFinite(entry.night) ? entry.night : null,
        scheduledAt: Number.isFinite(entry.scheduledAt) ? entry.scheduledAt : Date.now()
      };
    };

    const normalizeHistoryEntry = (entry) => {
      if (!entry) {
        return null;
      }
      const normalized = normalizeQueueEntry(entry);
      return {
        ...normalized,
        payload: entry.payload || null,
        recordedAt: Number.isFinite(entry.recordedAt) ? entry.recordedAt : Date.now(),
        resolvedAt: Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : null
      };
    };

    const activeModifiers = Array.isArray(raw.activeModifiers)
      ? raw.activeModifiers.map(normalizeModifier).filter(Boolean)
      : [];
    const queuedEffects = Array.isArray(raw.queuedEffects)
      ? raw.queuedEffects.map(normalizeQueueEntry).filter(Boolean)
      : [];
    const history = Array.isArray(raw.history)
      ? raw.history.map(normalizeHistoryEntry).filter(Boolean).slice(0, 25)
      : [];

    return {
      activeModifiers,
      queuedEffects,
      history
    };
  }

  function createEventScheduler(initialState = {}, onChange) {
    const state = sanitizeSchedulerState(initialState);
    const notify = () => {
      if (typeof onChange === 'function') {
        onChange(state);
      }
    };

    return {
      addModifier(modifier) {
        const normalized = sanitizeSchedulerState({ activeModifiers: [modifier] }).activeModifiers[0];
        if (!normalized) {
          return null;
        }
        state.activeModifiers = state.activeModifiers.filter(entry => entry.id !== normalized.id);
        state.activeModifiers.push(normalized);
        const handler = eventModifierHandlers[normalized.originCardId] || eventModifierHandlers[normalized.id];
        if (handler && typeof handler.apply === 'function') {
          handler.apply({ modifier: normalized });
        }
        notify();
        return normalized;
      },
      clearExpiredModifiers(currentNight) {
        const remaining = [];
        let changed = false;
        state.activeModifiers.forEach(modifier => {
          if (modifier.expiresAfterNight !== null && currentNight > modifier.expiresAfterNight) {
            const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
            if (handler && typeof handler.expire === 'function') {
              handler.expire({ modifier, night: currentNight });
            }
            changed = true;
          } else {
            remaining.push(modifier);
          }
        });
        state.activeModifiers = remaining;
        if (changed) {
          notify();
        }
      },
      removeModifier(modifierId) {
        let changed = false;
        state.activeModifiers = state.activeModifiers.filter(modifier => {
          if (modifier.id === modifierId) {
            const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
            if (handler && typeof handler.expire === 'function') {
              handler.expire({ modifier, night: null });
            }
            changed = true;
            return false;
          }
          return true;
        });
        if (changed) {
          notify();
        }
      },
      enqueueResolution(entry) {
        const normalized = sanitizeSchedulerState({ queuedEffects: [entry] }).queuedEffects[0];
        if (!normalized) {
          return null;
        }
        state.queuedEffects.push(normalized);
        const handler = eventQueueHandlers[normalized.cardId];
        if (handler && typeof handler.onEnqueue === 'function') {
          handler.onEnqueue(normalized.meta || {}, { entry: normalized });
        }
        notify();
        return normalized;
      },
      completeQueuedEffect(cardId, payload = {}) {
        let completed = null;
        state.queuedEffects = state.queuedEffects.filter(entry => {
          if (!completed && entry.cardId === cardId) {
            completed = entry;
            return false;
          }
          return true;
        });
        if (completed) {
          const handler = eventQueueHandlers[completed.cardId];
          if (handler && typeof handler.onComplete === 'function') {
            handler.onComplete(completed.meta || {}, payload, { entry: completed });
          }
          state.history.unshift({ ...completed, payload, resolvedAt: Date.now() });
          if (state.history.length > 25) {
            state.history.length = 25;
          }
          notify();
        }
        return completed;
      },
      recordHistory(entry) {
        state.history.unshift({ ...entry, recordedAt: Date.now() });
        if (state.history.length > 25) {
          state.history.length = 25;
        }
        notify();
      },
      clearAll({ silent = false } = {}) {
        state.activeModifiers = [];
        state.queuedEffects = [];
        state.history = [];
        if (!silent) {
          notify();
        }
      },
      replaceState(nextState = {}, { silent = false } = {}) {
        const sanitized = sanitizeSchedulerState(nextState);
        state.activeModifiers = sanitized.activeModifiers;
        state.queuedEffects = sanitized.queuedEffects;
        state.history = sanitized.history;
        if (!silent) {
          notify();
        }
      },
      getState() {
        return sanitizeSchedulerState(state);
      }
    };
  }

  function buildDefaultCampaignProgress() {
    return {
      id: defaultEventConfig.campaignId || null,
      executed: []
    };
  }

  function loadEventEngineState() {
    const defaults = {
      scheduler: sanitizeSchedulerState(),
      campaignProgress: buildDefaultCampaignProgress()
    };

    try {
      const raw = getPersistedValue(EVENT_ENGINE_STORAGE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        scheduler: sanitizeSchedulerState(parsed.scheduler || {}),
        campaignProgress: {
          id: typeof parsed?.campaignProgress?.id === 'string'
            ? parsed.campaignProgress.id
            : defaults.campaignProgress.id,
          executed: Array.isArray(parsed?.campaignProgress?.executed)
            ? parsed.campaignProgress.executed.slice(0, 50)
            : []
        }
      };
    } catch (error) {
      return defaults;
    }
  }

  let eventEngineState = loadEventEngineState();

  const eventScheduler = createEventScheduler(eventEngineState.scheduler, () => {
    eventEngineState.scheduler = eventScheduler.getState();
    persistEventEngineState();
    renderNarratorDashboard();
  });

  function persistEventEngineState() {
    try {
      const payload = {
        scheduler: eventScheduler.getState(),
        campaignProgress: {
          id: eventEngineState?.campaignProgress?.id || null,
          executed: Array.isArray(eventEngineState?.campaignProgress?.executed)
            ? eventEngineState.campaignProgress.executed.slice(0, 50)
            : []
        }
      };
      persistValue(EVENT_ENGINE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore persistence errors
    }
  }

  function setCampaignProgress(newProgress) {
    eventEngineState.campaignProgress = {
      id: newProgress?.id || null,
      executed: Array.isArray(newProgress?.executed)
        ? newProgress.executed.slice(0, 50)
        : []
    };
    persistEventEngineState();
    renderCampaignPreview();
  }

  function resetCampaignProgress(campaignId) {
    setCampaignProgress({ id: campaignId || null, executed: [] });
  }

  function markCampaignStepExecuted(step) {
    if (!step) {
      return;
    }
    const key = `${step.night || 0}:${step.eventId || step.id}`;
    const progress = eventEngineState.campaignProgress || buildDefaultCampaignProgress();
    if (!Array.isArray(progress.executed)) {
      progress.executed = [];
    }
    if (!progress.executed.includes(key)) {
      progress.executed.push(key);
      setCampaignProgress({ id: progress.id, executed: progress.executed });
    }
    renderCampaignPreview();
  }

  function rehydrateEventSideEffects() {
    clearBloodMoonState();
    clearPhoenixPulseState();
    const schedulerState = eventScheduler.getState();
    schedulerState.activeModifiers.forEach(modifier => {
      const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
      if (handler && typeof handler.apply === 'function') {
        handler.apply({ modifier, fromRestore: true });
      }
    });
    schedulerState.queuedEffects.forEach(entry => {
      const handler = eventQueueHandlers[entry.cardId];
      if (handler && typeof handler.onEnqueue === 'function') {
        handler.onEnqueue(entry.meta || {}, { entry, fromRestore: true });
      }
    });
    refreshEventUI();
  }

  function getEventEngineSnapshot() {
    return {
      scheduler: eventScheduler.getState(),
      campaignProgress: {
        id: eventEngineState?.campaignProgress?.id || null,
        executed: Array.isArray(eventEngineState?.campaignProgress?.executed)
          ? eventEngineState.campaignProgress.executed.slice(0, 50)
          : []
      }
    };
  }

  function restoreEventEngineState(nextState) {
    if (nextState) {
      eventScheduler.replaceState(nextState.scheduler || {}, { silent: true });
      setCampaignProgress(nextState.campaignProgress || {});
    } else {
      eventScheduler.clearAll({ silent: true });
      setCampaignProgress(buildDefaultCampaignProgress());
    }
    rehydrateEventSideEffects();
  }

  if (bloodMoonEnabledCheckbox) {
    bloodMoonEnabledCheckbox.checked = !!eventConfig.bloodMoonEnabled;
  }

  if (firstNightShieldCheckbox) {
    firstNightShieldCheckbox.checked = eventConfig.firstNightShield !== false;
  }

  if (phoenixPulseEnabledCheckbox) {
    phoenixPulseEnabledCheckbox.checked = !!eventConfig.phoenixPulseEnabled;
  }

  function applyGlobalEventsEnabledState() {
    if (!areRandomEventsEnabled()) {
      eventScheduler.clearAll({ silent: true });
      clearBloodMoonState();
      clearPhoenixPulseState();
      persistEventEngineState();
    } else {
      rehydrateEventSideEffects();
    }
    refreshEventUI();
    renderNarratorDashboard();
  }

  function getActiveDeckIds() {
    return Object.entries(eventConfig.decks || {})
      .filter(([, cfg]) => cfg && cfg.enabled !== false && Number(cfg.weight) > 0)
      .map(([deckId]) => deckId);
  }

  function renderEventDeckControls() {
    if (!eventDeckListEl) {
      return;
    }
    const decks = eventDeckMetadata.length > 0
      ? eventDeckMetadata
      : [{ id: 'legacy', name: 'Standard', description: 'Blutmond & Phoenix Pulse' }];
    eventDeckListEl.innerHTML = '';

    decks.forEach(deck => {
      const config = eventConfig.decks[deck.id] || { enabled: true, weight: 1 };
      const entry = document.createElement('div');
      entry.className = 'deck-config-entry';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'config-toggle';
      const toggleSpan = document.createElement('span');
      toggleSpan.textContent = deck.name || deck.id;
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.id = `deck-toggle-${deck.id}`;
      toggleInput.checked = config.enabled !== false && Number(config.weight) > 0;
      toggleLabel.appendChild(toggleSpan);
      toggleLabel.appendChild(toggleInput);
      entry.appendChild(toggleLabel);

      const sliderWrapper = document.createElement('div');
      sliderWrapper.className = 'config-slider';
      const sliderLabel = document.createElement('label');
      sliderLabel.setAttribute('for', `deck-weight-${deck.id}`);
      sliderLabel.textContent = 'Gewichtung';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `deck-weight-${deck.id}`;
      slider.min = '0';
      slider.max = '3';
      slider.step = '0.5';
      const currentWeight = Math.max(0, Number(config.weight) || 0);
      slider.value = String(Math.min(Math.max(currentWeight, 0), 3));
      const weightDisplay = document.createElement('span');
      weightDisplay.className = 'deck-weight-display';

      const updateWeightDisplay = () => {
        const value = Number(slider.value);
        weightDisplay.textContent = `${value.toFixed(1)}x`;
        slider.disabled = !toggleInput.checked;
      };

      updateWeightDisplay();

      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        if (!eventConfig.decks[deck.id]) {
          eventConfig.decks[deck.id] = { enabled: toggleInput.checked, weight: value };
        } else {
          eventConfig.decks[deck.id].weight = value;
        }
        if (value <= 0) {
          toggleInput.checked = false;
          eventConfig.decks[deck.id].enabled = false;
        } else if (!toggleInput.checked) {
          toggleInput.checked = true;
          eventConfig.decks[deck.id].enabled = true;
        }
        updateWeightDisplay();
      });

      slider.addEventListener('change', () => {
        saveEventConfig();
        renderEventCardPreview();
      });

      toggleInput.addEventListener('change', () => {
        if (!eventConfig.decks[deck.id]) {
          eventConfig.decks[deck.id] = { enabled: true, weight: 1 };
        }
        eventConfig.decks[deck.id].enabled = toggleInput.checked;
        if (!toggleInput.checked) {
          slider.value = '0';
          eventConfig.decks[deck.id].weight = 0;
        } else if (Number(eventConfig.decks[deck.id].weight) <= 0) {
          slider.value = '1';
          eventConfig.decks[deck.id].weight = 1;
        }
        updateWeightDisplay();
        saveEventConfig();
        renderEventCardPreview();
      });

      sliderWrapper.appendChild(sliderLabel);
      sliderWrapper.appendChild(slider);
      sliderWrapper.appendChild(weightDisplay);
      entry.appendChild(sliderWrapper);

      if (deck.description) {
        const helper = document.createElement('p');
        helper.className = 'config-helper';
        helper.textContent = deck.description;
        entry.appendChild(helper);
      }

      eventDeckListEl.appendChild(entry);
    });
  }

  function renderEventCardPreview() {
    if (!eventCardPreviewListEl) {
      return;
    }
    eventCardPreviewListEl.innerHTML = '';
    const activeDecks = new Set(getActiveDeckIds());
    const cards = eventCardDefinitions.filter(card => !card.deckId || activeDecks.has(card.deckId));
    if (cards.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Keine Karten aktiviert.';
      eventCardPreviewListEl.appendChild(li);
      return;
    }
    cards.forEach(card => {
      const li = document.createElement('li');
      const description = card.description || '';
      li.innerHTML = `<strong>${card.label || card.id}</strong>${description ? ` – ${description}` : ''}`;
      eventCardPreviewListEl.appendChild(li);
    });
  }

  function renderCampaignSelect() {
    if (!campaignSelectEl) {
      return;
    }
    campaignSelectEl.innerHTML = '';
    const freeOption = document.createElement('option');
    freeOption.value = '';
    freeOption.textContent = 'Freies Spiel';
    campaignSelectEl.appendChild(freeOption);

    campaignDefinitions.forEach(campaign => {
      if (!campaign || !campaign.id) {
        return;
      }
      const option = document.createElement('option');
      option.value = campaign.id;
      option.textContent = campaign.name || campaign.id;
      option.dataset.description = campaign.description || '';
      campaignSelectEl.appendChild(option);
    });

    campaignSelectEl.value = eventConfig.campaignId || '';
  }

  function renderCampaignPreview() {
    if (!campaignPreviewListEl) {
      return;
    }
    campaignPreviewListEl.innerHTML = '';
    const campaign = campaignDefinitions.find(entry => entry && entry.id === eventConfig.campaignId);
    if (!campaign) {
      const li = document.createElement('li');
      li.textContent = 'Keine Kampagne aktiv.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    const executedKeys = new Set(eventEngineState?.campaignProgress?.executed || []);
    const script = Array.isArray(campaign.script) ? campaign.script : [];
    const upcoming = script.filter(step => !executedKeys.has(`${step.night || 0}:${step.eventId || step.id}`));
    if (upcoming.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Alle Beats dieser Kampagne wurden erlebt.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    upcoming.sort((a, b) => (a.night || 0) - (b.night || 0));
    upcoming.forEach(step => {
      const li = document.createElement('li');
      const card = eventCardDefinitions.find(entry => entry.id === step.eventId);
      const label = card ? card.label || card.id : step.eventId;
      const title = step.title || label;
      const description = step.description || card?.description || '';
      li.innerHTML = `<strong>Nacht ${step.night}</strong>: ${title}${description ? ` – ${description}` : ''}`;
      campaignPreviewListEl.appendChild(li);
    });
  }

  let deferInitialEventEnablement = false;

  if (eventsEnabledCheckbox) {
    const savedEventsEnabled = getPersistedValue('eventsEnabled');
    if (savedEventsEnabled !== null) {
      eventsEnabledCheckbox.checked = savedEventsEnabled === 'true';
    }
    deferInitialEventEnablement = true;
    eventsEnabledCheckbox.addEventListener('change', () => {
      persistValue('eventsEnabled', eventsEnabledCheckbox.checked);
      applyGlobalEventsEnabledState();
      renderNarratorDashboard();
    });
  } else {
    deferInitialEventEnablement = true;
  }

  renderEventDeckControls();
  renderEventCardPreview();
  renderCampaignSelect();
  renderCampaignPreview();

  if (bloodMoonEnabledCheckbox) {
    bloodMoonEnabledCheckbox.addEventListener('change', () => {
      eventConfig.bloodMoonEnabled = bloodMoonEnabledCheckbox.checked;
      saveEventConfig();
      if (!eventConfig.bloodMoonEnabled) {
        clearBloodMoonState();
      }
      refreshEventUI();
      renderNarratorDashboard();
    });
  }

  if (firstNightShieldCheckbox) {
    firstNightShieldCheckbox.addEventListener('change', () => {
      eventConfig.firstNightShield = firstNightShieldCheckbox.checked;
      saveEventConfig();
      renderNarratorDashboard();
    });
  }

  if (phoenixPulseEnabledCheckbox) {
    phoenixPulseEnabledCheckbox.addEventListener('change', () => {
      eventConfig.phoenixPulseEnabled = phoenixPulseEnabledCheckbox.checked;
      saveEventConfig();
      if (!eventConfig.phoenixPulseEnabled) {
        clearPhoenixPulseState();
      }
      refreshEventUI();
      renderNarratorDashboard();
    });
  }

  if (campaignSelectEl) {
    campaignSelectEl.addEventListener('change', () => {
      const newId = campaignSelectEl.value || null;
      const normalizedId = newId && newId.length > 0 ? newId : null;
      if (eventConfig.campaignId !== normalizedId) {
        eventConfig.campaignId = normalizedId;
        saveEventConfig();
        resetCampaignProgress(normalizedId);
      } else {
        eventConfig.campaignId = normalizedId;
        saveEventConfig();
      }
      renderCampaignPreview();
    });
  }

  // Load reveal dead roles state
  const savedRevealDeadRoles = getPersistedValue('revealDeadRoles');
  if (savedRevealDeadRoles !== null) {
    revealDeadRolesCheckbox.checked = savedRevealDeadRoles === 'true';
  }

  // Save reveal dead roles state
  revealDeadRolesCheckbox.addEventListener('change', () => {
    persistValue('revealDeadRoles', revealDeadRolesCheckbox.checked);
  });

  // New roles state
  let henker = null; // { player: "Name", target: "Name" }
  let geschwister = [];
  let geist = { player: null, messageSent: false };
  let jagerShotUsed = false;
  let jagerDiedLastNight = null;
  let michaelJacksonAccusations = {};

  // Jäger Modal Elements
  const jagerModal = document.getElementById('jager-modal');
  const jagerChoices = document.getElementById('jager-choices');
  const jagerKillBtn = document.getElementById('jager-kill-btn');

  function handleJagerRevenge(jagerName, onFinish) {
    if (jagerShotUsed) {
        if(onFinish) onFinish();
        return;
    };
    jagerShotUsed = true;

    const livingPlayers = players.filter(p => !deadPlayers.includes(p) && p !== jagerName);
    jagerChoices.innerHTML = '';
    livingPlayers.forEach(player => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = player;
        btn.className = 'player-btn';
        btn.onclick = () => {
            const selected = jagerChoices.querySelector('.player-btn.selected');
            if (selected) selected.classList.remove('selected');
            btn.classList.add('selected');
        };
        jagerChoices.appendChild(btn);
    });

    jagerModal.style.display = 'flex';

    jagerKillBtn.onclick = () => {
        const selected = jagerChoices.querySelector('.player-btn.selected');
        if (!selected) {
            showInfoMessage({
                title: 'Auswahl erforderlich',
                text: 'Bitte einen Spieler zum Mitnehmen auswählen.',
                confirmText: 'Okay',
                log: { type: 'error', label: 'Jäger-Auswahl fehlt', detail: 'Der letzte Schuss benötigt ein Ziel.' }
            });
            return;
        }
        const target = selected.textContent;

        showConfirmation('Letzter Schuss', `Willst du ${target} wirklich mit in den Tod nehmen?`, () => {
            if (!deadPlayers.includes(target)) {
                deadPlayers.push(target);
                handlePlayerDeath(target);

                lovers.forEach(pair => {
                    if (pair.includes(target)) {
                        const partner = pair[0] === target ? pair[1] : pair[0];
                        if (!deadPlayers.includes(partner)) {
                            deadPlayers.push(partner);
                            handlePlayerDeath(partner);
                            showInfoMessage({
                                title: 'Liebespaar zerbrochen',
                                text: `${partner} ist aus Liebeskummer gestorben!`,
                                confirmText: 'Verstanden',
                                log: { type: 'info', label: 'Liebende gefallen', detail: `${partner} starb aus Liebeskummer.` }
                            });
                        }
                    }
                });

                updatePlayerCardVisuals();
                jagerModal.style.display = 'none';
                showConfirmation('Der Jäger hat geschossen', `${jagerName} hat ${target} mit in den Tod gerissen.`, () => {
                    if (checkGameOver()) return;
                    if (onFinish) onFinish();
                }, 'Okay', false);
            }
        });
    };
  }

  function initializeMichaelJacksonAccusations(existingData = michaelJacksonAccusations) {
    const synced = {};

    players.forEach((player, index) => {
      if (rolesAssigned[index] === "Michael Jackson") {
        const previousEntry = existingData[player];
        const previousDaysRaw = Array.isArray(previousEntry?.daysAccused)
          ? previousEntry.daysAccused
          : Array.isArray(previousEntry)
            ? previousEntry
            : [];

        const normalizedDays = previousDaysRaw
          .map(day => (typeof day === 'number' ? day : Number(day)))
          .filter(day => Number.isFinite(day));

        const uniqueDays = Array.from(new Set(normalizedDays));
        const previousSpotlight = typeof previousEntry?.hasSpotlight === 'boolean'
          ? previousEntry.hasSpotlight
          : typeof previousEntry?.spotlightActive === 'boolean'
            ? previousEntry.spotlightActive
            : false;

        const storedAccusationCountRaw = typeof previousEntry?.accusationCount === 'number'
          ? previousEntry.accusationCount
          : Array.isArray(previousEntry)
            ? previousEntry.length
            : uniqueDays.length;
        const storedAccusationCount = Number.isFinite(storedAccusationCountRaw)
          ? storedAccusationCountRaw
          : uniqueDays.length;

        const normalizedAccusationCount = Math.max(storedAccusationCount, uniqueDays.length);
        const storedLastDay = typeof previousEntry?.lastAccusationDay === 'number'
          && Number.isFinite(previousEntry.lastAccusationDay)
          ? previousEntry.lastAccusationDay
          : null;
        const lastDayFromEntry = storedLastDay !== null
          ? storedLastDay
          : uniqueDays.length > 0
            ? Math.max(...uniqueDays)
            : null;

        synced[player] = {
          daysAccused: uniqueDays,
          hasSpotlight: previousSpotlight || normalizedAccusationCount > 0,
          accusationCount: normalizedAccusationCount,
          lastAccusationDay: lastDayFromEntry
        };
      }
    });

    michaelJacksonAccusations = synced;
  }

  function ensureJobsStructure() {
    if (!Array.isArray(jobsAssigned)) {
      jobsAssigned = [];
    }
    if (jobsAssigned.length !== players.length) {
      const previous = jobsAssigned;
      jobsAssigned = players.map((_, index) => Array.isArray(previous[index]) ? previous[index] : []);
    } else {
      jobsAssigned = jobsAssigned.map(entry => Array.isArray(entry) ? entry : []);
    }
  }

  function getPlayerJobs(index) {
    ensureJobsStructure();
    if (!Array.isArray(jobsAssigned[index])) {
      jobsAssigned[index] = [];
    }
    return jobsAssigned[index];
  }

  const jobDisplayNames = {
    Bodyguard: 'Bodyguard',
    Doctor: 'Arzt'
  };

  function getJobDisplayName(job) {
    return jobDisplayNames[job] || job;
  }

  function formatRoleWithJobs(role, jobs) {
    if (!role) {
      if (!Array.isArray(jobs) || jobs.length === 0) {
        return '';
      }
      const displayJobs = jobs.map(getJobDisplayName).filter(Boolean);
      return displayJobs.join(' & ');
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return role;
    }
    const displayJobs = jobs.map(getJobDisplayName).filter(Boolean);
    if (displayJobs.length === 0) {
      return role;
    }
    return `${role} & ${displayJobs.join(' & ')}`;
  }

  function getJobClassModifier(job) {
    if (typeof job !== 'string' || job.length === 0) {
      return '';
    }
    return job
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function renderRoleWithJobs(targetEl, role, jobs = []) {
    if (!targetEl) {
      return;
    }

    targetEl.innerHTML = '';

    const hasRole = typeof role === 'string' && role.length > 0;
    if (hasRole) {
      const roleLabel = document.createElement('span');
      roleLabel.className = 'role-label';
      roleLabel.textContent = role;
      targetEl.appendChild(roleLabel);
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return;
    }

    jobs.forEach(job => {
      const label = getJobDisplayName(job);
      if (!label) {
        return;
      }
      const modifier = getJobClassModifier(job);
      const badge = document.createElement('span');
      badge.className = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
      badge.textContent = label;
      targetEl.appendChild(badge);
    });
  }

  function findBodyguardHolderIndex() {
    ensureJobsStructure();
    for (let i = 0; i < jobsAssigned.length; i += 1) {
      const jobs = jobsAssigned[i];
      if (Array.isArray(jobs) && jobs.includes('Bodyguard')) {
        return i;
      }
    }
    return -1;
  }

  function findDoctorHolderIndex() {
    ensureJobsStructure();
    for (let i = 0; i < jobsAssigned.length; i += 1) {
      const jobs = jobsAssigned[i];
      if (Array.isArray(jobs) && jobs.includes('Doctor')) {
        return i;
      }
    }
    return -1;
  }

  function assignBodyguardJobToIndex(index) {
    if (typeof index !== 'number' || index < 0 || index >= players.length) {
      return false;
    }
    ensureJobsStructure();
    const currentIndex = findBodyguardHolderIndex();
    if (currentIndex === index) {
      return true;
    }
    if (currentIndex !== -1) {
      const currentJobs = jobsAssigned[currentIndex];
      const pos = currentJobs.indexOf('Bodyguard');
      if (pos !== -1) {
        currentJobs.splice(pos, 1);
      }
    }
    const jobs = getPlayerJobs(index);
    if (!jobs.includes('Bodyguard')) {
      jobs.push('Bodyguard');
    }
    updateDoctorPlayers();
    return true;
  }

  function assignDoctorJobToIndex(index) {
    if (typeof index !== 'number' || index < 0 || index >= players.length) {
      return false;
    }
    ensureJobsStructure();
    const currentIndex = findDoctorHolderIndex();
    if (currentIndex === index) {
      updateDoctorPlayers();
      return true;
    }
    if (currentIndex !== -1) {
      const currentJobs = jobsAssigned[currentIndex];
      const pos = currentJobs.indexOf('Doctor');
      if (pos !== -1) {
        currentJobs.splice(pos, 1);
      }
    }
    const jobs = getPlayerJobs(index);
    if (!jobs.includes('Doctor')) {
      jobs.push('Doctor');
    }
    updateDoctorPlayers();
    return true;
  }

  function assignBodyguardJobByChance() {
    if (!jobConfig || typeof jobConfig.bodyguardChance !== 'number') {
      return null;
    }
    const chance = Math.min(Math.max(jobConfig.bodyguardChance, 0), 1);
    if (chance <= 0) {
      return null;
    }
    const existingIndex = findBodyguardHolderIndex();
    if (existingIndex !== -1) {
      return players[existingIndex] || null;
    }
    if (Math.random() >= chance) {
      return null;
    }
    const eligible = players
      .map((player, index) => ({ player, index }))
      .filter(({ index }) => bodyguardEligibleRoles.has(rolesAssigned[index]));
    if (eligible.length === 0) {
      return null;
    }
    const choice = eligible[Math.floor(Math.random() * eligible.length)];
    assignBodyguardJobToIndex(choice.index);
    return choice.player;
  }

  function assignDoctorJobByChance() {
    if (!jobConfig || typeof jobConfig.doctorChance !== 'number') {
      return null;
    }
    const chance = Math.min(Math.max(jobConfig.doctorChance, 0), 1);
    if (chance <= 0) {
      return null;
    }
    const existingIndex = findDoctorHolderIndex();
    if (existingIndex !== -1) {
      return players[existingIndex] || null;
    }
    if (Math.random() >= chance) {
      return null;
    }
    const eligible = players
      .map((player, index) => ({ player, index }))
      .filter(({ index }) => doctorEligibleRoles.has(rolesAssigned[index]));
    if (eligible.length === 0) {
      return null;
    }
    const choice = eligible[Math.floor(Math.random() * eligible.length)];
    assignDoctorJobToIndex(choice.index);
    return choice.player;
  }

  function removeBodyguardJobFromIndex(index) {
    ensureJobsStructure();
    if (typeof index !== 'number' || index < 0 || index >= jobsAssigned.length) {
      return;
    }
    const jobs = jobsAssigned[index];
    if (!Array.isArray(jobs)) {
      return;
    }
    const pos = jobs.indexOf('Bodyguard');
    if (pos !== -1) {
      jobs.splice(pos, 1);
    }
    updateDoctorPlayers();
  }

  function removeDoctorJobFromIndex(index) {
    ensureJobsStructure();
    if (typeof index !== 'number' || index < 0 || index >= jobsAssigned.length) {
      return;
    }
    const jobs = jobsAssigned[index];
    if (!Array.isArray(jobs)) {
      return;
    }
    const pos = jobs.indexOf('Doctor');
    if (pos !== -1) {
      jobs.splice(pos, 1);
    }
    updateDoctorPlayers();
  }

  function hasActiveBodyguard() {
    ensureJobsStructure();
    return players.some((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Bodyguard');
    });
  }

  function hasActiveDoctor() {
    ensureJobsStructure();
    return players.some((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Doctor');
    });
  }

  function getDoctorAvailableTargets() {
    return doctorPendingTargets.filter(name => deadPlayers.includes(name));
  }

  function clearDoctorPending() {
    doctorPendingTargets = [];
    doctorPendingNight = null;
    doctorTriggerSourceNight = null;
  }

  function updateDoctorPlayers() {
    ensureJobsStructure();
    doctorPlayers = players.filter((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Doctor');
    });
    const availableTargets = getDoctorAvailableTargets();
    if (doctorPlayers.length === 0 && doctorPendingNight !== null && doctorPendingNight <= nightCounter) {
      clearDoctorPending();
      return;
    }
    if (availableTargets.length === 0 && doctorPendingNight !== null && doctorPendingNight <= nightCounter) {
      clearDoctorPending();
    } else if (availableTargets.length !== doctorPendingTargets.length) {
      doctorPendingTargets = availableTargets;
    }
  }

  function updateBodyguardPlayers() {
    ensureJobsStructure();
    bodyguardPlayers = players.filter((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Bodyguard');
    });
    updateDoctorPlayers();
  }


  let players = [];
  let rolesAssigned = [];
  let jobsAssigned = [];
  let currentIndex = 0;
  let revealed = false;

  let roleLayoutCustomized = false;
  let lastSuggestionSnapshot = null;
  let suppressCustomizationTracking = false;

  function markLayoutCustomized() {
    if (!suppressCustomizationTracking) {
      roleLayoutCustomized = true;
    }
  }

  function setRowQuantity(row, qty) {
    const display = row.querySelector(".qty-display");
    if (display) {
      display.textContent = qty;
    }
  }

  function findRoleRow(container, roleName) {
    return Array.from(container.querySelectorAll(".role-row")).find((row) => {
      const inputEl = row.querySelector('input[type="text"]');
      return inputEl && inputEl.value.trim() === roleName;
    }) || null;
  }

  function getRoleLayoutSnapshot() {
    const readContainer = (container) => {
      const result = {};
      Array.from(container.querySelectorAll(".role-row")).forEach((row) => {
        const inputEl = row.querySelector('input[type="text"]');
        const qtyEl = row.querySelector(".qty-display");
        if (!inputEl) {
          return;
        }
        const name = inputEl.value.trim();
        if (!name) {
          return;
        }
        const qty = parseInt(qtyEl && qtyEl.textContent, 10);
        result[name] = Number.isFinite(qty) ? qty : 0;
      });
      return result;
    };

    return {
      village: readContainer(rolesContainerVillage),
      werwolf: readContainer(rolesContainerWerwolf),
      special: readContainer(rolesContainerSpecial)
    };
  }

  function buildSuggestionSnapshot(suggestion) {
    const snapshot = { village: {}, werwolf: {}, special: {} };

    categorizedRoles.village.forEach((role) => {
      snapshot.village[role] = suggestion[role] || 0;
    });
    categorizedRoles.werwolf.forEach((role) => {
      snapshot.werwolf[role] = suggestion[role] || 0;
    });
    categorizedRoles.special.forEach((role) => {
      snapshot.special[role] = suggestion[role] || 0;
    });

    return snapshot;
  }

  function snapshotsEqual(a, b) {
    if (!a || !b) {
      return false;
    }

    const categories = ["village", "werwolf", "special"];
    return categories.every((category) => {
      const rolesA = a[category] || {};
      const rolesB = b[category] || {};
      const keysA = Object.keys(rolesA);
      const keysB = Object.keys(rolesB);
      if (keysA.length !== keysB.length) {
        return false;
      }
      return keysA.every((roleName) => {
        return rolesB.hasOwnProperty(roleName) && rolesA[roleName] === rolesB[roleName];
      });
    });
  }

  function layoutMatchesLastSuggestion() {
    if (!lastSuggestionSnapshot) {
      return false;
    }
    return snapshotsEqual(getRoleLayoutSnapshot(), lastSuggestionSnapshot);
  }

  // Helper to create a role input row
  function addRoleRow(value = "", qty = 1, container) {
    const row = document.createElement("div");
    row.className = "role-row";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Rolle";
    input.value = value;

    // Quantity controls
    const qtyControls = document.createElement("div");
    qtyControls.className = "qty-controls";

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.textContent = "−";
    minusBtn.className = "qty-btn";

    const qtyDisplay = document.createElement("span");
    qtyDisplay.className = "qty-display";
    qtyDisplay.textContent = qty;

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    plusBtn.className = "qty-btn";

    minusBtn.addEventListener("click", () => {
      let current = parseInt(qtyDisplay.textContent, 10);
      if (current > 0) {
        current -= 1;
        qtyDisplay.textContent = current;
        markLayoutCustomized();
      }
    });

    plusBtn.addEventListener("click", () => {
      let current = parseInt(qtyDisplay.textContent, 10);
      qtyDisplay.textContent = current + 1;
      markLayoutCustomized();
    });

    input.addEventListener("input", () => {
      markLayoutCustomized();
    });

    qtyControls.appendChild(minusBtn);
    qtyControls.appendChild(qtyDisplay);
    qtyControls.appendChild(plusBtn);

    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.textContent = "ℹ";
    infoBtn.className = "role-info-btn";
    infoBtn.addEventListener("click", () => {
      showRoleInfo(value);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✖";
    removeBtn.className = "remove-role";
    removeBtn.addEventListener("click", () => {
      container.removeChild(row);
      markLayoutCustomized();
    });

    row.appendChild(infoBtn);
    row.appendChild(input);
    row.appendChild(qtyControls);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }

  const categorizedRoles = {
      village: ["Dorfbewohner", "Seer", "Jäger", "Hexe", "Stumme Jule", "Inquisitor", "Sündenbock", "Geschwister", "Geist"],
      werwolf: ["Werwolf", "Verfluchte"],
      special: ["Amor", "Trickster", "Henker", "Friedenstifter", "Michael Jackson"]
  };

  // Descriptions for roles
  const roleDescriptions = {
    Werwolf: "Gewinnt, wenn sie alle Dorfbewohner eliminieren.",
    Dorfbewohner: "Gewinnt, wenn alle Werwölfe eliminiert sind.",
    Hexe: "Hat einen Heil- und einen Gifttrank.",
    Seer: "Kann jede Nacht die Rolle eines Spielers sehen.",
    Jäger: "Darf vor seinem Tod einen Spieler erschießen.",
    Amor: "Verknüpft zwei Liebende, die gemeinsam gewinnen.",
    Trickster: "Gewinnt, wenn er gelyncht wird, bevor die Werwölfe gewinnen.",
    "Stumme Jule": "Wählt jede Nacht jemanden, der bis zum nächsten Tag nicht reden darf.",
    Henker: "Gewinnt, wenn sein geheimes Ziel vom Dorf gelyncht wird. Spielt für sich allein.",
    Inquisitor: "Kann jede Nacht prüfen, ob jemand zur Werwolf-Fraktion gehört.",
    Verfluchte: "Startet als Dorfbewohner, wird aber zum Werwolf, wenn er von Werwölfen angegriffen wird.",
    Sündenbock: "Wird anstelle der anderen Spieler gelyncht, wenn es bei der Abstimmung einen Gleichstand gibt.",
    Geschwister: "Zwei Dorfbewohner, die sich gegenseitig kennen.",
    Geist: "Kann nach seinem Tod weiterhin eine Nachricht an die Lebenden senden.",
    Friedenstifter: "Gewinnt, wenn für zwei aufeinanderfolgende Runden (Tag und Nacht) niemand stirbt.",
    "Michael Jackson": "Dorfbewohner-Sonderrolle: Ab der ersten Beschuldigung zählt seine Stimme doppelt, bei der zweiten Beschuldigung stirbt er sofort."
  };

  const jobDescriptions = {
    Bodyguard: "Wählt jede Nacht eine Person und schützt sie vor Angriffen der Werwölfe.",
    Doctor: "Wacht nach einer blutigen Nacht auf und kann eine der Opferpersonen zurück ins Leben holen."
  };

  const villagerJobEligibleRoles = new Set([
    "Dorfbewohner",
    "Seer",
    "Jäger",
    "Hexe",
    "Stumme Jule",
    "Inquisitor",
    "Verfluchte",
    "Sündenbock",
    "Geschwister",
    "Geist",
    "Michael Jackson",
    "Friedenstifter"
  ]);

  const bodyguardEligibleRoles = villagerJobEligibleRoles;
  const doctorEligibleRoles = villagerJobEligibleRoles;

  /* -------------------- Erste Nacht Logik -------------------- */
  const nightSequence = ["Bodyguard", "Doctor", "Henker", "Geschwister", "Amor", "Seer", "Inquisitor", "Werwolf", "Hexe", "Stumme Jule"];
  const nightTexts = {
    Bodyguard: "Der Bodyguard wacht auf. Bitte wähle eine Person zum Beschützen.",
    Doctor: "Der Arzt wacht auf. Du darfst eine der Opferpersonen der letzten Nacht heilen.",
    Henker: "Der Henker wacht auf und erfährt sein Ziel.",
    Amor: "Amor wacht auf. Bitte wähle zwei Liebende.",
    Seer: "Der Seher wacht auf. Bitte wähle eine Person zum Ansehen.",
    Werwolf: "Werwölfe wachen auf. Sucht euer Opfer.",
    Hexe: "Die Hexe wacht auf. Entscheide Heil- oder Gifttrank.",
    "Stumme Jule": "Stumme Jule wacht auf. Wähle eine Person, die nicht reden darf.",
    Geschwister: "Die Geschwister wachen auf und sehen sich.",
    Inquisitor: "Der Inquisitor wacht auf. Wähle eine Person zum Befragen."
  };

  let nightMode = false;
  let dayMode = false;
  let nightSteps = [];
  let nightIndex = 0;
  let nightStepHistory = [];
  
  // Day phase variables
  let votes = {};
  let accused = [];
  let mayor = null;
  let dayCount = 0; // Track which day it is
  let dayIntroHtml = '';
  let dayAnnouncements = [];
  let currentDayAdditionalParagraphs = [];
  
  // DOM elements for day phase
  const dayOverlay = document.getElementById('day-overlay');
  const dayText = document.getElementById('day-text');
  const dayChoices = document.getElementById('day-choices');
  let dayLynchBtn = document.getElementById('day-lynch-btn');
  let daySkipBtn = document.getElementById('day-skip-btn');

  const phaseTimerManager = (() => {
    let timers = new Map();
    let paused = false;
    let onChange = () => {};
    let counter = 0;

    function notifyChange() {
      onChange();
    }

    function schedule(callback, delay, label = 'Timer') {
      counter += 1;
      const id = counter;
      const timer = {
        id,
        callback,
        delay,
        remaining: delay,
        label,
        start: Date.now(),
        timeoutId: null
      };

      const run = () => {
        if (paused) return;
        timers.delete(id);
        callback();
        notifyChange();
      };

      timer.run = run;

      if (!paused) {
        timer.timeoutId = setTimeout(run, delay);
      }

      timers.set(id, timer);
      notifyChange();
      return id;
    }

    function pause() {
      if (paused) return false;
      paused = true;
      const now = Date.now();
      timers.forEach(timer => {
        if (timer.timeoutId) {
          clearTimeout(timer.timeoutId);
          timer.timeoutId = null;
          const elapsed = now - timer.start;
          timer.remaining = Math.max(0, timer.remaining - elapsed);
        }
      });
      notifyChange();
      return true;
    }

    function resume() {
      if (!paused) return false;
      paused = false;
      const now = Date.now();
      timers.forEach(timer => {
        timer.start = now;
        if (timer.remaining <= 0) {
          timer.timeoutId = setTimeout(() => {
            timers.delete(timer.id);
            timer.callback();
            notifyChange();
          }, 0);
        } else {
          timer.timeoutId = setTimeout(() => {
            timers.delete(timer.id);
            timer.callback();
            notifyChange();
          }, timer.remaining);
        }
      });
      notifyChange();
      return true;
    }

    function cancel(id) {
      const timer = timers.get(id);
      if (!timer) return false;
      if (timer.timeoutId) {
        clearTimeout(timer.timeoutId);
      }
      timers.delete(id);
      notifyChange();
      return true;
    }

    function cancelAll() {
      timers.forEach(timer => {
        if (timer.timeoutId) {
          clearTimeout(timer.timeoutId);
        }
      });
      timers.clear();
      notifyChange();
    }

    function list() {
      const now = Date.now();
      return Array.from(timers.values()).map(timer => {
        let remaining = timer.remaining;
        if (!paused && timer.timeoutId) {
          const elapsed = now - timer.start;
          remaining = Math.max(0, timer.remaining - elapsed);
        }
        return { id: timer.id, label: timer.label, remaining };
      });
    }

    function setOnChange(handler) {
      onChange = typeof handler === 'function' ? handler : () => {};
    }

    function isPaused() {
      return paused;
    }

    return { schedule, pause, resume, cancel, cancelAll, list, setOnChange, isPaused };
  })();

  const gameCheckpoints = [];
  let isRestoringCheckpoint = false;
  let nightCounter = 0;
  let firstNightShieldUsed = false;

  function isBodyguardProtectionActive() {
    if (!nightMode) {
      return false;
    }
    if (!bodyguardProtectionTarget) {
      return false;
    }
    if (typeof bodyguardProtectionNight === 'number') {
      return bodyguardProtectionNight === nightCounter;
    }
    return true;
  }

  function isPlayerProtectedThisNight(playerName) {
    if (!playerName) {
      return false;
    }
    if (!isBodyguardProtectionActive()) {
      return false;
    }
    return bodyguardProtectionTarget === playerName;
  }

  function registerBodyguardSave(target, { source = null, logLabel = null } = {}) {
    bodyguardSavedTarget = target;
    const detail = source ? `${target} – ${source}` : target;
    const sourceText = source ? ` vor ${source}` : '';
    resultOutput.innerHTML += `<br>Der Bodyguard hat ${target}${sourceText} gerettet!`;
    logAction({ type: 'night', label: logLabel || 'Bodyguard Rettung', detail });
    renderNarratorDashboard();
  }

  function queuePhaseTimer(callback, delay, label = 'Timer') {
    return phaseTimerManager.schedule(callback, delay, label);
  }

  function setPhoenixPulseCharged(isCharged) {
    document.body.classList.toggle('phoenix-pulse-charged', !!isCharged);
  }

  function updatePhoenixPulseStatus() {
    if (!phoenixPulseStatus) {
      return;
    }

    phoenixPulseStatus.classList.remove('active', 'resolved');

    if (!isPhoenixPulseAvailable()) {
      phoenixPulseStatus.textContent = 'Phoenix Pulse: deaktiviert';
      return;
    }

    if (phoenixPulsePending) {
      phoenixPulseStatus.textContent = 'Phoenix Pulse: bereit';
      phoenixPulseStatus.classList.add('active');
    } else if (phoenixPulseJustResolved && phoenixPulseRevivedPlayers.length > 0) {
      const revivedList = phoenixPulseRevivedPlayers.join(', ');
      phoenixPulseStatus.textContent = `Phoenix Pulse: ${revivedList} zurück`; 
      phoenixPulseStatus.classList.add('resolved');
    } else {
      phoenixPulseStatus.textContent = 'Phoenix Pulse: –';
    }
  }

  function playPhoenixPulseAnimation(revivedPlayers = []) {
    return new Promise((resolve) => {
      if (!phoenixPulseOverlay) {
        resolve();
        return;
      }

      const revivedList = revivedPlayers.length > 0
        ? revivedPlayers.join(', ')
        : '';
      if (phoenixPulseMessage) {
        phoenixPulseMessage.textContent = revivedList
          ? `${revivedList} steigen wie ein Phönix aus der Asche empor!`
          : 'Die Phoenix Pulse lodert durch das Dorf.';
      }

      phoenixPulseOverlay.classList.remove('active');
      void phoenixPulseOverlay.offsetWidth; // force reflow to restart animation
      phoenixPulseOverlay.classList.add('active');

      setTimeout(() => {
        phoenixPulseOverlay.classList.remove('active');
        resolve();
      }, 3200);
    });
  }

  function handlePlayerDeath(playerName, options = {}) {
    const { silent = false } = options;
    if (silent) {
        return;
    }

    if (playerName === geist.player && !geist.messageSent) {
        const geistModal = document.getElementById('geist-modal');
        const geistMessage = document.getElementById('geist-message');
        const geistSendBtn = document.getElementById('geist-send-btn');
        geistModal.style.display = 'flex';
        geistSendBtn.onclick = () => {
            const message = geistMessage.value;
            if (message.trim()) {
                setTimeout(() => {
                    showInfoMessage({
                        title: 'Nachricht vom Geist',
                        text: `Eine Nachricht vom Geist von ${playerName}: ${message}`,
                        confirmText: 'Weiter',
                        log: { type: 'info', label: 'Geist hat gesprochen', detail: `${playerName} sendete eine Nachricht.` }
                    });
                }, 1000);
                geist.messageSent = true;
            }
            geistModal.style.display = 'none';
        };
    }

    updateBodyguardPlayers();
    renderNarratorDashboard();
  }

  function renderPlayerChoices(selectLimit = 1, customList = null) {
    nightChoices.innerHTML = "";
    let list = customList || players;

    // Check if we're showing a custom list (like currentNightVictims)
    const isCustomList = customList !== null;

    // If it's the werewolf phase, show all players but disable werewolves
    const isWerewolfPhase = nightSteps[nightIndex] === "Werwolf";

    // Build a lookup for player roles that can handle duplicate names
    const roleBuckets = players.reduce((acc, playerName, idx) => {
      if (!acc[playerName]) {
        acc[playerName] = [];
      }
      acc[playerName].push(rolesAssigned[idx]);
      return acc;
    }, {});

    const roleUsage = {};

    list.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = p;
      btn.className = "player-btn";

      // Check if this player is a werewolf (only during werewolf phase)
      const usageIndex = roleUsage[p] || 0;
      const playerRoles = roleBuckets[p] || [];
      const playerRole = playerRoles[usageIndex] || null;
      roleUsage[p] = usageIndex + 1;
      const isWerewolf = isWerewolfPhase && playerRole === "Werwolf";
      
      // Disable if:
      // 1. Player is dead (and we're not showing a custom list of dead players), OR
      // 2. It's the werewolf phase and this player is a werewolf
      btn.disabled = (!isCustomList && deadPlayers.includes(p)) || isWerewolf;
      
      // Add a class for werewolves to style them differently
      if (isWerewolf) {
        btn.classList.add('werewolf-player');
      }
      
      btn.addEventListener("click", () => {
        if (btn.disabled) return; // Don't allow selecting disabled buttons
        
        if (btn.classList.contains("selected")) {
          // If clicking an already selected button, deselect it
          btn.classList.remove("selected");
        } else {
          // For single selection (selectLimit === 1), deselect any currently selected button first
          if (selectLimit === 1) {
            const currentlySelected = nightChoices.querySelector(".player-btn.selected");
            if (currentlySelected) {
              currentlySelected.classList.remove("selected");
            }
          } else if (nightChoices.querySelectorAll(".player-btn.selected").length >= selectLimit) {
            // For multiple selection, only prevent if we've reached the limit
            return;
          }
          // Select the clicked button
          btn.classList.add("selected");
        }
      });
      
      nightChoices.appendChild(btn);
    });
    nightChoices.style.display = "flex";
  }

  function captureNightStepSnapshot(role) {
    if (isRestoringCheckpoint) {
      return;
    }

    const lastEntry = nightStepHistory[nightStepHistory.length - 1];
    if (lastEntry && lastEntry.index === nightIndex) {
      return;
    }

    while (nightStepHistory.length > 0 && nightStepHistory[nightStepHistory.length - 1].index >= nightIndex) {
      nightStepHistory.pop();
    }

    nightStepHistory.push({
      index: nightIndex,
      role,
      state: createStateSnapshot()
    });
  }

  function showNightStep() {
    // Skip to next step if no more steps
    if (nightIndex >= nightSteps.length) {
      // End of night
      nightOverlay.style.display = "none";
      startDayPhase();
      return;
    }
    
    const role = nightSteps[nightIndex];
    // Normalize role name for comparison
    const normalizedRole = role.toLowerCase();
    
    // Special case for Werewolves - they act as a team
    if (role === "Werwolf") {
      const hasLivingWerewolf = rolesAssigned.some((r, i) =>
        r === role && !deadPlayers.includes(players[i])
      );

      if (!hasLivingWerewolf) {
        // Skip to next night step if no living werewolves
        if (nightIndex < nightSteps.length - 1) {
          nightIndex++;
          showNightStep();
          return;
        }
      }
    }

    captureNightStepSnapshot(role);

    nightRoleEl.textContent = role;
    nightRoleEl.setAttribute('data-role', role);
    nightTextEl.textContent = nightTexts[role] || "Wacht auf.";

    // Reset night UI
    witchActions.innerHTML = "";
    selectedWitchAction = null;

    // Clear any existing clear button
    const existingClearBtn = document.getElementById('clear-selection-btn');
    if (existingClearBtn) {
      existingClearBtn.remove();
    }

    // Show choices based on role (case-insensitive comparison)
    if (normalizedRole === "werwolf" && bloodMoonActive) {
        document.body.classList.add('blood-moon-active');
    } else {
        document.body.classList.remove('blood-moon-active');
    }

    if (normalizedRole === "amor") {
      renderPlayerChoices(2);
      // Get the night actions container
      const nightActions = document.querySelector('.night-actions');

      // Create clear selection button for Amor
      const clearBtn = document.createElement("button");
      clearBtn.id = 'clear-selection-btn';
      clearBtn.type = "button";
      clearBtn.textContent = "Auswahl aufheben";
      clearBtn.className = "secondary-btn";
      clearBtn.addEventListener("click", () => {
        const selectedBtns = nightChoices.querySelectorAll(".player-btn.selected");
        selectedBtns.forEach(btn => btn.classList.remove("selected"));
      });

      // Insert the clear button before the continue button
      const nextBtn = document.getElementById('night-next-btn');
      nightActions.insertBefore(clearBtn, nextBtn);
    } else if (normalizedRole === "werwolf") {
      if (bloodMoonActive) {
        showConfirmation(
            "Blutmond!", 
            "Es ist Blutmond! Die Werwölfe dürfen sich 2 Opfer aussuchen.", 
            () => {
                nightTextEl.innerHTML = nightTexts['Werwolf'] + "<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.";
                renderPlayerChoices(2);
            },
            'OK',
            false,
            'blood-moon-popup'
        );
      } else {
        renderPlayerChoices(1); // limit to one victim
      }
      console.log("Werewolf phase - showing player choices");
    } else if (normalizedRole === "hexe") {
      // Build heal & poison buttons
      const healBtn = document.createElement("button");
      healBtn.type = "button";
      healBtn.textContent = `Heilen (${healRemaining})`;
      healBtn.className = "witch-btn";
      healBtn.disabled = healRemaining === 0 || currentNightVictims.length === 0;
      healBtn.addEventListener("click", () => {
        selectedWitchAction = "heal";
        healBtn.classList.add("selected");
        poisonBtn.classList.remove("selected");
        // Show only players killed in the current night for healing
        renderPlayerChoices(1, currentNightVictims);
      });

      const poisonBtn = document.createElement("button");
      poisonBtn.type = "button";
      poisonBtn.textContent = `Töten (${poisonRemaining})`;
      poisonBtn.className = "witch-btn";
      poisonBtn.disabled = poisonRemaining === 0;
      poisonBtn.addEventListener("click", () => {
        selectedWitchAction = "kill";
        poisonBtn.classList.add("selected");
        healBtn.classList.remove("selected");
        renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));
      });

      witchActions.appendChild(healBtn);
      witchActions.appendChild(poisonBtn);
      witchActions.style.display = "flex";
      nightChoices.innerHTML = "";
      nightChoices.style.display = "none";
    } else if (role === "Bodyguard") {
      renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));
    } else if (role === "Doctor") {
      const targets = getDoctorAvailableTargets();
      if (targets.length > 0) {
        nightTextEl.innerHTML = `${nightTexts[role]}<br><small>Verfügbare Ziele: ${targets.join(', ')}</small>`;
        renderPlayerChoices(1, targets);
      } else {
        nightTextEl.innerHTML = `${nightTexts[role]}<br><small>Es gibt niemanden zu heilen.</small>`;
        nightChoices.innerHTML = "";
        nightChoices.style.display = "none";
      }
    } else if (role === "Seer") {
      // Show living players for Seer to check - no clear button needed
      renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));

      // Ensure clear button is removed for Seer
      const clearBtn = document.getElementById('clear-selection-btn');
      if (clearBtn) {
        clearBtn.remove();
      }
    } else if (role === "Stumme Jule") {
      // Show living players for Stumme Jule to silence
      renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));
      
      // Add clear selection button
      const clearBtn = document.createElement("button");
      clearBtn.id = 'clear-selection-btn';
      clearBtn.type = "button";
      clearBtn.textContent = "Auswahl aufheben";
      clearBtn.className = "secondary-btn";
      clearBtn.addEventListener("click", () => {
        const selectedBtns = nightChoices.querySelectorAll(".player-btn.selected");
        selectedBtns.forEach(btn => btn.classList.remove("selected"));
      });
      
      const nightActions = document.querySelector('.night-actions');
      const nextBtn = document.getElementById('night-next-btn');
      nightActions.insertBefore(clearBtn, nextBtn);
    } else if (role === "Henker") {
        if (dayCount === 0 && henker && henker.target) {
            nightTextEl.innerHTML = `Der Henker ist <strong>${henker.player}</strong>.<br>Sein Ziel, das gelyncht werden muss, ist <strong>${henker.target}</strong>.`;
        } else {
            nightTextEl.textContent = nightTexts[role];
        }
        nightChoices.innerHTML = "";
        nightChoices.style.display = "none";
    } else if (role === "Geschwister") {
      if (dayCount === 0) { // Only on the first night
        const otherGeschwister = geschwister.filter(p => !deadPlayers.includes(p));
        nightTextEl.innerHTML = `Ihr seid die Geschwister. Die anderen Geschwister sind: <br><strong>${otherGeschwister.join(', ')}</strong>`;
      }
      nightChoices.innerHTML = "";
      nightChoices.style.display = "none";
    } else if (role === "Inquisitor") {
      renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));
    } else {
      nightChoices.innerHTML = "";
      nightChoices.style.display = "none";
    }

    renderNarratorDashboard();
  }

  function renderDayChoices(customList = null) {
    dayChoices.innerHTML = '';

    const seen = new Set();
    const candidates = (Array.isArray(customList) ? customList : players).filter(player => {
      if (seen.has(player)) return false;
      seen.add(player);
      return !deadPlayers.includes(player);
    });

    candidates.forEach(player => {
      // Container row for each player
      const row = document.createElement('div');
      row.className = 'vote-row';

      // Check if player is silenced
      const isSilenced = player === silencedPlayer;
      if (isSilenced) {
        row.classList.add('silenced');
      }

      // Player name label
      const nameSpan = document.createElement('span');
      nameSpan.textContent = player;
      nameSpan.className = 'vote-name';

      if (player === mayor) {
        row.classList.add('mayor-vote-row');
        const mayorBadge = document.createElement('span');
        mayorBadge.className = 'mayor-badge';
        mayorBadge.textContent = '2x Stimme';
        nameSpan.appendChild(mayorBadge);
      }

      const michaelEntry = michaelJacksonAccusations[player];
      if (michaelEntry?.hasSpotlight) {
        row.classList.add('spotlight-vote-row');
        const spotlightBadge = document.createElement('span');
        spotlightBadge.className = 'spotlight-badge';
        spotlightBadge.textContent = 'Spotlight 2x Stimme';
        nameSpan.appendChild(spotlightBadge);
      }

      if (isSilenced) {
        const silencedBadge = document.createElement('span');
        silencedBadge.className = 'silenced-badge';
        silencedBadge.textContent = '🤫';
        silencedBadge.title = 'Darf nicht reden oder abstimmen';
        nameSpan.appendChild(document.createElement('br'));
        nameSpan.appendChild(silencedBadge);
      }

      // Number input for vote count
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = '0';
      input.className = 'vote-input';
      input.setAttribute('data-player', player);
      
      // Disable input if player is silenced
      if (isSilenced) {
        input.disabled = true;
        input.value = '0';
        input.title = 'Darf nicht abstimmen';
      }

      row.appendChild(nameSpan);
      row.appendChild(input);
      dayChoices.appendChild(row);
    });
  }

  function buildDayIntroHtml() {
    let intro = '';

    if (!revealDeadRolesCheckbox.checked) {
      intro += currentNightVictims.length > 0
        ? `<p>In der Nacht wurden folgende Spieler getötet: <strong>${currentNightVictims.join(', ')}</strong>.</p>`
        : '<p>Es gab keine Todesfälle in der Nacht.</p>';
    }

    if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
      intro += `<p>🤫 ${silencedPlayer} wurde zum Schweigen gebracht und darf nicht reden oder abstimmen.</p>`;
    } else if (silencedPlayer && deadPlayers.includes(silencedPlayer)) {
      silencedPlayer = null;
      renderNarratorDashboard();
    }

    if (mayor) {
      intro += `<div class="mayor-indicator">Bürgermeister: ${mayor}</div>`;
    }

    return intro;
  }

  function composeDayMessage(additionalParagraphs = []) {
    currentDayAdditionalParagraphs = Array.isArray(additionalParagraphs)
      ? additionalParagraphs
      : [additionalParagraphs];
    const announcementsHtml = dayAnnouncements.join('');
    const instructionsHtml = currentDayAdditionalParagraphs.join('');
    dayText.innerHTML = `${dayIntroHtml}${announcementsHtml}${instructionsHtml}`;
  }

  function handleNoAccusation(message = 'Es wurden keine Anklagen erhoben. Niemand wird gehängt.') {
    composeDayMessage([`<p>${message}</p>`]);
    peaceDays++;
    accused = [];
    dayChoices.innerHTML = '';
    dayLynchBtn.style.display = 'none';
    daySkipBtn.textContent = 'Weiter';
    daySkipBtn.style.display = 'block';
    daySkipBtn.onclick = endDayPhase;
  }

  function renderAccusationSelection() {
    const livingPlayers = players.filter(p => !deadPlayers.includes(p));
    composeDayMessage([
      '<p>Diskutiert den Vorfall und entscheidet, wen ihr beschuldigen möchtet.</p>',
      '<p>Wählt zuerst aus, wer heute angeklagt wird. Mehrere Anklagen sind möglich.</p>'
    ]);

    dayChoices.innerHTML = '';
    livingPlayers.forEach(player => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = player;
      btn.className = 'player-btn';
      btn.onclick = () => {
        btn.classList.toggle('selected');
      };
      dayChoices.appendChild(btn);
    });

    dayLynchBtn.textContent = 'Anklagen bestätigen';
    dayLynchBtn.style.display = 'block';
    dayLynchBtn.onclick = finalizeAccusations;

    daySkipBtn.textContent = 'Keine Anklagen';
    daySkipBtn.style.display = 'block';
    daySkipBtn.onclick = () => handleNoAccusation();
  }

  function renderLynchBallot(suspects) {
    accused = Array.from(new Set((suspects || []).filter(name => !deadPlayers.includes(name))));

    if (accused.length === 0) {
      handleNoAccusation('Es stehen keine lebenden Beschuldigten mehr zur Auswahl. Niemand wird gehängt.');
      return;
    }

    composeDayMessage([
      `<p>Die folgenden Spieler wurden angeklagt: <strong>${accused.join(', ')}</strong>.</p>`,
      '<p>Gebt eure Stimmen ab und entscheidet, wer gehängt wird.</p>'
    ]);

    renderDayChoices(accused);

    dayLynchBtn.textContent = 'Hängen';
    dayLynchBtn.style.display = 'block';
    dayLynchBtn.onclick = executeLynching;

    daySkipBtn.textContent = 'Überspringen';
    daySkipBtn.style.display = 'block';
    daySkipBtn.onclick = () => {
      composeDayMessage(['<p>Die Dorfbewohner konnten sich nicht einigen. Niemand wurde gehängt.</p>']);
      peaceDays++;
      accused = [];
      dayChoices.innerHTML = '';
      dayLynchBtn.style.display = 'none';
      daySkipBtn.textContent = 'Weiter';
      daySkipBtn.onclick = endDayPhase;
    };
  }

  function finalizeAccusations() {
    const selected = Array.from(dayChoices.querySelectorAll('.player-btn.selected')).map(btn => btn.textContent);

    if (selected.length === 0) {
      handleNoAccusation();
      return;
    }

    const uniqueSelection = Array.from(new Set(selected.filter(name => !deadPlayers.includes(name))));
    if (uniqueSelection.length === 0) {
      handleNoAccusation('Es stehen keine lebenden Beschuldigten mehr zur Auswahl. Niemand wird gehängt.');
      return;
    }

    const eliminationTriggered = processMichaelJacksonAccusations(uniqueSelection);
    if (eliminationTriggered) {
      accused = [];
      return;
    }

    renderLynchBallot(uniqueSelection);
  }

  function calculateVoteResults() {
    const inputs = dayChoices.querySelectorAll('.vote-input');
    const voteCount = {};

    inputs.forEach(input => {
      const player = input.dataset.player;
      const count = parseInt(input.value, 10) || 0;
      const michaelEntry = michaelJacksonAccusations[player];
      const spotlightMultiplier = michaelEntry?.hasSpotlight ? 2 : 1;
      const mayorMultiplier = player === mayor ? 2 : 1;
      const finalCount = count * spotlightMultiplier * mayorMultiplier;
      voteCount[player] = finalCount;
    });

    // Determine players with the highest vote count
    let maxVotes = 0;
    let candidates = [];

    Object.entries(voteCount).forEach(([player, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [player];
      } else if (count === maxVotes && count > 0) {
        candidates.push(player);
      }
    });

    return { maxVotes, candidates };
  }

  function registerMichaelJacksonAccusation(playerName) {
    const playerIndex = players.indexOf(playerName);
    if (playerIndex === -1 || rolesAssigned[playerIndex] !== "Michael Jackson") {
      return null;
    }

    let entry = michaelJacksonAccusations[playerName];
    if (!entry || Array.isArray(entry)) {
      const normalizedExistingDays = Array.isArray(entry)
        ? entry
            .map(day => (typeof day === 'number' ? day : Number(day)))
            .filter(day => Number.isFinite(day))
        : [];
      const uniqueDays = Array.from(new Set(normalizedExistingDays));
      entry = {
        daysAccused: uniqueDays,
        hasSpotlight: uniqueDays.length > 0,
        accusationCount: uniqueDays.length,
        lastAccusationDay: uniqueDays.length > 0 ? Math.max(...uniqueDays) : null
      };
      michaelJacksonAccusations[playerName] = entry;
    } else {
      const normalizedStoredDays = Array.isArray(entry.daysAccused)
        ? entry.daysAccused
            .map(day => (typeof day === 'number' ? day : Number(day)))
            .filter(day => Number.isFinite(day))
        : [];
      entry.daysAccused = Array.from(new Set(normalizedStoredDays));
      if (!Number.isFinite(entry.accusationCount)) {
        entry.accusationCount = entry.daysAccused.length;
      }
      if (!(typeof entry.lastAccusationDay === 'number' && Number.isFinite(entry.lastAccusationDay))) {
        entry.lastAccusationDay = entry.daysAccused.length > 0 ? Math.max(...entry.daysAccused) : null;
      }
      if (typeof entry.hasSpotlight !== 'boolean') {
        entry.hasSpotlight = entry.accusationCount > 0;
      }
    }

    const result = { shouldEliminate: false, announcement: null };
    const wasPreviouslyAccused = entry.accusationCount > 0;

    entry.accusationCount += 1;
    const isValidDayCount = typeof dayCount === 'number' && Number.isFinite(dayCount);
    if (isValidDayCount) {
      entry.lastAccusationDay = dayCount;
      if (!entry.daysAccused.includes(dayCount)) {
        entry.daysAccused.push(dayCount);
      }
    }

    if (!entry.hasSpotlight && !wasPreviouslyAccused) {
      entry.hasSpotlight = true;
      result.announcement = `<p><strong>${playerName}</strong> steht nun im Rampenlicht! Seine Stimme zählt ab jetzt doppelt.</p>`;
    }

    result.shouldEliminate = entry.accusationCount >= 2;
    renderNarratorDashboard();
    return result;
  }

  function handleMichaelJacksonAutoElimination(playersToEliminate) {
    const newlyEliminated = [];

    playersToEliminate.forEach(name => {
      if (!deadPlayers.includes(name)) {
        deadPlayers.push(name);
        handlePlayerDeath(name);
        newlyEliminated.push(name);
      }
    });

    if (newlyEliminated.length === 0) {
      return false;
    }

    peaceDays = 0;

    const loverChainDeaths = [];

    newlyEliminated.forEach(name => {
      lovers.forEach(pair => {
        if (pair.includes(name)) {
          const partner = pair[0] === name ? pair[1] : pair[0];
          if (!deadPlayers.includes(partner)) {
            deadPlayers.push(partner);
            handlePlayerDeath(partner);
            loverChainDeaths.push({ partner, source: name });
          }
        }
      });
    });

    updatePlayerCardVisuals();

    const eliminationMessages = newlyEliminated.map(name => `<p><strong>${name}</strong> wurde zum zweiten Mal beschuldigt und stirbt als Michael Jackson sofort.</p>`);

    loverChainDeaths.forEach(({ partner, source }) => {
      eliminationMessages.push(`<p>${partner} stirbt, weil sie/er mit ${source} verliebt war.</p>`);
    });

    composeDayMessage(eliminationMessages);
    accused = [];
    dayChoices.innerHTML = '';
    dayLynchBtn.style.display = 'none';
    daySkipBtn.textContent = 'Weiter';
    daySkipBtn.style.display = 'block';
    daySkipBtn.onclick = () => {
      if (checkGameOver()) return;
      if (!checkGameOver(true)) {
        phaseTimerManager.cancelAll();
        queuePhaseTimer(() => endDayPhase(), 3000, 'Tagphase endet automatisch');
      }
    };

    return true;
  }

  function processMichaelJacksonAccusations(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return false;
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    const playersToEliminate = [];
    let announcementAdded = false;

    uniqueCandidates.forEach(player => {
      const result = registerMichaelJacksonAccusation(player);
      if (!result) {
        return;
      }

      if (result.announcement) {
        dayAnnouncements.push(result.announcement);
        announcementAdded = true;
      }

      if (result.shouldEliminate) {
        playersToEliminate.push(player);
      }
    });

    if (announcementAdded) {
      composeDayMessage(currentDayAdditionalParagraphs);
    }

    if (playersToEliminate.length === 0) {
      return false;
    }

    return handleMichaelJacksonAutoElimination(playersToEliminate);
  }

  function executeLynching() {
    const { maxVotes, candidates } = calculateVoteResults();
    const suendenbockPlayer = players.find((p, i) => rolesAssigned[i] === 'Sündenbock' && !deadPlayers.includes(p));

    if (processMichaelJacksonAccusations(candidates)) {
      return;
    }

    if (candidates.length > 1 && suendenbockPlayer) {
        // Tie vote, and Sündenbock is alive
        showConfirmation("Gleichstand!", `Es gab einen Gleichstand. Der Sündenbock ${suendenbockPlayer} wird geopfert.`, () => {
            if (!deadPlayers.includes(suendenbockPlayer)) {
                deadPlayers.push(suendenbockPlayer);
                peaceDays = 0;
                handlePlayerDeath(suendenbockPlayer);
            }
            updatePlayerCardVisuals();
            const messageParts = [`<p>${suendenbockPlayer} wurde als Sündenbock geopfert.</p>`];
            composeDayMessage(messageParts);

            const continueAfterLynch = () => {
                lovers.forEach(pair => {
                  if (pair.includes(suendenbockPlayer)) {
                    const partner = pair[0] === suendenbockPlayer ? pair[1] : pair[0];
                    if (!deadPlayers.includes(partner)) {
                      deadPlayers.push(partner);
                      messageParts.push(`<p>${partner} stirbt, weil sie/er mit ${suendenbockPlayer} verliebt war.</p>`);
                      handlePlayerDeath(partner);
                    }
                  }
                });

                composeDayMessage(messageParts);
                accused = [];
                dayChoices.innerHTML = '';
                dayLynchBtn.style.display = 'none';
                daySkipBtn.textContent = 'Weiter';
                daySkipBtn.style.display = 'block';
                daySkipBtn.onclick = () => {
                  if (checkGameOver()) return;
                  if (!checkGameOver(true)) {
                    phaseTimerManager.cancelAll();
                    queuePhaseTimer(() => endDayPhase(), 3000, 'Tagphase endet automatisch');
                  }
                };
            };

            const lynchedIndex = players.indexOf(suendenbockPlayer);
            const lynchedRole = rolesAssigned[lynchedIndex];
            if (lynchedRole === 'Jäger' && !jagerShotUsed) {
                handleJagerRevenge(suendenbockPlayer, continueAfterLynch);
            } else {
                continueAfterLynch();
            }
        });
    } else if (candidates.length === 1) {
      const lynched = candidates[0];
      showConfirmation("Spieler hängen?", `Willst du ${lynched} wirklich hängen?`, () => {
        const shieldPreventsLynch = eventConfig.firstNightShield && !firstNightShieldUsed && dayCount === 1 && nightCounter <= 1;
        const messageParts = [`<p>${lynched} wurde mit ${maxVotes} Stimmen gehängt.</p>`];
        if (shieldPreventsLynch) {
          firstNightShieldUsed = true;
          peaceDays++;
          messageParts[0] = `<p>✨ Schutznacht: ${lynched} überlebt.</p>`;
          composeDayMessage(messageParts);
          logAction({ type: 'event', label: 'Schutznacht', detail: `${lynched} entkommt der Lynchung` });
          accused = [];
          dayChoices.innerHTML = '';
          dayLynchBtn.style.display = 'none';
          daySkipBtn.textContent = 'Weiter';
          daySkipBtn.style.display = 'block';
          daySkipBtn.onclick = () => {
            if (checkGameOver()) return;
            if (!checkGameOver(true)) {
              phaseTimerManager.cancelAll();
              queuePhaseTimer(() => endDayPhase(), 3000, 'Tagphase endet automatisch');
            }
          };
          renderNarratorDashboard();
          return;
        }

        if (!deadPlayers.includes(lynched)) {
          deadPlayers.push(lynched);
          peaceDays = 0;
          handlePlayerDeath(lynched);
        }
        updatePlayerCardVisuals();
        composeDayMessage(messageParts);

        if (henker && henker.target === lynched) {
          showWin('Der Henker gewinnt!', `${henker.player} hat sein Ziel erreicht und ${lynched} wurde gelyncht.`);
          return;
        }

        const afterLynchTasks = () => {
            lovers.forEach(pair => {
              if (pair.includes(lynched)) {
                const partner = pair[0] === lynched ? pair[1] : pair[0];
                if (!deadPlayers.includes(partner)) {
                  deadPlayers.push(partner);
                  messageParts.push(`<p>${partner} stirbt, weil sie/er mit ${lynched} verliebt war.</p>`);
                  handlePlayerDeath(partner);
                }
              }
            });

            composeDayMessage(messageParts);
            accused = [];
            dayChoices.innerHTML = '';
            dayLynchBtn.style.display = 'none';
            daySkipBtn.textContent = 'Weiter';
            daySkipBtn.style.display = 'block';
            daySkipBtn.onclick = () => {
              if (checkGameOver()) return;
              if (!checkGameOver(true)) {
                phaseTimerManager.cancelAll();
                queuePhaseTimer(() => endDayPhase(), 3000, 'Tagphase endet automatisch');
              }
            };
        };

        const lynchedIndex = players.indexOf(lynched);
        const lynchedRole = rolesAssigned[lynchedIndex];
        if (lynchedRole === 'Jäger' && !jagerShotUsed) {
            handleJagerRevenge(lynched, afterLynchTasks);
        } else {
            afterLynchTasks();
        }
      });
    } else {
      composeDayMessage(['<p>Kein Spieler wurde mit ausreichend Stimmen verurteilt.</p>']);
      peaceDays++;
      accused = [];
      dayChoices.innerHTML = '';
      dayLynchBtn.style.display = 'none';
      daySkipBtn.textContent = 'Weiter';
      daySkipBtn.style.display = 'block';
      daySkipBtn.onclick = () => {
        if (!checkGameOver(true)) {
          phaseTimerManager.cancelAll();
          queuePhaseTimer(() => endDayPhase(), 3000, 'Tagphase endet automatisch');
        }
      };
    }
  }
  
  function checkGameOver(silent = false) {
    if (henker && deadPlayers.includes(henker.target)) {
        const henkerPlayer = players.find((p, i) => rolesAssigned[i] === 'Henker');
        if (henkerPlayer && !deadPlayers.includes(henkerPlayer)) {
            if (!silent) {
                showWin('Der Henker gewinnt!', `${henker.player} hat sein Ziel erreicht und ${henker.target} wurde gelyncht.`);
            }
            return true;
        }
    }

    const friedensstifterPlayer = players.find((p, i) => rolesAssigned[i] === 'Friedenstifter' && !deadPlayers.includes(p));
    if (friedensstifterPlayer && peaceDays >= 4) { // 2 full rounds
        if (!silent) {
            showWin('Der Friedenstifter gewinnt!', 'Zwei Runden lang ist niemand gestorben.');
        }
        return true;
    }

    const livingPlayers = players.filter(p => !deadPlayers.includes(p));
    const livingWerewolves = livingPlayers.filter(p => {
      const role = rolesAssigned[players.indexOf(p)];
      return role === 'Werwolf' && !deadPlayers.includes(p);
    });
    
    if (lovers.length > 0) {
      const livingLovers = lovers.flat().filter(p => livingPlayers.includes(p));
      if (livingLovers.length === livingPlayers.length && livingPlayers.length > 0) {
        if (!silent) {
          showWin('Die Liebenden gewinnen!', 'Nur noch das Liebespaar ist am Leben.');
        }
        return true;
      }
    }

    if (livingWerewolves.length === 0) {
      if (!silent) {
        showWin('Dorfbewohner gewinnen!', 'Alle Werwölfe wurden eliminiert.');
      }
      return true;
    }
    
    if (livingWerewolves.length >= livingPlayers.length - livingWerewolves.length) {
      if (!silent) {
        showWin('Werwölfe gewinnen!', 'Die Werwölfe haben das Dorf überrannt.');
      }
      return true;
    }
    
    return false;
  }
  
  function electMayor() {
    dayOverlay.style.display = 'flex';
    dayOverlay.classList.add('show');
    
    const livingPlayers = players.filter(p => !deadPlayers.includes(p));

    let silencedMessage = '';
    if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
      silencedMessage = `<p>🤫 ${silencedPlayer} wurde zum Schweigen gebracht und darf nicht reden oder abstimmen.</p>`;
    } else {
      silencedPlayer = null;
    }
    
    let deathAnnouncement = '';
    if (!revealDeadRolesCheckbox.checked) {
        deathAnnouncement = `<p>In der Nacht sind folgende Spieler gestorben: <strong>${currentNightVictims.join(', ') || 'niemand'}</strong>.</p>`;
    }

    dayText.innerHTML = `
      ${deathAnnouncement}
      ${silencedMessage}
      <p>Wählt jetzt einen Bürgermeister.</p>
    `;
    
    dayChoices.innerHTML = '';
    livingPlayers.forEach(player => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = player;
      btn.className = 'player-btn';
      btn.onclick = () => {
        const selected = dayChoices.querySelector('.player-btn.selected');
        if (selected) selected.classList.remove('selected');
        btn.classList.add('selected');
      };
      dayChoices.appendChild(btn);
    });

    dayLynchBtn.textContent = 'Bürgermeister wählen';
    daySkipBtn.style.display = 'none';

    dayLynchBtn.onclick = () => {
      const selected = dayChoices.querySelector('.player-btn.selected');
      if (!selected) {
        showInfoMessage({
          title: 'Auswahl erforderlich',
          text: 'Bitte wählt einen Bürgermeister.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Bürgermeisterwahl unvollständig', detail: 'Es wurde kein Kandidat ausgewählt.' }
        });
        return;
      }
      const newMayor = selected.textContent;
      showConfirmation("Bürgermeister wählen?", `Willst du ${newMayor} wirklich zum Bürgermeister wählen?`, () => {
        mayor = newMayor;
        renderNarratorDashboard();
        dayText.innerHTML = `<p><strong>${mayor}</strong> ist jetzt der Bürgermeister!</p>`;
        dayChoices.innerHTML = '';
        dayLynchBtn.style.display = 'none';
        daySkipBtn.textContent = 'Weiter';
        daySkipBtn.style.display = 'block';
        daySkipBtn.onclick = startNormalDayPhase;
      });
    };
  }
  
  function startNormalDayPhase() {
    dayOverlay.style.display = 'flex';
    dayOverlay.classList.add('show');
    accused = accused.filter(player => !deadPlayers.includes(player));
    dayIntroHtml = buildDayIntroHtml();

    if (accused.length > 0) {
      renderLynchBallot(accused);
    } else {
      renderAccusationSelection();
    }

    renderNarratorDashboard();
  }

  function showGraveyardModal() {
    const revealRoles = revealDeadRolesCheckbox.checked;

    const afterGraveyard = () => {
        if (jagerDiedLastNight) {
            const jagerName = jagerDiedLastNight;
            jagerDiedLastNight = null;
            handleJagerRevenge(jagerName, () => {
                if (dayCount === 1 && !mayor) {
                    electMayor();
                } else {
                    startNormalDayPhase();
                }
            });
        } else {
            if (dayCount === 1 && !mayor) {
                electMayor();
            } else {
                startNormalDayPhase();
            }
        }
    };

    if (!revealRoles || currentNightVictims.length === 0) {
      afterGraveyard();
      return;
    }

    graveyardGrid.innerHTML = '';
    let currentlyFlippedCard = null;

    currentNightVictims.forEach((victimName, index) => {
      const playerIndex = players.indexOf(victimName);
      const role = rolesAssigned[playerIndex];
      const jobs = getPlayerJobs(playerIndex);

      const card = document.createElement('div');
      card.className = 'reveal-card';
      card.style.animationDelay = `${index * 0.1}s`;
      card.onclick = () => {
        if (currentlyFlippedCard && currentlyFlippedCard !== card) {
          currentlyFlippedCard.classList.remove('flipped');
        }
        card.classList.toggle('flipped');
        currentlyFlippedCard = card.classList.contains('flipped') ? card : null;
      };
      
      const inner = document.createElement('div');
      inner.className = 'reveal-card-inner';
      
      const front = document.createElement('div');
      front.className = 'reveal-card-front';
      front.textContent = victimName;
      
      const back = document.createElement('div');
      back.className = 'reveal-card-back';
      const roleNameEl = document.createElement('span');
      roleNameEl.className = 'role-name';
      if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
        roleNameEl.classList.add('long-text');
      }
      renderRoleWithJobs(roleNameEl, role, jobs);
      back.innerHTML = `<span class="player-name">${victimName}</span>`;
      back.prepend(roleNameEl);

      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation();
        showRoleInfo(role, { jobs });
      };
      back.appendChild(infoBtn);

      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);
      graveyardGrid.appendChild(card);
    });

    graveyardModal.style.display = 'flex';

    graveyardCloseBtn.onclick = () => {
      graveyardModal.style.display = 'none';
      afterGraveyard();
    };
  }

  function applyPhoenixPulseRevival() {
    if (!phoenixPulsePending) {
      phoenixPulseJustResolved = false;
      phoenixPulseRevivedPlayers = [];
      updatePhoenixPulseStatus();
      return [];
    }

    const victims = currentNightVictims.slice();
    if (victims.length === 0) {
      phoenixPulsePending = false;
      phoenixPulseJustResolved = false;
      phoenixPulseRevivedPlayers = [];
      setPhoenixPulseCharged(false);
      updatePhoenixPulseStatus();
      renderNarratorDashboard();
      return [];
    }

    const revived = victims.filter(name => deadPlayers.includes(name));
    if (victims.length > 0) {
      deadPlayers = deadPlayers.filter(player => !victims.includes(player));
      currentNightVictims = [];
      updatePlayerCardVisuals();
      populateAdminKillSelect();
      populateAdminReviveSelect();
      checkGameOver(true);
    }
    if (revived.includes(jagerDiedLastNight)) {
      jagerDiedLastNight = null;
    }
    if (revived.length > 0) {
      if (resultOutput) {
        resultOutput.innerHTML += `<br><strong>🔥 Phoenix Pulse:</strong> ${revived.join(', ')} kehren zurück!`;
      }
      logAction({
        type: 'event',
        label: 'Phoenix Pulse',
        detail: `Wiederbelebt: ${revived.join(', ')}`
      });
    }

    phoenixPulsePending = false;
    phoenixPulseJustResolved = revived.length > 0;
    phoenixPulseRevivedPlayers = revived;
    setPhoenixPulseCharged(false);
    updatePhoenixPulseStatus();
    eventScheduler.completeQueuedEffect('phoenix-pulse', { revived });
    persistEventEngineState();
    renderNarratorDashboard();

    return revived;
  }

  function startDayPhase() {
    dayMode = true;
    dayCount++;
    accused = [];
    dayAnnouncements = [];
    currentDayAdditionalParagraphs = [];
    dayIntroHtml = '';

    const revivedByPhoenix = applyPhoenixPulseRevival();
    if (revivedByPhoenix.length > 0) {
      const revivedList = revivedByPhoenix.join(', ');
      dayAnnouncements.push(`
        <div class="phoenix-announcement">
          <h4>🔥 Phoenix Pulse</h4>
          <p>${revivedList} wurden in den Morgenstunden wiederbelebt.</p>
        </div>
      `);
    }

    if (currentNightVictims.length === 0) {
        peaceDays++;
    } else {
        peaceDays = 0;
    }

    if (checkGameOver()) return;

    phaseTimerManager.cancelAll();
    captureGameCheckpoint(`Start Tag ${dayCount}`);

    const continueToDay = () => {
      document.querySelector('.container').classList.add('hidden');
      showGraveyardModal();
    };

    if (revivedByPhoenix.length > 0) {
      playPhoenixPulseAnimation(revivedByPhoenix).then(() => {
        continueToDay();
      });
    } else {
      continueToDay();
    }
  }
  
  function endDayPhase() {
    dayMode = false;
    dayOverlay.classList.remove('show');
    document.querySelector('.container').classList.remove('hidden');

    // Reset for next night
    currentNightVictims = [];

    // Start the next night phase after a short delay
    phaseTimerManager.cancelAll();
    queuePhaseTimer(() => {
      startNightBtn.click();
    }, 1000, 'Neue Nacht starten');

    renderNarratorDashboard();
  }

  function moveToNextNightStep() {
    if (nightIndex < nightSteps.length - 1) {
      nightIndex++;
      showNightStep();
    } else {
      // Nacht beendet
      setBloodMoonState(false);
      nightMode = false;
      nightOverlay.style.display = "none";
      assignBtn.style.display = "inline-block";
      startNightBtn.style.display = "none";
      console.log("Tote Spieler:", deadPlayers);
      console.log("Liebespaare:", lovers);

      const uniqueVictims = Array.from(new Set(currentNightVictims));
      if (uniqueVictims.length >= 2) {
        doctorPendingTargets = uniqueVictims.slice();
        doctorPendingNight = nightCounter + 1;
        doctorTriggerSourceNight = nightCounter;
      }

      nightStepHistory = [];
      renderNarratorDashboard();

      // Start the day phase
      phaseTimerManager.cancelAll();
      queuePhaseTimer(() => {
        startDayPhase();
      }, 1000, 'Tagphase vorbereiten');
    }
  }

  function advanceNight() {
    const role = nightSteps[nightIndex];
    
    // No skipping of roles during the night phase
    // All roles get their turn in the night they were killed
    // Only check for dead players at the start of the night phase
    
    // Handle selections before moving on
    if (role === "Bodyguard") {
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        showInfoMessage({
          title: 'Ziel erforderlich',
          text: 'Bitte wähle eine Person zum Beschützen aus.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Bodyguard ohne Ziel', detail: 'Der Bodyguard benötigt eine Auswahl.' }
        });
        return;
      }
      const name = selected.textContent;
      showConfirmation('Schutz bestätigen?', `Willst du ${name} in dieser Nacht beschützen?`, () => {
        bodyguardProtectionTarget = name;
        bodyguardProtectionNight = nightCounter;
        bodyguardSavedTarget = null;
        resultOutput.innerHTML += `<br>Der Bodyguard beschützt ${name}.`;
        logAction({ type: 'night', label: 'Bodyguard schützt', detail: name });
        renderNarratorDashboard();
        moveToNextNightStep();
      });
      return;
    } else if (role === "Doctor") {
      const availableTargets = getDoctorAvailableTargets();
      if (availableTargets.length === 0) {
        clearDoctorPending();
        renderNarratorDashboard();
        moveToNextNightStep();
        return;
      }
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        showConfirmation({
          title: 'Keine Heilung?',
          text: 'Der Arzt kann diese Nacht eine Person heilen. Soll er darauf verzichten?',
          confirmText: 'Überspringen',
          cancelText: 'Zurück',
          onConfirm: () => {
            clearDoctorPending();
            logAction({ type: 'night', label: 'Arzt verzichtet', detail: 'Keine Heilung gewählt' });
            renderNarratorDashboard();
            moveToNextNightStep();
          }
        });
        return;
      }
      const name = selected.textContent;
      showConfirmation('Heilung einsetzen?', `Soll ${name} vom Arzt geheilt werden?`, () => {
        const wasDead = deadPlayers.includes(name);
        if (wasDead) {
          deadPlayers = deadPlayers.filter(player => player !== name);
          doctorPendingTargets = doctorPendingTargets.filter(player => player !== name);
          doctorLastHealedTarget = name;
          doctorLastHealedNight = nightCounter;
          updatePlayerCardVisuals();
          populateAdminKillSelect();
          populateAdminReviveSelect();
          if (name === jagerDiedLastNight) {
            jagerDiedLastNight = null;
          }
          checkGameOver(true);
          if (resultOutput) {
            resultOutput.innerHTML += `<br>🩺 Der Arzt hat ${name} geheilt!`;
          }
          logAction({ type: 'night', label: 'Arzt heilt', detail: name });
        } else {
          if (resultOutput) {
            resultOutput.innerHTML += `<br>🩺 Der Arzt wollte ${name} heilen, aber die Person lebt bereits.`;
          }
          logAction({ type: 'night', label: 'Arzt vergeblich', detail: `${name} war bereits am Leben` });
        }
        clearDoctorPending();
        renderNarratorDashboard();
        moveToNextNightStep();
      });
      return;
    } else if (role === "Hexe") {
      if (!selectedWitchAction) {
        // Witch skipped actions, so just proceed
        moveToNextNightStep();
        return;
      } else if (selectedWitchAction === "heal") {
        const victim = nightChoices.querySelector(".player-btn.selected");
        if (!victim) {
          showInfoMessage({
            title: 'Ziel erforderlich',
            text: 'Bitte ein Opfer zum Heilen auswählen.',
            confirmText: 'Okay',
            log: { type: 'error', label: 'Heiltrank ohne Ziel', detail: 'Die Hexe muss ein Opfer zum Retten wählen.' }
          });
          return;
        }
        const name = victim.textContent;
        showConfirmation("Heiltrank einsetzen?", `Willst du ${name} wirklich heilen? Dieser Trank kann nur einmal pro Spiel verwendet werden.`, () => {
          deadPlayers = deadPlayers.filter((p) => p !== name);
          currentNightVictims = currentNightVictims.filter((p) => p !== name);
          healRemaining--;
          updatePlayerCardVisuals();
          resultOutput.innerHTML += `<br>Die Hexe hat ${name} geheilt!`;
          moveToNextNightStep();
        });
        return; // Wait for confirmation
      } else if (selectedWitchAction === "kill") {
        const target = nightChoices.querySelector(".player-btn.selected");
        if (!target) {
          showInfoMessage({
            title: 'Ziel erforderlich',
            text: 'Bitte ein Ziel zum Töten auswählen.',
            confirmText: 'Okay',
            log: { type: 'error', label: 'Gifttrank ohne Ziel', detail: 'Die Hexe muss ein Opfer für den Gifttrank wählen.' }
          });
          return;
        }
        const name = target.textContent;
        showConfirmation("Gifttrank einsetzen?", `Willst du ${name} wirklich vergiften? Dieser Trank kann nur einmal pro Spiel verwendet werden.`, () => {
          const protectedTarget = isPlayerProtectedThisNight(name);
          if (protectedTarget) {
            poisonRemaining--;
            resultOutput.innerHTML += `<br>Die Hexe hat versucht, ${name} zu vergiften!`;
            registerBodyguardSave(name, { source: 'der Hexe', logLabel: 'Bodyguard Rettung (Hexe)' });
            moveToNextNightStep();
            return;
          }
          if (!deadPlayers.includes(name)) {
            deadPlayers.push(name);
            currentNightVictims.push(name);
            const victimIndex = players.indexOf(name);
            if (rolesAssigned[victimIndex] === 'Jäger') {
                jagerDiedLastNight = name;
            }
            handlePlayerDeath(name);
          }
          updatePlayerCardVisuals();
          // lover chain effect
          lovers.forEach((pair) => {
            if (pair.includes(name)) {
              const partner = pair[0] === name ? pair[1] : pair[0];
              if (!deadPlayers.includes(partner)) {
                deadPlayers.push(partner);
                currentNightVictims.push(partner);
                handlePlayerDeath(partner);
              }
            }
          });
          poisonRemaining--;
          resultOutput.innerHTML += `<br>Die Hexe hat ${name} vergiftet!`;
          moveToNextNightStep();
        });
        return; // Wait for confirmation
      }
    } else if (role === "Amor") {
      const selected = Array.from(
        nightChoices.querySelectorAll(".player-btn.selected")
      ).map((b) => b.textContent);
      if (selected.length !== 2) {
        showInfoMessage({
          title: 'Auswahl unvollständig',
          text: 'Bitte genau zwei Liebende auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Liebespaar nicht gesetzt', detail: 'Amor benötigt zwei ausgewählte Personen.' }
        });
        return;
      }
      showConfirmation("Liebespaar wählen?", `Willst du ${selected[0]} und ${selected[1]} wirklich zum Liebespaar machen?`, () => {
        lovers.push(selected);
        moveToNextNightStep();
      });
      return; // Wait for confirmation
    } else if (role === "Seer") {
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        showInfoMessage({
          title: 'Ziel erforderlich',
          text: 'Bitte eine Person zum Ansehen auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Seher ohne Ziel', detail: 'Der Seher benötigt eine Auswahl für die Vision.' }
        });
        return;
      }
      const name = selected.textContent;
      showConfirmation("Spieler ansehen?", `Willst du die Rolle von ${name} wirklich ansehen?`, () => {
        const index = players.indexOf(name);
        const seenRole = rolesAssigned[index];
        
        // Show the role in the modal
        seerVisionText.innerHTML = `Du hast <strong>${name}</strong> ausgewählt.<br><br>Diese Person ist der/die <strong>${seenRole}*innen</strong>.`;
        seerVisionModal.style.display = 'flex';
        
        // Add to game log
        resultOutput.innerHTML += `<br>Der Seher hat ${name} angesehen.`;
      });
      return; // Wait for confirmation
    } else if (role === "Werwolf") {
      const selected = nightChoices.querySelectorAll(".player-btn.selected");
      if (selected.length === 0) {
        showInfoMessage({
          title: 'Auswahl erforderlich',
          text: 'Bitte ein Opfer auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Kein Werwolf-Opfer gewählt', detail: 'Die Werwölfe müssen ein Opfer bestimmen.' }
        });
        return;
      }
      const victims = Array.from(selected).map(btn => btn.textContent);
      const victimNames = victims.join(' und ');
      showConfirmation("Opfer auswählen?", `Willst du ${victimNames} wirklich fressen?`, () => {
        const shouldTriggerFirstNightShield = eventConfig.firstNightShield && !firstNightShieldUsed && nightCounter <= 1;
        if (shouldTriggerFirstNightShield) {
          const plural = victims.length > 1 ? 'überleben' : 'überlebt';
          if (resultOutput) {
            resultOutput.innerHTML += `<br>✨ Schutznacht: ${victimNames} ${plural}.`;
          }
          logAction({ type: 'event', label: 'Schutznacht', detail: victimNames });
          firstNightShieldUsed = true;
          renderNarratorDashboard();
          moveToNextNightStep();
          return;
        }

        victims.forEach(victim => {
          if (isPlayerProtectedThisNight(victim)) {
            registerBodyguardSave(victim, { source: 'den Werwölfen' });
            return;
          }

          const victimIndex = players.indexOf(victim);
          const victimRole = rolesAssigned[victimIndex];

          if (victimRole === 'Verfluchte') {
            rolesAssigned[victimIndex] = 'Werwolf';
            console.log(`${victim} was Verfluchte and is now a Werwolf.`);
            setTimeout(() => {
              showConfirmation(
                "Verwandlung!",
                `${victim} war der Verfluchte und ist jetzt ein Werwolf. Sage es ihm/ihr nicht. Er/Sie wird ab der nächsten Nacht mit den Werwölfen aufwachen.`,
                () => {}, // No action needed on confirm
                "Verstanden",
                false // No cancel button
              );
            }, 500);
          } else {
            if (!deadPlayers.includes(victim)) {
              deadPlayers.push(victim);
              currentNightVictims.push(victim);
              if (rolesAssigned[victimIndex] === 'Jäger') {
                jagerDiedLastNight = victim;
              }
              handlePlayerDeath(victim);
              console.log("Player killed by werewolves:", victim);
            }
          }

          updatePlayerCardVisuals();
          // lover chain effect
          lovers.forEach((pair) => {
            if (pair.includes(victim)) {
              const partner = pair[0] === victim ? pair[1] : pair[0];
              if (!deadPlayers.includes(partner)) {
                deadPlayers.push(partner);
                currentNightVictims.push(partner);
                handlePlayerDeath(partner);
              }
            }
          });
        });
        renderNarratorDashboard();
        moveToNextNightStep();
      });
      return; // Wait for confirmation
    } else if (role === "Stumme Jule") {
        const selected = nightChoices.querySelector(".player-btn.selected");
        if (!selected) {
            showInfoMessage({
                title: 'Ziel erforderlich',
                text: 'Bitte eine Person zum Schweigen auswählen.',
                confirmText: 'Okay',
                log: { type: 'error', label: 'Stumme Jule ohne Ziel', detail: 'Die Stumme Jule benötigt eine Auswahl.' }
            });
            return;
        }
        const name = selected.textContent;
        showConfirmation("Spieler stumm schalten?", `Willst du ${name} wirklich für den nächsten Tag stumm schalten?`, () => {
            silencedPlayer = name;
            renderNarratorDashboard();
            moveToNextNightStep();
        });
        return; // Wait for confirmation
    } else if (role === "Inquisitor") {
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        showInfoMessage({
          title: 'Ziel erforderlich',
          text: 'Bitte eine Person zum Befragen auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Inquisitor ohne Ziel', detail: 'Der Inquisitor benötigt eine Auswahl.' }
        });
        return;
      }
      const name = selected.textContent;
      showConfirmation("Spieler befragen?", `Willst du ${name} wirklich befragen?`, () => {
        const index = players.indexOf(name);
        const seenRole = rolesAssigned[index];
        const isEvil = seenRole === 'Werwolf';
        
        seerVisionText.innerHTML = `Du hast <strong>${name}</strong> befragt.<br><br>Diese Person gehört <strong>${isEvil ? 'zur Werwolf-Fraktion' : 'nicht zur Werwolf-Fraktion'}</strong>.`;
        seerVisionModal.style.display = 'flex';
        
        resultOutput.innerHTML += `<br>Der Inquisitor hat ${name} befragt.`;
      });
      return; // Wait for confirmation
    } else if (role === "Geschwister" || role === "Henker") {
        moveToNextNightStep(); // Nothing to confirm, just move on
        return;
    }

    moveToNextNightStep();
  }

  // Night phase event listeners
  nightNextBtn.addEventListener("click", advanceNight);
  
  // Seer Vision Modal
  const seerVisionModal = document.getElementById('seerVisionModal');
  const seerVisionText = document.getElementById('seerVisionText');
  const closeSeerVision = document.getElementById('closeSeerVision');
  
  function closeSeerModalAndProceed() {
    if (seerVisionModal.style.display !== 'none') {
        seerVisionModal.style.display = 'none';
        moveToNextNightStep();
    }
  }

  closeSeerVision.addEventListener('click', closeSeerModalAndProceed);
  
  // Close modal when clicking outside of it
  window.addEventListener('click', (event) => {
    if (event.target === seerVisionModal) {
      closeSeerModalAndProceed();
    }
    if (event.target === roleInfoModal) {
      roleInfoModal.style.display = 'none';
    }
    if (event.target === rolesOverviewModal) {
      rolesOverviewModal.style.display = 'none';
    }
    if (event.target === configModal) {
      closeConfigModal();
    }
  });
  
  // Day phase event listeners
  // We'll handle click events through direct onclick assignments
  // to prevent multiple event listeners from stacking up

  function updateBloodMoonOdds() {
    const oddsEl = document.getElementById('blood-moon-odds');
    if (!oddsEl) {
      return;
    }

    if (!isBloodMoonAvailable()) {
      oddsEl.textContent = 'Blutmond deaktiviert';
      return;
    }

    const rawTimer = parseInt(getPersistedValue('bloodMoonPityTimer') || '0', 10);
    const pityTimer = Number.isFinite(rawTimer) ? Math.max(rawTimer, 0) : 0;
    const bloodMoonChance = getBloodMoonChance(pityTimer);
    oddsEl.textContent = `Blutmond-Chance diese Nacht: ${Math.round(bloodMoonChance * 100)}%`;
  }

  function buildEventTriggerContext(nightNumber) {
    return {
      nightNumber,
      flags: {
        randomEventsEnabled: areRandomEventsEnabled(),
        bloodMoonEnabled: isBloodMoonEventEnabled(),
        phoenixEnabled: isPhoenixPulseEventEnabled()
      },
      state: {
        bloodMoonActive
      },
      storage: {
        getNumber(key, fallback = 0) {
          const raw = getPersistedValue(key);
          if (raw === null || raw === undefined) {
            return fallback;
          }
          const value = Number(raw);
          return Number.isFinite(value) ? value : fallback;
        },
        setNumber(key, value) {
          try {
            const numeric = Number.isFinite(value) ? value : 0;
            persistValue(key, String(numeric));
          } catch (error) {
            // Ignore storage errors
          }
        }
      },
      helpers: {
        getBloodMoonChance,
        getPhoenixPulseChance
      },
      random: Math.random
    };
  }

  function buildNightDeckEntries() {
    const activeDecks = new Set(getActiveDeckIds());
    return eventCardDefinitions
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => {
        if (!card || !card.id) {
          return false;
        }
        if (!card.deckId) {
          return true;
        }
        return activeDecks.has(card.deckId);
      })
      .map(({ card, index }) => {
        const deckConfig = eventConfig.decks[card.deckId] || { enabled: true, weight: 1 };
        const weight = Math.max(0, Number(deckConfig.weight) || 0);
        return { card, weight, index };
      })
      .filter(entry => entry.weight > 0)
      .sort((a, b) => {
        const weightDiff = b.weight - a.weight;
        if (Math.abs(weightDiff) > Number.EPSILON) {
          return weightDiff;
        }
        return a.index - b.index;
      });
  }

  function executeEventCard(card, meta, nightNumber, { scriptStep = null } = {}) {
    if (!card) {
      return;
    }
    const effectResult = typeof card.effect === 'function'
      ? card.effect({
          scheduler: eventScheduler,
          helpers: {
            logAction,
            refreshEventUI,
            setBloodMoonState,
            clearBloodMoonState,
            setPhoenixPulseCharged,
            updatePhoenixPulseStatus
          },
          meta,
          nightNumber,
          scriptStep
        }) || {}
      : {};

    if (effectResult.log) {
      logAction(effectResult.log);
    }

    if (effectResult.message && resultOutput) {
      resultOutput.innerHTML += effectResult.message;
    }

    const historyEntry = {
      night: nightNumber,
      cardId: card.id,
      label: card.label || card.id,
      meta,
      narratorNote: effectResult.narratorNote || null,
      scriptStep: scriptStep ? { ...scriptStep } : null
    };
    eventScheduler.recordHistory(historyEntry);
    persistEventEngineState();
  }

  function evaluateEventCard(card, deckWeight, nightNumber) {
    if (!card || typeof card.trigger !== 'function') {
      return { triggered: false, reason: 'missing-trigger' };
    }
    const weight = Math.max(0, Number(deckWeight) || 0);
    if (weight <= 0) {
      return { triggered: false, reason: 'weight-zero' };
    }
    const context = buildEventTriggerContext(nightNumber);
    if (weight < 1) {
      const gateRoll = Math.random();
      if (gateRoll > weight) {
        return { triggered: false, reason: 'weight-gate', gateRoll };
      }
    }
    let meta = card.trigger(context) || { triggered: false };
    if (!meta.triggered && weight > 1) {
      const tries = Math.max(1, Math.round(weight));
      for (let attempt = 1; attempt < tries; attempt += 1) {
        meta = card.trigger(context) || { triggered: false };
        if (meta.triggered) {
          break;
        }
      }
    }
    return meta;
  }

  function triggerRandomEvents() {
    const upcomingNightNumber = nightCounter + 1;
    eventScheduler.clearExpiredModifiers(upcomingNightNumber);

    if (!areRandomEventsEnabled()) {
      persistEventEngineState();
      renderNarratorDashboard();
      return;
    }

    const forcedCardIds = new Set();
    const campaign = campaignDefinitions.find(entry => entry && entry.id === eventConfig.campaignId);
    if (campaign) {
      const executedKeys = new Set(eventEngineState?.campaignProgress?.executed || []);
      const script = Array.isArray(campaign.script) ? campaign.script : [];
      script
        .filter(step => step && step.eventId && step.night === upcomingNightNumber)
        .forEach(step => {
          const key = `${step.night || 0}:${step.eventId}`;
          if (executedKeys.has(key)) {
            return;
          }
          const card = eventCardDefinitions.find(entry => entry.id === step.eventId);
          if (!card) {
            return;
          }
          forcedCardIds.add(card.id);
          const meta = { triggered: true, forced: true, script: step };
          executeEventCard(card, meta, upcomingNightNumber, { scriptStep: step });
          markCampaignStepExecuted(step);
        });
    }

  const deckEntries = buildNightDeckEntries();
  deckEntries.forEach(entry => {
    if (forcedCardIds.has(entry.card.id)) {
      return;
    }
      const meta = evaluateEventCard(entry.card, entry.weight, upcomingNightNumber);
      if (meta && meta.triggered) {
        executeEventCard(entry.card, meta, upcomingNightNumber);
      } else if (meta && meta.reason !== 'disabled') {
        eventScheduler.recordHistory({
          night: upcomingNightNumber,
          cardId: entry.card.id,
          label: entry.card.label || entry.card.id,
          meta,
          narratorNote: null
        });
      }
    });

    persistEventEngineState();
    renderNarratorDashboard();
  }

  startNightBtn.addEventListener("click", () => {
    document.querySelector('.container').classList.add('hidden');
    // Get living players and their roles
    const livingPlayerRoles = [];
    players.forEach((player, index) => {
      if (!deadPlayers.includes(player)) {
        livingPlayerRoles.push(rolesAssigned[index]);
      }
    });
    
    updateBodyguardPlayers();
    const livingRoleSet = new Set(livingPlayerRoles);
    const bodyguardActive = hasActiveBodyguard();
    const upcomingNightNumber = nightCounter + 1;
    const doctorActive = hasActiveDoctor();
    const doctorTargets = getDoctorAvailableTargets();
    if (doctorPendingNight !== null && doctorPendingNight < upcomingNightNumber) {
      clearDoctorPending();
    }
    const doctorShouldAct = doctorActive
      && doctorPendingNight === upcomingNightNumber
      && doctorTargets.length > 0;
    if (doctorPendingNight === upcomingNightNumber && doctorTargets.length === 0) {
      clearDoctorPending();
    }

    // Filter night sequence based on available living roles
    nightSteps = nightSequence.filter((r) => {
      if (r === "Bodyguard") {
        return bodyguardActive;
      }
      if (r === "Doctor") {
        return doctorShouldAct;
      }
      if (r === "Amor" || r === "Geschwister" || r === "Henker") {
        return livingRoleSet.has(r) && dayCount === 0;
      }
      return livingRoleSet.has(r);
    });

    if (nightSteps.length === 0) {
      resultOutput.innerHTML = "Keine Nachtaktionen nötig.";
      startNightBtn.style.display = "none";
      return;
    }

    // Reset state for new night
    currentNightVictims = [];
    bodyguardProtectionTarget = null;
    bodyguardProtectionNight = null;
    bodyguardSavedTarget = null;
    updateBodyguardPlayers();
    nightMode = true;
    nightIndex = 0;

    // Trigger random events
    triggerRandomEvents();

    phaseTimerManager.cancelAll();
    nightCounter += 1;
    captureGameCheckpoint(`Start Nacht ${nightCounter}`);

    nightStepHistory = [];
    nightOverlay.style.display = "flex";
    showNightStep();
    startNightBtn.style.display = "none";
    assignBtn.style.display = "none";
    document.querySelector('.navigation-buttons').style.display = 'none';
  });

  // Dynamic role suggestions based on player count
  const playersTextarea = document.getElementById("players");
  const saveNamesBtn = document.getElementById("save-names-manually");
  const loadNamesBtn = document.getElementById("load-saved-names");
  const saveRolesBtn = document.getElementById("save-roles-manually");
  const loadRolesBtn = document.getElementById("load-saved-roles");
  const loadLastUsedBtn = document.getElementById("load-last-used");

  let isLoadingLastUsed = false;

  const roleSuggestions = {
    4: { Dorfbewohner: 2, Werwolf: 1, Seer: 1 },
    5: { Dorfbewohner: 2, Werwolf: 1, Seer: 1, Hexe: 1 },
    6: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1 },
    7: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1, Amor: 1 },
    8: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1, Amor: 1, Jäger: 1 },
  };

  function applyRoleSuggestion(count, { forceOverwrite = false } = {}) {
    const suggestion = roleSuggestions[count] || {};
    const suggestionSnapshot = buildSuggestionSnapshot(suggestion);
    const previousSuggestionSnapshot = lastSuggestionSnapshot;
    const currentSnapshot = getRoleLayoutSnapshot();
    const matchesLast = previousSuggestionSnapshot && snapshotsEqual(currentSnapshot, previousSuggestionSnapshot);

    if (matchesLast) {
      roleLayoutCustomized = false;
    }

    const shouldOverwrite = forceOverwrite || !roleLayoutCustomized;

    if (shouldOverwrite) {
      suppressCustomizationTracking = true;
      try {
        rolesContainerVillage.innerHTML = "";
        rolesContainerWerwolf.innerHTML = "";
        rolesContainerSpecial.innerHTML = "";

        categorizedRoles.village.forEach((role) => {
          addRoleRow(role, suggestion[role] || 0, rolesContainerVillage);
        });
        categorizedRoles.werwolf.forEach((role) => {
          addRoleRow(role, suggestion[role] || 0, rolesContainerWerwolf);
        });
        categorizedRoles.special.forEach((role) => {
          addRoleRow(role, suggestion[role] || 0, rolesContainerSpecial);
        });
      } finally {
        suppressCustomizationTracking = false;
      }

      lastSuggestionSnapshot = suggestionSnapshot;
      roleLayoutCustomized = false;
      return;
    }

    const mergeCategory = (categoryKey, rolesList, container) => {
      rolesList.forEach((roleName) => {
        const desiredQty = suggestion[roleName] || 0;
        const previousQty = previousSuggestionSnapshot && previousSuggestionSnapshot[categoryKey]
          ? previousSuggestionSnapshot[categoryKey][roleName]
          : undefined;
        const currentQty = currentSnapshot[categoryKey]
          ? currentSnapshot[categoryKey][roleName]
          : undefined;
        const row = findRoleRow(container, roleName);

        if (!row) {
          return;
        }

        if (typeof previousQty === 'number' && currentQty === previousQty) {
          setRowQuantity(row, desiredQty);
        }
      });
    };

    suppressCustomizationTracking = true;
    try {
      mergeCategory("village", categorizedRoles.village, rolesContainerVillage);
      mergeCategory("werwolf", categorizedRoles.werwolf, rolesContainerWerwolf);
      mergeCategory("special", categorizedRoles.special, rolesContainerSpecial);
    } finally {
      suppressCustomizationTracking = false;
    }

    lastSuggestionSnapshot = suggestionSnapshot;
  }

  playersTextarea.addEventListener("input", () => {
    if (isLoadingLastUsed) return;
    const count = playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length;
    const matchesDefaultLayout = layoutMatchesLastSuggestion();
    const forceOverwrite = matchesDefaultLayout || !roleLayoutCustomized;
    applyRoleSuggestion(count, { forceOverwrite });
  });

  // Initial role setup
  categorizedRoles.village.forEach(r => addRoleRow(r, 0, rolesContainerVillage));
  categorizedRoles.werwolf.forEach(r => addRoleRow(r, 0, rolesContainerWerwolf));
  categorizedRoles.special.forEach(r => addRoleRow(r, 0, rolesContainerSpecial));

  // Apply suggestion once on load (if players already entered)
  applyRoleSuggestion(
    playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length
  );

  // Save names to backend
  saveNamesBtn.addEventListener("click", async () => {
    const names = playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) {
      showInfoMessage({
        title: 'Speichern nicht möglich',
        text: 'Keine Namen zum Speichern.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Speichern der Namen fehlgeschlagen', detail: 'Es wurden keine Namen eingegeben.' }
      });
      return;
    }

    await withButtonLoading(saveNamesBtn, 'Speichere …', async () => {
      try {
        await apiClient.savedNames.set(names);
        showInfoMessage({
          title: 'Namen gespeichert',
          text: 'Alle Spielernamen wurden gesichert.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Namen gespeichert', detail: `${names.length} Namen abgelegt.` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Namen konnten nicht gesichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Speichern der Namen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Load names from backend
  loadNamesBtn.addEventListener("click", async () => {
    await withButtonLoading(loadNamesBtn, 'Lade …', async () => {
      try {
        const names = await apiClient.savedNames.get();
        if (!Array.isArray(names) || names.length === 0) {
          showInfoMessage({
            title: 'Keine gespeicherten Namen',
            text: 'Es wurden noch keine Namen gesichert.',
            confirmText: 'Okay',
            log: { type: 'info', label: 'Keine gespeicherten Namen', detail: 'Backend ohne gespeicherte Einträge.' }
          });
          return;
        }
        playersTextarea.value = names.join("\n");
        playersTextarea.dispatchEvent(new Event("input"));
      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der Namen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der Namen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Save roles to backend
  saveRolesBtn.addEventListener("click", async () => {
    const roleRows = [
        ...rolesContainerVillage.querySelectorAll(".role-row"),
        ...rolesContainerWerwolf.querySelectorAll(".role-row"),
        ...rolesContainerSpecial.querySelectorAll(".role-row")
    ];
    const roleSetup = [];
    roleRows.forEach((row) => {
      const roleName = row.querySelector("input[type='text']").value.trim();
      const qty = parseInt(row.querySelector(".qty-display").textContent, 10) || 0;
      if (roleName && qty > 0) {
        roleSetup.push({ name: roleName, quantity: qty });
      }
    });

    if (roleSetup.length === 0) {
      showInfoMessage({
        title: 'Speichern nicht möglich',
        text: 'Keine Rollen zum Speichern.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Speichern der Rollen fehlgeschlagen', detail: 'Keine Rollen mit Menge > 0 ausgewählt.' }
      });
      return;
    }
    await withButtonLoading(saveRolesBtn, 'Speichere …', async () => {
      try {
        await apiClient.rolePresets.set(roleSetup);
        showInfoMessage({
          title: 'Rollen gespeichert',
          text: 'Die aktuelle Rollenverteilung wurde gesichert.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Rollen gespeichert', detail: `${roleSetup.length} Rolleneinträge gespeichert.` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Rollen konnten nicht gesichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Speichern der Rollen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Load roles from backend
  loadRolesBtn.addEventListener("click", async () => {
    await withButtonLoading(loadRolesBtn, 'Lade …', async () => {
      try {
        const savedRoles = await apiClient.rolePresets.get();
        if (!Array.isArray(savedRoles) || savedRoles.length === 0) {
          showInfoMessage({
            title: 'Keine gespeicherten Rollen',
            text: 'Es wurden noch keine Rollen gesichert.',
            confirmText: 'Okay',
            log: { type: 'info', label: 'Keine gespeicherten Rollen', detail: 'Backend ohne Rollendaten.' }
          });
          return;
        }

      rolesContainerVillage.innerHTML = "";
      rolesContainerWerwolf.innerHTML = "";
      rolesContainerSpecial.innerHTML = "";

      // First, re-add all default roles with 0 quantity
      categorizedRoles.village.forEach(r => addRoleRow(r, 0, rolesContainerVillage));
      categorizedRoles.werwolf.forEach(r => addRoleRow(r, 0, rolesContainerWerwolf));
      categorizedRoles.special.forEach(r => addRoleRow(r, 0, rolesContainerSpecial));

      // Now, update quantities or add new rows for saved roles
      savedRoles.forEach(role => {
        let rowFound = false;
        const allRoleRows = document.querySelectorAll('.role-row');
        allRoleRows.forEach(row => {
            const input = row.querySelector('input[type="text"]');
            if (input.value === role.name) {
                row.querySelector('.qty-display').textContent = role.quantity;
                rowFound = true;
            }
        });

        if (!rowFound) {
            if (categorizedRoles.village.includes(role.name)) {
                addRoleRow(role.name, role.quantity, rolesContainerVillage);
            } else if (categorizedRoles.werwolf.includes(role.name)) {
                addRoleRow(role.name, role.quantity, rolesContainerWerwolf);
            } else {
                addRoleRow(role.name, role.quantity, rolesContainerSpecial);
            }
        }
      });

      lastSuggestionSnapshot = null;
      roleLayoutCustomized = true;

      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der Rollen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der Rollen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  loadLastUsedBtn.addEventListener("click", async () => {
    await withButtonLoading(loadLastUsedBtn, 'Lade …', async () => {
      const data = await refreshPersistedValue('werwolfLastUsed');
      if (!data) {
        showInfoMessage({
          title: 'Keine zuletzt benutzten Optionen',
          text: 'Es wurde noch kein Setup automatisch gesichert.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Keine zuletzt benutzten Optionen', detail: 'Noch kein automatischer Spielstand vorhanden.' }
        });
        return;
      }
      try {
        isLoadingLastUsed = true;
        const lastUsed = JSON.parse(data);
      playersTextarea.value = lastUsed.players.join("\n");

      rolesContainerVillage.innerHTML = "";
      rolesContainerWerwolf.innerHTML = "";
      rolesContainerSpecial.innerHTML = "";

      const allCategorizedRoles = [...categorizedRoles.village, ...categorizedRoles.werwolf, ...categorizedRoles.special];

      let legacyBodyguardRole = false;
      lastUsed.roles.forEach(role => {
        const qty = role.quantity || 0;
        const roleName = role.name === 'Bodyguard' ? 'Dorfbewohner' : role.name;
        if (role.name === 'Bodyguard') {
          legacyBodyguardRole = true;
        }
        if (categorizedRoles.village.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerVillage);
        } else if (categorizedRoles.werwolf.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerWerwolf);
        } else { // Special or custom roles
            addRoleRow(roleName, qty, rolesContainerSpecial);
        }
      });

      if (lastUsed.jobConfig && typeof lastUsed.jobConfig.bodyguardChance === 'number') {
        jobConfig.bodyguardChance = Math.min(Math.max(lastUsed.jobConfig.bodyguardChance, 0), 1);
        updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
      } else if (legacyBodyguardRole) {
        jobConfig.bodyguardChance = 1;
        updateBodyguardChanceUI(100, { save: true });
      }
      if (lastUsed.jobConfig && typeof lastUsed.jobConfig.doctorChance === 'number') {
        jobConfig.doctorChance = Math.min(Math.max(lastUsed.jobConfig.doctorChance, 0), 1);
        updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
      } else if (!lastUsed.jobConfig || typeof lastUsed.jobConfig.doctorChance !== 'number') {
        jobConfig.doctorChance = defaultJobConfig.doctorChance;
        updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
      }

      lastSuggestionSnapshot = null;
      roleLayoutCustomized = true;

      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der zuletzt benutzten Optionen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der zuletzt benutzten Optionen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      } finally {
        isLoadingLastUsed = false;
      }
    });
  });


  addRoleBtn.addEventListener("click", () => {
    addRoleRow("", 1, rolesContainerSpecial);
    markLayoutCustomized();
  });

  assignBtn.addEventListener("click", () => {
    const playersRaw = document.getElementById("players").value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean);

    if (playersRaw.length === 0) {
      showInfoMessage({
        title: 'Spieler erforderlich',
        text: 'Bitte mindestens einen Spielernamen eingeben.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Rollenzuteilung abgebrochen', detail: 'Keine Spielernamen eingegeben.' }
      });
      assignBtn.style.display = "inline-block";
      return;
    }

    let roles = [];
    const roleRows = [
        ...rolesContainerVillage.querySelectorAll(".role-row"),
        ...rolesContainerWerwolf.querySelectorAll(".role-row"),
        ...rolesContainerSpecial.querySelectorAll(".role-row")
    ];
    const roleSetup = [];
    roleRows.forEach((row) => {
      const roleName = row.querySelector("input[type='text']").value.trim();
      const qty = parseInt(row.querySelector(".qty-display").textContent, 10) || 0;
      roleSetup.push({ name: roleName, quantity: qty });
      for (let i = 0; i < qty; i++) {
        roles.push(roleName);
      }
    });

    const lastUsedOptions = {
      players: playersRaw,
      roles: roleSetup,
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      eventEngineState: getEventEngineSnapshot()
    };
    persistValue('werwolfLastUsed', JSON.stringify(lastUsedOptions));

    roles = roles.filter(Boolean);

    if (roles.length === 0) {
      showInfoMessage({
        title: 'Rollen erforderlich',
        text: 'Bitte mindestens eine Rolle und Menge > 0 eingeben.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Rollenzuteilung abgebrochen', detail: 'Keine Rollen ausgewählt.' }
      });
      assignBtn.style.display = "inline-block";
      return;
    }

    const finalizeAssignment = () => {
        // Shuffle roles
        shuffleArray(roles);

        // Map roles to players
        players = playersRaw;
        rolesAssigned = roles;
        jobsAssigned = players.map(() => []);
        currentIndex = 0;

        const legacyBodyguardIndices = [];
        rolesAssigned.forEach((role, index) => {
          if (role === 'Bodyguard') {
            legacyBodyguardIndices.push(index);
            rolesAssigned[index] = 'Dorfbewohner';
          }
        });
        if (legacyBodyguardIndices.length > 0) {
          assignBodyguardJobToIndex(legacyBodyguardIndices[0]);
        }

        // Reset and set up special roles
        henker = null;
        geschwister = [];
        geist.player = null;
        geist.messageSent = false;
        peaceDays = 0;
        jagerShotUsed = false;
        jagerDiedLastNight = null;
        bodyguardProtectionTarget = null;
        bodyguardProtectionNight = null;
        bodyguardSavedTarget = null;
        doctorPlayers = [];
        doctorPendingTargets = [];
        doctorPendingNight = null;
        doctorTriggerSourceNight = null;
        doctorLastHealedTarget = null;
        doctorLastHealedNight = null;
        firstNightShieldUsed = false;
        initializeMichaelJacksonAccusations();

        assignBodyguardJobByChance();
        assignDoctorJobByChance();

        const villageTeamRoles = ["Dorfbewohner", "Seer", "Jäger", "Hexe", "Stumme Jule", "Inquisitor", "Verfluchte", "Sündenbock", "Geschwister", "Geist", "Michael Jackson"];
        const villagersForHenkerTarget = [];

        players.forEach((p, i) => {
            if (villageTeamRoles.includes(rolesAssigned[i])) {
                villagersForHenkerTarget.push(p);
            }
            if (rolesAssigned[i] === 'Henker') {
                henker = { player: p, target: null };
            }
            if (rolesAssigned[i] === 'Geschwister') {
                geschwister.push(p);
            }
            if (rolesAssigned[i] === 'Geist') {
                geist.player = p;
            }
        });

        updateBodyguardPlayers();
        updateDoctorPlayers();

        // Assign a target to the Henker (must not be the Henker themselves)
        if (henker) {
          const possibleTargets = villagersForHenkerTarget.filter(p => p !== henker.player);
          if (possibleTargets.length > 0) {
            henker.target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
            console.log(`Henker is ${henker.player}, target is ${henker.target}`);
          } else {
            console.log("No valid target for Henker!");
          }
        }

        // Create and display reveal cards
        const revealGrid = document.getElementById('reveal-grid');
        revealGrid.innerHTML = ''; // Clear previous cards
        let currentlyFlippedCard = null;

        players.forEach((player, index) => {
          const card = document.createElement('div');
          card.className = 'reveal-card';
          card.style.animationDelay = `${index * 0.05}s`;
          card.onclick = () => {
            if (currentlyFlippedCard && currentlyFlippedCard !== card) {
              currentlyFlippedCard.classList.remove('flipped');
            }
            card.classList.toggle('flipped');
            currentlyFlippedCard = card.classList.contains('flipped') ? card : null;
          };

          const inner = document.createElement('div');
          inner.className = 'reveal-card-inner';

          const front = document.createElement('div');
          front.className = 'reveal-card-front';
          front.textContent = player;

          const back = document.createElement('div');
          back.className = 'reveal-card-back';
          const role = rolesAssigned[index];
          const jobs = getPlayerJobs(index);
          const roleNameEl = document.createElement('span');
          roleNameEl.className = 'role-name';
          if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
            roleNameEl.classList.add('long-text');
          }
          renderRoleWithJobs(roleNameEl, role, jobs);
          back.innerHTML = `<span class="player-name">${player}</span>`;
          back.prepend(roleNameEl);

          const infoBtn = document.createElement('button');
          infoBtn.className = 'info-btn';
          infoBtn.textContent = 'Info';
          infoBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card from flipping back
            showRoleInfo(role, { jobs });
          };
          back.appendChild(infoBtn);

          inner.appendChild(front);
          inner.appendChild(back);
          card.appendChild(inner);
          revealGrid.appendChild(card);
        });

        nightCounter = 0;
        gameCheckpoints.length = 0;
        captureGameCheckpoint('Spielstart: Rollen verteilt');

        // Add Henker's target to their card
        if (henker && henker.target) {
          const cards = revealGrid.querySelectorAll('.reveal-card');
          cards.forEach(card => {
            const playerNameOnCard = card.querySelector('.player-name').textContent;
            if (playerNameOnCard === henker.player) {
              const backOfCard = card.querySelector('.reveal-card-back');
              const targetEl = document.createElement('span');
              targetEl.className = 'henker-target';
              targetEl.innerHTML = `Dein Ziel ist: <strong>${henker.target}</strong>`;
              backOfCard.appendChild(targetEl);
            }
          });
        }

        // Save the session
        saveSession();

        // Hide setup and show results
        document.querySelector('.setup-container').style.display = 'none';
        assignBtn.style.display = 'none';
        loadLastUsedBtn.style.display = 'none';
        document.getElementById('ergebnisse-title').style.display = 'block';
        document.querySelector('.navigation-buttons').style.display = 'flex';
        showRolesOverviewBtn.style.display = 'inline-block';
        revealGrid.style.display = 'grid';
    };

    if (roles.length < playersRaw.length) {
      showConfirmation({
        title: 'Dorfbewohner auffüllen?',
        text: "Es gibt weniger Rollen als Spieler. Einige Spieler bekommen 'Dorfbewohner'. Fortfahren?",
        confirmText: 'Fortfahren',
        cancelText: 'Abbrechen',
        onConfirm: () => {
          while (roles.length < playersRaw.length) {
            roles.push('Dorfbewohner');
          }
          finalizeAssignment();
        },
        onCancel: () => {
          assignBtn.style.display = 'inline-block';
        },
        logOnConfirm: { type: 'info', label: 'Rollenzuteilung fortgesetzt', detail: 'Fehlende Plätze mit Dorfbewohnern aufgefüllt.' },
        logOnCancel: { type: 'info', label: 'Rollenzuteilung abgebrochen', detail: 'Zu wenige Rollen vorhanden.' }
      });
      return;
    }

    if (roles.length > playersRaw.length) {
      showConfirmation({
        title: 'Überschüssige Rollen ignorieren?',
        text: "Es gibt mehr Rollen als Spieler. Überschüssige Rollen werden ignoriert. Fortfahren?",
        confirmText: 'Fortfahren',
        cancelText: 'Abbrechen',
        onConfirm: () => {
          roles = roles.slice(0, playersRaw.length);
          finalizeAssignment();
        },
        onCancel: () => {
          assignBtn.style.display = 'inline-block';
        },
        logOnConfirm: { type: 'info', label: 'Rollenzuteilung fortgesetzt', detail: 'Überschüssige Rollen verworfen.' },
        logOnCancel: { type: 'info', label: 'Rollenzuteilung abgebrochen', detail: 'Zu viele Rollen ausgewählt.' }
      });
      return;
    }

    finalizeAssignment();
  });

  function updatePlayerCardVisuals() {
    const revealGrid = document.getElementById('reveal-grid');
    const cards = revealGrid.querySelectorAll('.reveal-card');
    cards.forEach(card => {
      const playerName = card.querySelector('.reveal-card-front').textContent;
      if (deadPlayers.includes(playerName)) {
        card.classList.add('dead');
      } else {
        card.classList.remove('dead');
      }
    });
    updateBodyguardPlayers();
  }

  function showRoleInfo(role, { jobs = [] } = {}) {
    const modal = document.getElementById('role-info-modal');
    const title = document.getElementById('role-info-title');
    const desc = document.getElementById('role-info-desc');

    const normalizedRole = role || 'Unbekannte Rolle';
    const jobListRaw = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const jobDisplayList = jobListRaw.map(getJobDisplayName).filter(Boolean);
    const titleText = jobDisplayList.length
      ? `${normalizedRole} (${jobDisplayList.join(' + ')})`
      : normalizedRole;

    title.textContent = titleText;

    const baseDescription = roleDescriptions[normalizedRole] || roleDescriptions[role] || "Keine Beschreibung für diese Rolle verfügbar.";
    const jobTextSnippets = jobListRaw
      .map(job => {
        const description = jobDescriptions[job];
        const label = getJobDisplayName(job);
        if (!label) {
          return '';
        }
        const modifier = getJobClassModifier(job);
        const badgeClass = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
        const badgeHtml = `<span class="${badgeClass}">${label}</span>`;
        return description
          ? `${badgeHtml}<span class="job-description-text">${description}</span>`
          : badgeHtml;
      })
      .filter(Boolean);

    if (jobTextSnippets.length > 0) {
      const jobHtml = jobTextSnippets
        .map(text => `<span class="job-description">${text}</span>`)
        .join('');
      desc.innerHTML = `${baseDescription}<br><br><strong>Jobs:</strong><br>${jobHtml}`;
    } else {
      desc.textContent = baseDescription;
    }

    modal.style.display = 'flex';
  }

  // Close role info modal
  const roleInfoModal = document.getElementById('role-info-modal');
  const closeRoleInfoBtn = roleInfoModal.querySelector('.close-modal');

  closeRoleInfoBtn.addEventListener('click', () => {
    roleInfoModal.style.display = 'none';
  });

  // Close other modals
  const rolesOverviewModal = document.getElementById('roles-overview-modal');
  const rolesOverviewContent = document.getElementById('roles-overview-content');
  const closeRolesOverviewBtn = rolesOverviewModal.querySelector('.close-modal');

  closeRolesOverviewBtn.addEventListener('click', () => {
    rolesOverviewModal.style.display = 'none';
  });

  window.addEventListener('click', (event) => {
    if (event.target === seerVisionModal) {
      closeSeerModalAndProceed();
    }
    if (event.target === roleInfoModal) {
      roleInfoModal.style.display = 'none';
    }
    if (event.target === rolesOverviewModal) {
      rolesOverviewModal.style.display = 'none';
    }
  });

  // Fisher-Yates shuffle
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function syncJobChanceInputs() {
    updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: false });
    updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: false });
  }

  finishBtn.addEventListener("click", () => {
    // Show setup and hide results
    document.querySelector('.container').classList.remove('hidden');
    document.querySelector('.setup-container').style.display = 'grid';
    assignBtn.style.display = 'inline-block';
    loadLastUsedBtn.style.display = 'inline-block';
    document.getElementById('ergebnisse-title').style.display = 'none';
    document.querySelector('.navigation-buttons').style.display = 'none';
    document.getElementById('reveal-grid').style.display = 'none';
    showRolesOverviewBtn.style.display = 'none';
    firstNightShieldUsed = false;
    syncJobChanceInputs();
    renderNarratorDashboard();
  });

  // Session Management
  async function saveSession() {
    const roleCounts = rolesAssigned.reduce((acc, role) => {
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});

    const session = {
      timestamp: Date.now(),
      players: players,
      roles: Object.entries(roleCounts).map(([name, quantity]) => ({ name, quantity })),
      rolesAssigned: rolesAssigned,
      deadPlayers: deadPlayers,
      lovers: lovers,
      silencedPlayer: silencedPlayer,
      healRemaining: healRemaining,
      poisonRemaining: poisonRemaining,
      bloodMoonActive: bloodMoonActive,
      phoenixPulsePending,
      phoenixPulseJustResolved,
      phoenixPulseRevivedPlayers: phoenixPulseRevivedPlayers.slice(),
      firstNightShieldUsed,
      dayCount: dayCount,
      mayor: mayor,
      accused: accused.slice(),
      nightMode: nightMode,
      dayMode: dayMode,
      nightSteps: nightSteps,
      nightIndex: nightIndex,
      nightCounter: nightCounter,
      michaelJacksonAccusations: Object.entries(michaelJacksonAccusations).reduce((acc, [player, data]) => {
        const rawDays = Array.isArray(data?.daysAccused) ? data.daysAccused : [];
        const days = Array.from(new Set(rawDays
          .map(day => (typeof day === 'number' ? day : Number(day)))
          .filter(day => Number.isFinite(day))));
        const hasSpotlight = typeof data?.hasSpotlight === 'boolean' ? data.hasSpotlight : days.length > 0;
        const accusationCount = typeof data?.accusationCount === 'number' && Number.isFinite(data.accusationCount)
          ? data.accusationCount
          : days.length;
        const lastAccusationDay = typeof data?.lastAccusationDay === 'number' && Number.isFinite(data.lastAccusationDay)
          ? data.lastAccusationDay
          : days.length > 0
            ? Math.max(...days)
            : null;

        acc[player] = {
          daysAccused: days,
          hasSpotlight,
          accusationCount,
          lastAccusationDay
        };
        return acc;
      }, {}),
      bodyguardPlayers: bodyguardPlayers.slice(),
      bodyguardProtectionTarget,
      bodyguardProtectionNight,
      bodyguardSavedTarget,
      doctorPlayers: doctorPlayers.slice(),
      doctorPendingTargets: doctorPendingTargets.slice(),
      doctorPendingNight,
      doctorTriggerSourceNight,
      doctorLastHealedTarget,
      doctorLastHealedNight,
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance }
    };

    await apiClient.sessions.create(session);
    await loadSessions();
    return session;
  }

  async function loadSessions() {
    sessionsList.innerHTML = '';
    let sessions = [];
    try {
      sessions = await apiClient.sessions.list();
    } catch (error) {
      sessionsList.innerHTML = '<li>Sessions konnten nicht geladen werden.</li>';
      console.error('Sessions konnten nicht geladen werden.', error);
      return [];
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      sessionsList.innerHTML = '<li>Keine gespeicherten Sessions.</li>';
      return [];
    }

    sessionsList.innerHTML = '';

    sessions.forEach(session => {
      const li = document.createElement('li');
      const date = new Date(session.timestamp).toLocaleString('de-DE');
      const playerNames = session.players.join(', ');

      li.innerHTML = `
        <div class="session-date">${date}</div>
        <div class="session-players">${playerNames}</div>
        <button class="delete-session-btn" data-timestamp="${session.timestamp}">&times;</button>
      `;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-session-btn')) return;
        applySession(session);
        sessionsSidebar.classList.remove('show');
        document.body.classList.remove('sidebar-open');
      });

      sessionsList.appendChild(li);
    });

    // Add delete functionality
    document.querySelectorAll('.delete-session-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const timestamp = Number(e.target.dataset.timestamp);
        if (!Number.isFinite(timestamp)) {
          return;
        }
        deleteSession(timestamp);
      });
    });

    return sessions;
  }

  async function deleteSession(timestamp) {
    try {
      await apiClient.sessions.remove(timestamp);
      await loadSessions();
    } catch (error) {
      showInfoMessage({
        title: 'Löschen fehlgeschlagen',
        text: 'Die Session konnte nicht entfernt werden.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Session löschen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
      });
    }
  }

  function applySession(session) {
    players = Array.isArray(session.players) ? session.players.slice() : [];
    rolesAssigned = Array.isArray(session.rolesAssigned) ? session.rolesAssigned.slice() : [];
    jobsAssigned = Array.isArray(session.jobsAssigned)
      ? session.jobsAssigned.map(entry => Array.isArray(entry) ? entry.slice() : [])
      : players.map(() => []);

    ensureJobsStructure();

    const legacyBodyguardIndices = [];
    rolesAssigned.forEach((role, index) => {
      if (role === 'Bodyguard') {
        legacyBodyguardIndices.push(index);
        rolesAssigned[index] = 'Dorfbewohner';
      }
    });
    if (legacyBodyguardIndices.length > 0) {
      assignBodyguardJobToIndex(legacyBodyguardIndices[0]);
    }

    if (Array.isArray(session.bodyguardPlayers) && session.bodyguardPlayers.length > 0) {
      session.bodyguardPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignBodyguardJobToIndex(idx);
        }
      });
    }

    if (Array.isArray(session.doctorPlayers) && session.doctorPlayers.length > 0) {
      session.doctorPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignDoctorJobToIndex(idx);
        }
      });
    }

    if (session.jobConfig && typeof session.jobConfig.bodyguardChance === 'number') {
      jobConfig.bodyguardChance = Math.min(Math.max(session.jobConfig.bodyguardChance, 0), 1);
      updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
    }
    if (session.jobConfig && typeof session.jobConfig.doctorChance === 'number') {
      jobConfig.doctorChance = Math.min(Math.max(session.jobConfig.doctorChance, 0), 1);
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    if (!session.jobConfig || typeof session.jobConfig.doctorChance !== 'number') {
      jobConfig.doctorChance = defaultJobConfig.doctorChance;
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    deadPlayers = session.deadPlayers || [];
    lovers = session.lovers || [];
    silencedPlayer = session.silencedPlayer || null;
    healRemaining = session.healRemaining !== undefined ? session.healRemaining : 1;
    poisonRemaining = session.poisonRemaining !== undefined ? session.poisonRemaining : 1;
    setBloodMoonState(!!session.bloodMoonActive);
    phoenixPulsePending = !!session.phoenixPulsePending;
    phoenixPulseJustResolved = !!session.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(session.phoenixPulseRevivedPlayers)
      ? session.phoenixPulseRevivedPlayers.slice()
      : [];
    if (typeof session.firstNightShieldUsed === 'boolean') {
      firstNightShieldUsed = session.firstNightShieldUsed;
    } else {
      const legacyNightCounter = Number.isFinite(session.nightCounter) ? session.nightCounter : 0;
      const legacyNightMode = !!session.nightMode;
      const legacyDayCount = Number.isFinite(session.dayCount) ? session.dayCount : 0;
      const nightFinished = legacyNightCounter > 1 || (legacyNightCounter === 1 && !legacyNightMode);
      firstNightShieldUsed = nightFinished || legacyDayCount > 0;
    }
    setPhoenixPulseCharged(phoenixPulsePending);
    updatePhoenixPulseStatus();
    dayCount = session.dayCount || 0;
    mayor = session.mayor || null;
    accused = Array.isArray(session.accused) ? session.accused.slice() : [];
    nightMode = session.nightMode || false;
    dayMode = session.dayMode || false;
    nightSteps = session.nightSteps || [];
    nightIndex = session.nightIndex || 0;
    nightCounter = session.nightCounter || 0;
    initializeMichaelJacksonAccusations(session.michaelJacksonAccusations || {});
    updateBodyguardPlayers();
    doctorPendingTargets = Array.isArray(session.doctorPendingTargets)
      ? session.doctorPendingTargets.slice()
      : [];
    doctorPendingNight = Number.isFinite(session.doctorPendingNight)
      ? session.doctorPendingNight
      : null;
    doctorTriggerSourceNight = Number.isFinite(session.doctorTriggerSourceNight)
      ? session.doctorTriggerSourceNight
      : null;
    doctorLastHealedTarget = session.doctorLastHealedTarget || null;
    doctorLastHealedNight = Number.isFinite(session.doctorLastHealedNight)
      ? session.doctorLastHealedNight
      : null;
    updateDoctorPlayers();
    if (session.eventEngineState) {
      restoreEventEngineState(session.eventEngineState);
    } else {
      persistEventEngineState();
    }
    bodyguardProtectionTarget = session.bodyguardProtectionTarget || null;
    bodyguardProtectionNight = Number.isFinite(session.bodyguardProtectionNight)
      ? session.bodyguardProtectionNight
      : null;
    bodyguardSavedTarget = session.bodyguardSavedTarget || null;
    dayAnnouncements = [];
    currentDayAdditionalParagraphs = [];
    dayIntroHtml = '';

    phaseTimerManager.cancelAll();
    gameCheckpoints.length = 0;
    captureGameCheckpoint('Session geladen');

    playersTextarea.value = session.players.join('\n');

    const roleCounts = {};
    session.roles.forEach(r => {
        const name = r.name === 'Bodyguard' ? 'Dorfbewohner' : r.name;
        roleCounts[name] = (roleCounts[name] || 0) + r.quantity;
    });

    rolesContainerVillage.innerHTML = "";
    rolesContainerWerwolf.innerHTML = "";
    rolesContainerSpecial.innerHTML = "";

    categorizedRoles.village.forEach(role => {
        addRoleRow(role, roleCounts[role] || 0, rolesContainerVillage);
    });
    categorizedRoles.werwolf.forEach(role => {
        addRoleRow(role, roleCounts[role] || 0, rolesContainerWerwolf);
    });
    categorizedRoles.special.forEach(role => {
        addRoleRow(role, roleCounts[role] || 0, rolesContainerSpecial);
    });

    lastSuggestionSnapshot = null;
    roleLayoutCustomized = true;

    // Hide setup and show results
    document.querySelector('.setup-container').style.display = 'none';
    assignBtn.style.display = 'none';
    loadLastUsedBtn.style.display = 'none';
    document.getElementById('ergebnisse-title').style.display = 'block';
    document.querySelector('.navigation-buttons').style.display = 'flex';
    document.getElementById('reveal-grid').style.display = 'grid';

    // Create and display reveal cards
    const revealGrid = document.getElementById('reveal-grid');
    revealGrid.innerHTML = ''; // Clear previous cards
    let currentlyFlippedCard = null;
    
    players.forEach((player, index) => {
      const card = document.createElement('div');
      card.className = 'reveal-card';
      card.style.animationDelay = `${index * 0.05}s`;
      if (deadPlayers.includes(player)) {
        card.classList.add('dead');
      }
      card.onclick = () => {
        if (currentlyFlippedCard && currentlyFlippedCard !== card) {
          currentlyFlippedCard.classList.remove('flipped');
        }
        card.classList.toggle('flipped');
        currentlyFlippedCard = card.classList.contains('flipped') ? card : null;
      };
      
      const inner = document.createElement('div');
      inner.className = 'reveal-card-inner';
      
      const front = document.createElement('div');
      front.className = 'reveal-card-front';
      front.textContent = player;
      
      const back = document.createElement('div');
      back.className = 'reveal-card-back';
      const role = rolesAssigned[index];
      const jobs = getPlayerJobs(index);
      const roleNameEl = document.createElement('span');
      roleNameEl.className = 'role-name';
      if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
        roleNameEl.classList.add('long-text');
      }
      renderRoleWithJobs(roleNameEl, role, jobs);
      back.innerHTML = `<span class="player-name">${player}</span>`;
      back.prepend(roleNameEl);
      
      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent card from flipping back
        showRoleInfo(role, { jobs });
      };
      back.appendChild(infoBtn);

      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);
      revealGrid.appendChild(card);
    });


    if (nightMode) {
      nightOverlay.style.display = 'flex';
      showNightStep();
    } else if (dayMode) {
      dayOverlay.style.display = 'flex';
      if (dayCount === 1 && !mayor) {
        electMayor();
      } else {
        startNormalDayPhase();
      }
    }
  }

  // Admin Panel
  const adminPanel = document.getElementById('admin-panel');
  const triggerBloodMoonBtn = document.getElementById('trigger-blood-moon-btn');
  const adminPanelToggle = document.getElementById('admin-panel-toggle');
  const closeAdminPanelBtn = document.getElementById('close-admin-panel-btn');
  const showRolesOverviewBtn = document.getElementById('show-roles-overview-btn');

  const adminKillPlayerSelect = document.getElementById('admin-kill-player-select');
  const adminKillPlayerBtn = document.getElementById('admin-kill-player-btn');
  const adminRevivePlayerSelect = document.getElementById('admin-revive-player-select');
  const adminRevivePlayerBtn = document.getElementById('admin-revive-player-btn');
  const adminChangeRolePlayerSelect = document.getElementById('admin-change-role-player-select');
  const adminChangeRoleRoleSelect = document.getElementById('admin-change-role-role-select');
  const adminChangeRoleBtn = document.getElementById('admin-change-role-btn');

  const adminTimelineList = document.getElementById('admin-timeline');
  const undoHistoryList = document.getElementById('admin-undo-history');
  const adminUndoBtn = document.getElementById('admin-undo-btn');
  const adminRedoBtn = document.getElementById('admin-redo-btn');
  const macroSelect = document.getElementById('admin-macro-select');
  const macroRunBtn = document.getElementById('admin-run-macro-btn');
  const macroDescriptionEl = document.getElementById('admin-macro-description');
  const defaultMacroDescription = macroDescriptionEl ? macroDescriptionEl.textContent : '';

  const narratorDashboard = document.getElementById('narrator-dashboard');
  const dashboardPhaseEl = document.getElementById('dashboard-phase');
  const dashboardTeamCountsEl = document.getElementById('dashboard-team-counts');
  const dashboardRoleCountsEl = document.getElementById('dashboard-role-counts');
  const dashboardMayorEl = document.getElementById('dashboard-mayor');
  const dashboardSpotlightEl = document.getElementById('dashboard-spotlights');
  const dashboardSilencedEl = document.getElementById('dashboard-silenced');
  const dashboardEventsEl = document.getElementById('dashboard-events');

  const pauseTimersBtn = document.getElementById('admin-pause-timers-btn');
  const skipStepBtn = document.getElementById('admin-skip-step-btn');
  const stepBackBtn = document.getElementById('admin-step-back-btn');
  const rollbackCheckpointBtn = document.getElementById('admin-rollback-checkpoint-btn');
  const defaultStepBackText = stepBackBtn ? stepBackBtn.textContent : 'Zum vorherigen Schritt';

  const sandboxSelect = document.getElementById('sandbox-elimination-select');
  const sandboxSimulateBtn = document.getElementById('sandbox-simulate-btn');
  const sandboxResultEl = document.getElementById('sandbox-result');

  function getLivingPlayers() {
    return players.filter(player => !deadPlayers.includes(player));
  }

  function getLivingRoleData() {
    const data = [];
    players.forEach((player, index) => {
      if (!deadPlayers.includes(player)) {
        const jobs = getPlayerJobs(index);
        data.push({ player, role: rolesAssigned[index], jobs: Array.isArray(jobs) ? jobs.slice() : [] });
      }
    });
    return data;
  }

  function getPlayerRoleName(playerName) {
    const index = players.indexOf(playerName);
    return index >= 0 ? rolesAssigned[index] : null;
  }

  function getTeamKey(roleName) {
    if (!roleName) return 'special';
    if (categorizedRoles.werwolf.includes(roleName)) return 'werwolf';
    if (categorizedRoles.village.includes(roleName)) return 'village';
    return 'special';
  }

  function buildTeamCounts(livingPlayers = getLivingPlayers()) {
    return livingPlayers.reduce((acc, player) => {
      const roleName = getPlayerRoleName(player);
      const team = getTeamKey(roleName);
      acc[team] = (acc[team] || 0) + 1;
      return acc;
    }, { village: 0, werwolf: 0, special: 0 });
  }

  function getRoleCounts(livingData) {
    return livingData.reduce((acc, { role, jobs }) => {
      if (role) {
        acc[role] = (acc[role] || 0) + 1;
      }
      if (Array.isArray(jobs)) {
        jobs.forEach(job => {
          const key = `${job} (Job)`;
          acc[key] = (acc[key] || 0) + 1;
        });
      }
      return acc;
    }, {});
  }

  function getSpotlightPlayers() {
    return Object.entries(michaelJacksonAccusations || {})
      .filter(([player, data]) => data && data.hasSpotlight && !deadPlayers.includes(player))
      .map(([player]) => player);
  }

  function formatMillisecondsToSeconds(ms) {
    if (!Number.isFinite(ms)) return '0s';
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
    }
    return `${Math.max(0, Math.round(ms))}ms`;
  }

  function renderNarratorDashboard() {
    if (!dashboardPhaseEl) {
      return;
    }

    const livingData = getLivingRoleData();
    const livingPlayers = livingData.map(entry => entry.player);
    const teamCounts = buildTeamCounts(livingPlayers);

    if (dashboardTeamCountsEl) {
      dashboardTeamCountsEl.textContent = `Dorfbewohner: ${teamCounts.village} | Werwölfe: ${teamCounts.werwolf} | Sonderrollen: ${teamCounts.special}`;
    }

    if (dashboardPhaseEl) {
      let phaseText = 'Setup';
      if (nightMode) {
        const currentRole = nightSteps[nightIndex] || 'Nachtende';
        const label = nightCounter > 0 ? nightCounter : Math.max(1, dayCount + (nightMode ? 1 : 0));
        phaseText = `Nacht ${label} – ${currentRole}`;
      } else if (dayMode) {
        const label = Math.max(dayCount, 1);
        phaseText = `Tag ${label}`;
      } else if (players.length > 0) {
        phaseText = nightCounter > 0 || dayCount > 0 ? 'Zwischenphase' : 'Bereit';
      }
      dashboardPhaseEl.textContent = phaseText;
    }

    if (dashboardRoleCountsEl) {
      dashboardRoleCountsEl.innerHTML = '';
      const roleCounts = getRoleCounts(livingData);
      const entries = Object.entries(roleCounts).sort((a, b) => {
        if (b[1] === a[1]) {
          return a[0].localeCompare(b[0], 'de');
        }
        return b[1] - a[1];
      });
      if (entries.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Keine aktiven Rollen';
        dashboardRoleCountsEl.appendChild(li);
      } else {
        entries.forEach(([role, count]) => {
          const li = document.createElement('li');
          li.textContent = `${role}: ${count}`;
          dashboardRoleCountsEl.appendChild(li);
        });
      }
    }

    if (dashboardMayorEl) {
      if (mayor) {
        const mayorStatus = deadPlayers.includes(mayor) ? `${mayor} (tot)` : mayor;
        dashboardMayorEl.textContent = `Bürgermeister: ${mayorStatus}`;
      } else {
        dashboardMayorEl.textContent = 'Bürgermeister: –';
      }
    }

    if (dashboardSpotlightEl) {
      const spotlightPlayers = getSpotlightPlayers();
      dashboardSpotlightEl.textContent = spotlightPlayers.length
        ? `Spotlight: ${spotlightPlayers.join(', ')}`
        : 'Spotlight: –';
    }

    if (dashboardSilencedEl) {
      if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
        dashboardSilencedEl.textContent = `Stumm: ${silencedPlayer}`;
      } else {
        dashboardSilencedEl.textContent = 'Stumm: –';
      }
    }

    if (dashboardEventsEl) {
      dashboardEventsEl.innerHTML = '';
      const events = [];
      const timers = phaseTimerManager.list();
      if (phaseTimerManager.isPaused()) {
        events.push('Timer pausiert');
      }
      timers.forEach(timer => {
        events.push(`Timer: ${timer.label} (${formatMillisecondsToSeconds(timer.remaining)})`);
      });
      if (bloodMoonActive) {
        events.push('Blutmond aktiv');
      }
      if (phoenixPulsePending) {
        events.push('Phoenix Pulse geladen');
      }
      if (phoenixPulseJustResolved && phoenixPulseRevivedPlayers.length > 0) {
        events.push(`Phoenix Pulse: ${phoenixPulseRevivedPlayers.join(', ')} wiederbelebt`);
      }
      if (isBodyguardProtectionActive()) {
        events.push(`Bodyguard schützt: ${bodyguardProtectionTarget}`);
      }
      if (bodyguardSavedTarget) {
        events.push(`Bodyguard Rettung: ${bodyguardSavedTarget}`);
      }
      if (doctorPendingNight !== null && doctorPlayers.length > 0) {
        const availableDoctorTargets = getDoctorAvailableTargets();
        if (availableDoctorTargets.length > 0) {
          events.push(`Arzt vorbereitet (Nacht ${doctorPendingNight}): ${availableDoctorTargets.join(', ')}`);
        }
      }
      if (doctorLastHealedTarget && doctorLastHealedNight === nightCounter) {
        events.push(`Arzt Heilung: ${doctorLastHealedTarget}`);
      }
      if (currentNightVictims.length > 0) {
        events.push(`Ausstehende Nachtopfer: ${currentNightVictims.join(', ')}`);
      }
      if (jagerDiedLastNight) {
        events.push(`Jäger-Revanche offen: ${jagerDiedLastNight}`);
      }
      if (gameCheckpoints.length > 0) {
        const lastCheckpoint = gameCheckpoints[gameCheckpoints.length - 1];
        const timeLabel = lastCheckpoint.timestamp
          ? new Date(lastCheckpoint.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '';
        events.push(`Letzter Checkpoint: ${lastCheckpoint.label}${timeLabel ? ` (${timeLabel})` : ''}`);
      }
      const schedulerSnapshot = eventScheduler.getState();
      schedulerSnapshot.activeModifiers.forEach(modifier => {
        events.push(`Modifikator: ${modifier.label}`);
      });
      schedulerSnapshot.queuedEffects.forEach(entry => {
        const nightLabel = entry.night ? ` (Nacht ${entry.night})` : '';
        events.push(`Geplant: ${entry.label}${nightLabel}`);
      });
      if (events.length === 0) {
        events.push('Keine offenen Ereignisse');
      }
      events.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        dashboardEventsEl.appendChild(li);
      });
    }

    if (pauseTimersBtn) {
      const timers = phaseTimerManager.list();
      const hasTimers = timers.length > 0;
      pauseTimersBtn.textContent = phaseTimerManager.isPaused()
        ? 'Phase-Timer fortsetzen'
        : 'Phase-Timer pausieren';
      pauseTimersBtn.disabled = !hasTimers && !phaseTimerManager.isPaused();
    }

    if (skipStepBtn) {
      skipStepBtn.disabled = !(nightMode || dayMode);
    }

    if (stepBackBtn) {
      if (nightMode && nightStepHistory.length > 1) {
        const previousEntry = nightStepHistory[nightStepHistory.length - 2];
        const targetLabel = previousEntry && previousEntry.role
          ? previousEntry.role
          : 'vorherigen Schritt';
        stepBackBtn.disabled = false;
        stepBackBtn.textContent = `Zurück zu ${targetLabel}`;
      } else {
        stepBackBtn.disabled = true;
        stepBackBtn.textContent = defaultStepBackText;
      }
    }

    if (rollbackCheckpointBtn) {
      rollbackCheckpointBtn.disabled = gameCheckpoints.length === 0;
    }

    if (sandboxSelect) {
      const selectedValues = new Set(Array.from(sandboxSelect.selectedOptions).map(opt => opt.value));
      sandboxSelect.innerHTML = '';
      livingPlayers.forEach(player => {
        const option = document.createElement('option');
        option.value = player;
        option.textContent = player;
        if (selectedValues.has(player)) {
          option.selected = true;
        }
        sandboxSelect.appendChild(option);
      });
      if (sandboxResultEl && sandboxSelect.selectedOptions.length === 0) {
        sandboxResultEl.textContent = '';
      }
    }
  }

  phaseTimerManager.setOnChange(renderNarratorDashboard);

  function createStateSnapshot() {
    return {
      players: players.slice(),
      rolesAssigned: rolesAssigned.slice(),
      deadPlayers: deadPlayers.slice(),
      lovers: lovers.map(pair => pair.slice()),
      silencedPlayer,
      healRemaining,
      poisonRemaining,
      bloodMoonActive,
      phoenixPulsePending,
      phoenixPulseJustResolved,
      phoenixPulseRevivedPlayers: phoenixPulseRevivedPlayers.slice(),
      dayCount,
      mayor,
      accused: accused.slice(),
      nightMode,
      dayMode,
      nightSteps: nightSteps.slice(),
      nightIndex,
      currentNightVictims: currentNightVictims.slice(),
      michaelJacksonAccusations: JSON.parse(JSON.stringify(michaelJacksonAccusations || {})),
      henker: henker ? { ...henker } : null,
      geschwister: geschwister.slice(),
      geist: geist ? { ...geist } : { player: null, messageSent: false },
      peaceDays,
      jagerShotUsed,
      jagerDiedLastNight,
      nightCounter,
      bodyguardPlayers: bodyguardPlayers.slice(),
      bodyguardProtectionTarget,
      bodyguardProtectionNight,
      bodyguardSavedTarget,
      doctorPlayers: doctorPlayers.slice(),
      doctorPendingTargets: doctorPendingTargets.slice(),
      doctorPendingNight,
      doctorTriggerSourceNight,
      doctorLastHealedTarget,
      doctorLastHealedNight,
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      firstNightShieldUsed,
      eventEngineState: getEventEngineSnapshot()
    };
  }

  function captureGameCheckpoint(label) {
    if (isRestoringCheckpoint) return;
    const snapshot = {
      label,
      timestamp: Date.now(),
      state: createStateSnapshot()
    };
    gameCheckpoints.push(snapshot);
    if (gameCheckpoints.length > 20) {
      gameCheckpoints.shift();
    }
    renderNarratorDashboard();
  }

  function applyStateSnapshot(snapshot, { resetNightHistory = true } = {}) {
    if (resetNightHistory) {
      nightStepHistory = [];
    }

    players = snapshot.players.slice();
    rolesAssigned = snapshot.rolesAssigned.slice();
    jobsAssigned = Array.isArray(snapshot.jobsAssigned)
      ? snapshot.jobsAssigned.map(entry => Array.isArray(entry) ? entry.slice() : [])
      : players.map(() => []);

    ensureJobsStructure();

    const legacyBodyguards = [];
    rolesAssigned.forEach((role, index) => {
      if (role === 'Bodyguard') {
        legacyBodyguards.push(index);
        rolesAssigned[index] = 'Dorfbewohner';
      }
    });
    if (legacyBodyguards.length > 0) {
      assignBodyguardJobToIndex(legacyBodyguards[0]);
    }

    if (Array.isArray(snapshot.bodyguardPlayers) && snapshot.bodyguardPlayers.length > 0) {
      snapshot.bodyguardPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignBodyguardJobToIndex(idx);
        }
      });
    }

    if (snapshot.jobConfig && typeof snapshot.jobConfig.bodyguardChance === 'number') {
      jobConfig.bodyguardChance = Math.min(Math.max(snapshot.jobConfig.bodyguardChance, 0), 1);
      updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
    }
    if (Array.isArray(snapshot.doctorPlayers) && snapshot.doctorPlayers.length > 0) {
      snapshot.doctorPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignDoctorJobToIndex(idx);
        }
      });
    }
    if (snapshot.jobConfig && typeof snapshot.jobConfig.doctorChance === 'number') {
      jobConfig.doctorChance = Math.min(Math.max(snapshot.jobConfig.doctorChance, 0), 1);
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    if (!snapshot.jobConfig || typeof snapshot.jobConfig.doctorChance !== 'number') {
      jobConfig.doctorChance = defaultJobConfig.doctorChance;
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    deadPlayers = snapshot.deadPlayers.slice();
    lovers = snapshot.lovers.map(pair => pair.slice());
    silencedPlayer = snapshot.silencedPlayer;
    healRemaining = snapshot.healRemaining;
    poisonRemaining = snapshot.poisonRemaining;
    setBloodMoonState(!!snapshot.bloodMoonActive);
    phoenixPulsePending = !!snapshot.phoenixPulsePending;
    phoenixPulseJustResolved = !!snapshot.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(snapshot.phoenixPulseRevivedPlayers)
      ? snapshot.phoenixPulseRevivedPlayers.slice()
      : [];
    if (typeof snapshot.firstNightShieldUsed === 'boolean') {
      firstNightShieldUsed = snapshot.firstNightShieldUsed;
    } else {
      const snapshotNightCounter = Number.isFinite(snapshot.nightCounter) ? snapshot.nightCounter : 0;
      const snapshotDayCount = Number.isFinite(snapshot.dayCount) ? snapshot.dayCount : 0;
      const nightFinished = snapshotNightCounter > 1 || (snapshotNightCounter === 1 && !snapshot.nightMode);
      firstNightShieldUsed = nightFinished || snapshotDayCount > 0;
    }
    setPhoenixPulseCharged(phoenixPulsePending);
    updatePhoenixPulseStatus();
    dayCount = snapshot.dayCount;
    mayor = snapshot.mayor;
    accused = snapshot.accused.slice();
    nightMode = snapshot.nightMode;
    dayMode = snapshot.dayMode;
    nightSteps = snapshot.nightSteps.slice();
    nightIndex = snapshot.nightIndex;
    currentNightVictims = snapshot.currentNightVictims.slice();
    michaelJacksonAccusations = JSON.parse(JSON.stringify(snapshot.michaelJacksonAccusations || {}));
    henker = snapshot.henker ? { ...snapshot.henker } : null;
    geschwister = snapshot.geschwister.slice();
    geist = snapshot.geist ? { ...snapshot.geist } : { player: null, messageSent: false };
    peaceDays = typeof snapshot.peaceDays === 'number' ? snapshot.peaceDays : 0;
    jagerShotUsed = !!snapshot.jagerShotUsed;
    jagerDiedLastNight = snapshot.jagerDiedLastNight || null;
    nightCounter = snapshot.nightCounter || 0;
    updateBodyguardPlayers();
    doctorPendingTargets = Array.isArray(snapshot.doctorPendingTargets)
      ? snapshot.doctorPendingTargets.slice()
      : [];
    doctorPendingNight = Number.isFinite(snapshot.doctorPendingNight)
      ? snapshot.doctorPendingNight
      : null;
    doctorTriggerSourceNight = Number.isFinite(snapshot.doctorTriggerSourceNight)
      ? snapshot.doctorTriggerSourceNight
      : null;
    doctorLastHealedTarget = snapshot.doctorLastHealedTarget || null;
    doctorLastHealedNight = Number.isFinite(snapshot.doctorLastHealedNight)
      ? snapshot.doctorLastHealedNight
      : null;
    updateDoctorPlayers();
    if (snapshot.eventEngineState) {
      restoreEventEngineState(snapshot.eventEngineState);
    } else {
      persistEventEngineState();
    }
    bodyguardProtectionTarget = snapshot.bodyguardProtectionTarget || null;
    bodyguardProtectionNight = Number.isFinite(snapshot.bodyguardProtectionNight)
      ? snapshot.bodyguardProtectionNight
      : null;
    bodyguardSavedTarget = snapshot.bodyguardSavedTarget || null;

    updatePlayerCardVisuals();
    populateAdminKillSelect();
    populateAdminReviveSelect();
    populateAdminChangeRoleSelects();
    syncBloodMoonUI({ silent: true });

    if (nightMode) {
      nightOverlay.style.display = 'flex';
      showNightStep();
    } else {
      nightOverlay.style.display = 'none';
    }

    if (dayMode) {
      dayOverlay.style.display = 'flex';
      if (dayCount === 1 && !mayor) {
        electMayor();
      } else {
        startNormalDayPhase();
      }
    } else {
      dayOverlay.style.display = 'none';
    }

    renderNarratorDashboard();
  }

  function restoreLastCheckpoint() {
    if (gameCheckpoints.length === 0) {
      return null;
    }
    const checkpoint = gameCheckpoints.pop();
    phaseTimerManager.cancelAll();
    isRestoringCheckpoint = true;
    try {
      applyStateSnapshot(checkpoint.state);
    } finally {
      isRestoringCheckpoint = false;
    }
    logAction({ type: 'admin', label: 'Checkpoint wiederhergestellt', detail: checkpoint.label });
    return checkpoint;
  }

  function evaluateHypotheticalWinner(deadSet) {
    if (henker && henker.target && deadSet.has(henker.target) && henker.player && !deadSet.has(henker.player)) {
      return 'Henker gewinnt';
    }

    const livingPlayers = players.filter(player => !deadSet.has(player));
    const livingWerewolves = livingPlayers.filter(player => getTeamKey(getPlayerRoleName(player)) === 'werwolf');

    if (lovers.length > 0) {
      const livingLovers = lovers.flat().filter(player => livingPlayers.includes(player));
      if (livingLovers.length > 0 && livingLovers.length === livingPlayers.length) {
        return 'Die Liebenden gewinnen';
      }
    }

    const friedenstifterAlive = players.some((player, index) => rolesAssigned[index] === 'Friedenstifter' && !deadSet.has(player));
    if (friedenstifterAlive && peaceDays >= 4) {
      return 'Friedenstifter gewinnt';
    }

    if (livingWerewolves.length === 0) {
      return 'Dorfbewohner gewinnen';
    }

    if (livingWerewolves.length >= livingPlayers.length - livingWerewolves.length) {
      return 'Werwölfe gewinnen';
    }

    return null;
  }

  function simulateEliminationImpact(playersToEliminate) {
    const livingPlayers = getLivingPlayers();
    const eliminationSet = new Set();
    playersToEliminate.forEach(player => {
      if (livingPlayers.includes(player)) {
        eliminationSet.add(player);
      }
    });

    if (eliminationSet.size === 0) {
      return {
        eliminationChain: [],
        additionalDeaths: [],
        finalTeamCounts: buildTeamCounts(livingPlayers),
        spotlightLost: [],
        mayorLost: false,
        winner: null
      };
    }

    const additionalDeaths = new Set();
    lovers.forEach(pair => {
      if (pair.some(name => eliminationSet.has(name))) {
        pair.forEach(name => {
          if (livingPlayers.includes(name)) {
            if (!eliminationSet.has(name)) {
              additionalDeaths.add(name);
            }
            eliminationSet.add(name);
          }
        });
      }
    });

    const eliminationChain = Array.from(eliminationSet);
    const hypotheticalDead = new Set(deadPlayers);
    eliminationChain.forEach(name => hypotheticalDead.add(name));

    const finalLiving = players.filter(name => !hypotheticalDead.has(name));
    const finalTeamCounts = buildTeamCounts(finalLiving);
    const spotlightLost = getSpotlightPlayers().filter(name => eliminationSet.has(name));
    const mayorLost = mayor ? eliminationSet.has(mayor) : false;
    const winner = evaluateHypotheticalWinner(hypotheticalDead);

    return {
      eliminationChain,
      additionalDeaths: Array.from(additionalDeaths),
      finalTeamCounts,
      spotlightLost,
      mayorLost,
      winner
    };
  }

  function runSandboxSimulation() {
    if (!sandboxSelect || !sandboxResultEl) {
      return;
    }

    const selected = Array.from(sandboxSelect.selectedOptions).map(option => option.value);
    if (selected.length === 0) {
      sandboxResultEl.textContent = 'Bitte mindestens einen lebenden Spieler auswählen.';
      return;
    }

    const impact = simulateEliminationImpact(selected);
    if (impact.eliminationChain.length === 0) {
      sandboxResultEl.textContent = 'Alle ausgewählten Spieler sind bereits ausgeschieden.';
      return;
    }

    const lines = [];
    lines.push(`Simulierte Eliminierungen: ${impact.eliminationChain.join(', ')}`);
    if (impact.additionalDeaths.length > 0) {
      lines.push(`Zusätzliche Verluste: ${impact.additionalDeaths.join(', ')}`);
    }
    lines.push(`Teamverteilung danach: Dorfbewohner ${impact.finalTeamCounts.village}, Werwölfe ${impact.finalTeamCounts.werwolf}, Spezial ${impact.finalTeamCounts.special}`);
    if (impact.mayorLost) {
      lines.push('Der Bürgermeister würde sterben.');
    }
    if (impact.spotlightLost.length > 0) {
      lines.push(`Spotlight-Spieler betroffen: ${impact.spotlightLost.join(', ')}`);
    }
    lines.push(impact.winner ? `Möglicher Sieg: ${impact.winner}` : 'Keine Fraktion würde sofort gewinnen.');

    sandboxResultEl.innerHTML = lines.map(text => `<p>${text}</p>`).join('');
  }

  const actionLog = [];
  const undoStack = [];
  const redoStack = [];

  const timelineLabelMap = {
    admin: 'Admin',
    macro: 'Makro',
    undo: 'Undo',
    redo: 'Redo',
    info: 'Info',
    error: 'Fehler',
    night: 'Nacht'
  };

  function formatTimestamp(date) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function updateTimelineUI() {
    if (!adminTimelineList) return;
    adminTimelineList.innerHTML = '';

    if (actionLog.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = 'Noch keine Aktionen protokolliert.';
      adminTimelineList.appendChild(emptyItem);
      return;
    }

    actionLog.slice(0, 8).forEach(entry => {
      const item = document.createElement('li');
      item.className = `timeline-entry timeline-${entry.type || 'info'}`;

      const header = document.createElement('div');
      header.className = 'timeline-entry-header';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'timeline-type';
      typeBadge.textContent = timelineLabelMap[entry.type] || 'Info';
      header.appendChild(typeBadge);

      const timeEl = document.createElement('time');
      timeEl.className = 'timeline-time';
      timeEl.dateTime = entry.timestamp.toISOString();
      timeEl.textContent = formatTimestamp(entry.timestamp);
      header.appendChild(timeEl);

      item.appendChild(header);

      const labelEl = document.createElement('p');
      labelEl.className = 'timeline-label';
      labelEl.textContent = entry.label;
      item.appendChild(labelEl);

      if (entry.detail) {
        const detailEl = document.createElement('p');
        detailEl.className = 'timeline-detail';
        detailEl.textContent = entry.detail;
        item.appendChild(detailEl);
      }

      adminTimelineList.appendChild(item);
    });
  }

  function updateUndoHistoryUI() {
    if (adminUndoBtn) {
      adminUndoBtn.disabled = undoStack.length === 0;
      adminUndoBtn.textContent = undoStack.length
        ? `Rückgängig (${undoStack[undoStack.length - 1].label})`
        : 'Rückgängig';
    }

    if (adminRedoBtn) {
      adminRedoBtn.disabled = redoStack.length === 0;
      adminRedoBtn.textContent = redoStack.length
        ? `Wiederholen (${redoStack[redoStack.length - 1].label})`
        : 'Wiederholen';
    }

    if (!undoHistoryList) return;
    undoHistoryList.innerHTML = '';

    if (undoStack.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = 'Keine Rückgängig-Schritte verfügbar.';
      undoHistoryList.appendChild(emptyItem);
      return;
    }

    undoStack.slice(-5).reverse().forEach(action => {
      const item = document.createElement('li');
      item.className = 'undo-entry';

      const label = document.createElement('span');
      label.className = 'undo-label';
      label.textContent = action.label;
      item.appendChild(label);

      if (action.detail) {
        const detail = document.createElement('span');
        detail.className = 'undo-detail';
        detail.textContent = action.detail;
        item.appendChild(detail);
      }

      undoHistoryList.appendChild(item);
    });
  }

  function logAction({ type = 'info', label, detail = '' }) {
    const timestamp = new Date();
    actionLog.unshift({ type, label, detail, timestamp });
    if (actionLog.length > 50) {
      actionLog.pop();
    }
    updateTimelineUI();
    renderNarratorDashboard();
  }

  function recordAction({ type = 'admin', label, detail = '', undo, redo }) {
    logAction({ type, label, detail });
    if (typeof undo === 'function' && typeof redo === 'function') {
      undoStack.push({ label, detail, undo, redo });
      redoStack.length = 0;
      updateUndoHistoryUI();
    }
  }

  function updateRevealCardRoleText(playerName, roleName, jobs = []) {
    const revealGrid = document.getElementById('reveal-grid');
    if (!revealGrid) return;
    const cards = revealGrid.querySelectorAll('.reveal-card');
    cards.forEach(card => {
      const playerNameOnCard = card.querySelector('.player-name');
      if (playerNameOnCard && playerNameOnCard.textContent === playerName) {
        const backOfCard = card.querySelector('.reveal-card-back');
        const roleNameEl = backOfCard ? backOfCard.querySelector('.role-name') : null;
        if (roleNameEl) {
          if (roleName === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
            roleNameEl.classList.add('long-text');
          } else {
            roleNameEl.classList.remove('long-text');
          }
          renderRoleWithJobs(roleNameEl, roleName, Array.isArray(jobs) ? jobs : []);
        }
      }
    });
  }

  function syncBloodMoonUI({ silent = false } = {}) {
    const isWerewolfStep = nightMode && nightSteps[nightIndex] === 'Werwolf';
    if (isWerewolfStep) {
      if (bloodMoonActive) {
        document.body.classList.add('blood-moon-active');
        nightTextEl.innerHTML = `${nightTexts['Werwolf']}<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.`;
        renderPlayerChoices(2);
      } else {
        document.body.classList.remove('blood-moon-active');
        nightTextEl.textContent = nightTexts['Werwolf'];
        renderPlayerChoices(1);
      }
    } else if (!bloodMoonActive || silent) {
      document.body.classList.remove('blood-moon-active');
    }
  }

  function populateAdminKillSelect() {
    if (!adminKillPlayerSelect) return;
    adminKillPlayerSelect.innerHTML = '';
    const livingPlayers = players.filter(p => !deadPlayers.includes(p));
    livingPlayers.forEach(p => {
      const option = document.createElement('option');
      option.value = p;
      option.textContent = p;
      adminKillPlayerSelect.appendChild(option);
    });
  }

  function populateAdminReviveSelect() {
    if (!adminRevivePlayerSelect) return;
    adminRevivePlayerSelect.innerHTML = '';
    deadPlayers.forEach(p => {
      const option = document.createElement('option');
      option.value = p;
      option.textContent = p;
      adminRevivePlayerSelect.appendChild(option);
    });
  }

  function populateAdminChangeRoleSelects() {
    if (!adminChangeRolePlayerSelect || !adminChangeRoleRoleSelect) return;
    adminChangeRolePlayerSelect.innerHTML = '';
    players.forEach(p => {
      const option = document.createElement('option');
      option.value = p;
      option.textContent = p;
      adminChangeRolePlayerSelect.appendChild(option);
    });

    adminChangeRoleRoleSelect.innerHTML = '';
    const allRoles = [...categorizedRoles.village, ...categorizedRoles.werwolf, ...categorizedRoles.special];
    const roleOptionValues = [...allRoles, 'Bodyguard', 'Doctor'];
    roleOptionValues.forEach(r => {
      const option = document.createElement('option');
      option.value = r;
      if (r === 'Bodyguard') {
        option.textContent = 'Bodyguard (Job)';
      } else if (r === 'Doctor') {
        option.textContent = 'Arzt (Job)';
      } else {
        option.textContent = r;
      }
      adminChangeRoleRoleSelect.appendChild(option);
    });
  }

  function populateMacroSelect() {
    if (!macroSelect) return;
    macroSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Makro auswählen…';
    placeholder.disabled = true;
    placeholder.selected = true;
    macroSelect.appendChild(placeholder);

    adminMacros.forEach(macro => {
      const option = document.createElement('option');
      option.value = macro.id;
      option.textContent = macro.label;
      macroSelect.appendChild(option);
    });

    if (macroRunBtn) {
      macroRunBtn.disabled = true;
    }
    if (macroDescriptionEl) {
      macroDescriptionEl.textContent = defaultMacroDescription;
    }
  }

  const adminMacros = [
    {
      id: 'revive-all',
      label: 'Alle Spieler wiederbeleben',
      description: 'Belebt alle eliminierten Spieler wieder und leert den Friedhof.',
      execute() {
        const previouslyDead = deadPlayers.slice();
        if (previouslyDead.length === 0) {
          logAction({ type: 'macro', label: 'Makro: Alle Spieler wiederbeleben', detail: 'Keine toten Spieler vorhanden.' });
          return false;
        }

        const apply = () => {
          deadPlayers = [];
          updatePlayerCardVisuals();
          populateAdminKillSelect();
          populateAdminReviveSelect();
          checkGameOver(true);
        };

        apply();

        recordAction({
          type: 'macro',
          label: 'Makro: Alle Spieler wiederbeleben',
          detail: `Wiederbelebte Spieler: ${previouslyDead.join(', ')}`,
          undo: () => {
            deadPlayers = previouslyDead.slice();
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          },
          redo: () => {
            apply();
          }
        });
        return true;
      }
    },
    {
      id: 'reset-witch',
      label: 'Hexentränke auffrischen',
      description: 'Setzt Heil- und Gifttrank der Hexe auf den Ausgangswert zurück.',
      execute() {
        const previous = { heal: healRemaining, poison: poisonRemaining };
        if (previous.heal === 1 && previous.poison === 1) {
          logAction({ type: 'macro', label: 'Makro: Hexentränke auffrischen', detail: 'Die Hexe verfügt bereits über beide Tränke.' });
          return false;
        }

        healRemaining = 1;
        poisonRemaining = 1;

        recordAction({
          type: 'macro',
          label: 'Makro: Hexentränke auffrischen',
          detail: `Heil ${previous.heal} → 1 | Gift ${previous.poison} → 1`,
          undo: () => {
            healRemaining = previous.heal;
            poisonRemaining = previous.poison;
          },
          redo: () => {
            healRemaining = 1;
            poisonRemaining = 1;
          }
        });
        return true;
      }
    },
    {
      id: 'rewind-night',
      label: 'Letzte Nacht rückgängig',
      description: 'Entfernt die Opfer der laufenden Nacht und belebt sie wieder.',
      execute() {
        const victims = currentNightVictims.slice();
        if (victims.length === 0) {
          logAction({ type: 'macro', label: 'Makro: Letzte Nacht rückgängig', detail: 'Es sind keine Nachtopfer registriert.' });
          return false;
        }

        const apply = () => {
          deadPlayers = deadPlayers.filter(player => !victims.includes(player));
          currentNightVictims = [];
          updatePlayerCardVisuals();
          populateAdminKillSelect();
          populateAdminReviveSelect();
          checkGameOver(true);
        };

        apply();

        recordAction({
          type: 'macro',
          label: 'Makro: Letzte Nacht rückgängig',
          detail: `Wiederbelebt: ${victims.join(', ')}`,
          undo: () => {
            currentNightVictims = victims.slice();
            victims.forEach(name => {
              if (!deadPlayers.includes(name)) {
                deadPlayers.push(name);
                handlePlayerDeath(name, { silent: true });
              }
            });
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          },
          redo: () => {
            apply();
          }
        });
        return true;
      }
    }
  ];

  populateMacroSelect();
  updateTimelineUI();
  updateUndoHistoryUI();

  if (pauseTimersBtn) {
    pauseTimersBtn.addEventListener('click', () => {
      const timers = phaseTimerManager.list();
      if (phaseTimerManager.isPaused()) {
        const resumed = phaseTimerManager.resume();
        if (resumed) {
          logAction({ type: 'admin', label: 'Phase-Timer fortgesetzt', detail: `${timers.length} Timer reaktiviert.` });
        }
      } else {
        if (timers.length === 0) {
          logAction({ type: 'info', label: 'Keine Timer aktiv', detail: 'Es gibt derzeit keine laufenden Phase-Timer.' });
          return;
        }
        const paused = phaseTimerManager.pause();
        if (paused) {
          logAction({ type: 'admin', label: 'Phase-Timer pausiert', detail: `${timers.length} Timer angehalten.` });
        }
      }
    });
  }

  if (skipStepBtn) {
    skipStepBtn.addEventListener('click', () => {
      if (nightMode) {
        const currentRole = nightSteps[nightIndex] || 'Nachtende';
        phaseTimerManager.cancelAll();
        logAction({ type: 'admin', label: 'Schritt übersprungen', detail: `Nachtaktion: ${currentRole}` });
        moveToNextNightStep();
      } else if (dayMode) {
        phaseTimerManager.cancelAll();
        logAction({ type: 'admin', label: 'Schritt übersprungen', detail: `Tag ${Math.max(dayCount, 1)}` });
        endDayPhase();
      } else {
        logAction({ type: 'info', label: 'Keine Phase aktiv', detail: 'Es läuft derzeit keine Phase, die übersprungen werden könnte.' });
      }
    });
  }

  if (stepBackBtn) {
    stepBackBtn.addEventListener('click', () => {
      if (!nightMode || nightStepHistory.length <= 1) {
        return;
      }

      const currentEntry = nightStepHistory.pop();
      const previousEntry = nightStepHistory[nightStepHistory.length - 1];

      if (!previousEntry) {
        if (currentEntry) {
          nightStepHistory.push(currentEntry);
        }
        return;
      }

      phaseTimerManager.cancelAll();
      logAction({
        type: 'admin',
        label: 'Schritt zurück',
        detail: `Nachtaktion: ${previousEntry.role || 'Unbekannt'}`
      });

      applyStateSnapshot(previousEntry.state, { resetNightHistory: false });
    });
  }

  if (rollbackCheckpointBtn) {
    rollbackCheckpointBtn.addEventListener('click', () => {
      if (gameCheckpoints.length === 0) {
        logAction({ type: 'info', label: 'Kein Checkpoint verfügbar', detail: 'Es existiert kein gespeicherter Spielstand.' });
        return;
      }
      restoreLastCheckpoint();
    });
  }

  if (sandboxSimulateBtn) {
    sandboxSimulateBtn.addEventListener('click', () => {
      runSandboxSimulation();
      if (sandboxSelect) {
        const selection = Array.from(sandboxSelect.selectedOptions).map(option => option.value);
        logAction({ type: 'info', label: 'Sandbox-Simulation', detail: selection.length ? `Auswahl: ${selection.join(', ')}` : 'Keine Auswahl' });
      }
    });
  }

  if (sandboxSelect) {
    sandboxSelect.addEventListener('change', () => {
      if (sandboxSelect.selectedOptions.length === 0 && sandboxResultEl) {
        sandboxResultEl.textContent = '';
      }
    });
  }

  if (macroSelect) {
    macroSelect.addEventListener('change', () => {
      const selectedMacro = adminMacros.find(macro => macro.id === macroSelect.value);
      if (macroDescriptionEl) {
        macroDescriptionEl.textContent = selectedMacro ? selectedMacro.description : defaultMacroDescription;
      }
      if (macroRunBtn) {
        macroRunBtn.disabled = !selectedMacro;
      }
    });
  }

  if (macroRunBtn) {
    macroRunBtn.addEventListener('click', () => {
      if (!macroSelect) return;
      const selectedMacro = adminMacros.find(macro => macro.id === macroSelect.value);
      if (!selectedMacro) {
        logAction({ type: 'error', label: 'Makro konnte nicht ausgeführt werden', detail: 'Bitte zuerst ein Makro auswählen.' });
        return;
      }

      try {
        const executed = selectedMacro.execute();
        if (executed && macroSelect) {
          macroSelect.selectedIndex = 0;
          if (macroDescriptionEl) {
            macroDescriptionEl.textContent = defaultMacroDescription;
          }
          macroRunBtn.disabled = true;
        }
      } catch (error) {
        console.error('Fehler beim Ausführen des Makros', error);
        logAction({ type: 'error', label: 'Makro fehlgeschlagen', detail: error.message });
      }
    });
  }

  if (adminUndoBtn) {
    adminUndoBtn.addEventListener('click', () => {
      if (undoStack.length === 0) return;
      const action = undoStack.pop();
      try {
        action.undo();
        redoStack.push(action);
        logAction({ type: 'undo', label: `Rückgängig: ${action.label}`, detail: action.detail || '' });
      } catch (error) {
        console.error('Undo fehlgeschlagen', error);
        logAction({ type: 'error', label: 'Undo fehlgeschlagen', detail: error.message });
      }
      updateUndoHistoryUI();
    });
  }

  if (adminRedoBtn) {
    adminRedoBtn.addEventListener('click', () => {
      if (redoStack.length === 0) return;
      const action = redoStack.pop();
      try {
        action.redo();
        undoStack.push(action);
        logAction({ type: 'redo', label: `Wiederholen: ${action.label}`, detail: action.detail || '' });
      } catch (error) {
        console.error('Redo fehlgeschlagen', error);
        logAction({ type: 'error', label: 'Redo fehlgeschlagen', detail: error.message });
      }
      updateUndoHistoryUI();
    });
  }

  if (adminPanelToggle) {
    adminPanelToggle.addEventListener('click', () => {
      adminPanel.classList.toggle('hidden');
      if (!adminPanel.classList.contains('hidden')) {
        populateAdminKillSelect();
        populateAdminReviveSelect();
        populateAdminChangeRoleSelects();
        populateMacroSelect();
      }
    });
  }

  if (adminChangeRoleBtn) {
    adminChangeRoleBtn.addEventListener('click', () => {
      const playerToChange = adminChangeRolePlayerSelect ? adminChangeRolePlayerSelect.value : '';
      const newRole = adminChangeRoleRoleSelect ? adminChangeRoleRoleSelect.value : '';
      if (!playerToChange || !newRole) {
        showInfoMessage({
          title: 'Auswahl erforderlich',
          text: 'Bitte einen Spieler und eine Rolle auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Admin-Aktion abgebrochen', detail: 'Keine Auswahl für den Rollenwechsel getroffen.' }
        });
        return;
      }

      showConfirmation('Rolle ändern?', `Willst du die Rolle von ${playerToChange} zu ${newRole} ändern?`, () => {
        const playerIndex = players.indexOf(playerToChange);
        if (playerIndex === -1) {
          logAction({ type: 'error', label: 'Rollenänderung nicht möglich', detail: `${playerToChange} wurde nicht gefunden.` });
          return;
        }

        let previousRole = rolesAssigned[playerIndex];
        const previousJobs = getPlayerJobs(playerIndex).slice();
        if (previousRole === 'Bodyguard') {
          previousRole = 'Dorfbewohner';
          if (!previousJobs.includes('Bodyguard')) {
            previousJobs.push('Bodyguard');
          }
        }
        if (previousRole === 'Doctor') {
          previousRole = 'Dorfbewohner';
          if (!previousJobs.includes('Doctor')) {
            previousJobs.push('Doctor');
          }
        }

        const isJobSelection = newRole === 'Bodyguard' || newRole === 'Doctor';
        const appliedRole = isJobSelection ? 'Dorfbewohner' : newRole;
        const hasBodyguardJob = previousJobs.includes('Bodyguard');
        const hasDoctorJob = previousJobs.includes('Doctor');
        const wantsBodyguard = newRole === 'Bodyguard';
        const wantsDoctor = newRole === 'Doctor';

        if (appliedRole === previousRole && hasBodyguardJob === wantsBodyguard && hasDoctorJob === wantsDoctor) {
          const labelText = formatRoleWithJobs(previousRole, previousJobs);
          logAction({ type: 'info', label: 'Keine Rollenänderung notwendig', detail: `${playerToChange} besitzt bereits ${labelText}.` });
          showConfirmation('Keine Änderung', `${playerToChange} hat bereits ${labelText}.`, () => {}, 'Okay', false);
          return;
        }

        rolesAssigned[playerIndex] = appliedRole;
        if (wantsBodyguard) {
          assignBodyguardJobToIndex(playerIndex);
        } else {
          removeBodyguardJobFromIndex(playerIndex);
        }
        if (wantsDoctor) {
          assignDoctorJobToIndex(playerIndex);
        } else {
          removeDoctorJobFromIndex(playerIndex);
        }
        const newJobs = getPlayerJobs(playerIndex).slice();

        updateRevealCardRoleText(playerToChange, appliedRole, newJobs);
        initializeMichaelJacksonAccusations();
        updateBodyguardPlayers();

        const previousLabel = formatRoleWithJobs(previousRole, previousJobs);
        const newLabel = formatRoleWithJobs(appliedRole, newJobs);

        recordAction({
          type: 'admin',
          label: `Rollenwechsel: ${playerToChange}`,
          detail: `${previousLabel || 'Unbekannt'} → ${newLabel}`,
          undo: () => {
            rolesAssigned[playerIndex] = previousRole;
            removeBodyguardJobFromIndex(playerIndex);
            removeDoctorJobFromIndex(playerIndex);
            if (previousJobs.includes('Bodyguard')) {
              assignBodyguardJobToIndex(playerIndex);
            }
            if (previousJobs.includes('Doctor')) {
              assignDoctorJobToIndex(playerIndex);
            }
            updateRevealCardRoleText(playerToChange, previousRole || '', getPlayerJobs(playerIndex));
            updateBodyguardPlayers();
          },
          redo: () => {
            rolesAssigned[playerIndex] = appliedRole;
            removeBodyguardJobFromIndex(playerIndex);
            if (newJobs.includes('Bodyguard')) {
              assignBodyguardJobToIndex(playerIndex);
            }
            removeDoctorJobFromIndex(playerIndex);
            if (newJobs.includes('Doctor')) {
              assignDoctorJobToIndex(playerIndex);
            }
            updateRevealCardRoleText(playerToChange, appliedRole, getPlayerJobs(playerIndex));
            updateBodyguardPlayers();
          }
        });

        showConfirmation('Rolle geändert', `Die Rolle von ${playerToChange} wurde zu ${newLabel} geändert.`, () => {}, 'Okay', false);
      });
    });
  }

  if (adminRevivePlayerBtn) {
    adminRevivePlayerBtn.addEventListener('click', () => {
      const playerToRevive = adminRevivePlayerSelect ? adminRevivePlayerSelect.value : '';
      if (!playerToRevive) {
        showInfoMessage({
          title: 'Auswahl erforderlich',
          text: 'Bitte einen Spieler auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Admin-Aktion abgebrochen', detail: 'Keine Auswahl für die Wiederbelebung getroffen.' }
        });
        return;
      }

      showConfirmation('Spieler wiederbeleben?', `Willst du ${playerToRevive} wirklich wiederbeleben?`, () => {
        if (!deadPlayers.includes(playerToRevive)) {
          logAction({ type: 'info', label: 'Keine Wiederbelebung erforderlich', detail: `${playerToRevive} lebt bereits.` });
          showConfirmation('Keine Änderung', `${playerToRevive} lebt bereits.`, () => {}, 'Okay', false);
          return;
        }

        deadPlayers = deadPlayers.filter(p => p !== playerToRevive);
        updatePlayerCardVisuals();
        populateAdminKillSelect();
        populateAdminReviveSelect();

        recordAction({
          type: 'admin',
          label: `Wiederbelebung: ${playerToRevive}`,
          detail: 'Spieler kehrt ins Dorf zurück.',
          undo: () => {
            if (!deadPlayers.includes(playerToRevive)) {
              deadPlayers.push(playerToRevive);
              handlePlayerDeath(playerToRevive, { silent: true });
            }
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          },
          redo: () => {
            deadPlayers = deadPlayers.filter(p => p !== playerToRevive);
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          }
        });

        showConfirmation('Spieler wiederbelebt', `${playerToRevive} wurde wiederbelebt.`, () => {}, 'Okay', false);
        checkGameOver(true);
      });
    });
  }

  if (closeAdminPanelBtn) {
    closeAdminPanelBtn.addEventListener('click', () => {
      adminPanel.classList.add('hidden');
    });
  }

  if (adminKillPlayerBtn) {
    adminKillPlayerBtn.addEventListener('click', () => {
      const playerToKill = adminKillPlayerSelect ? adminKillPlayerSelect.value : '';
      if (!playerToKill) {
        showInfoMessage({
          title: 'Auswahl erforderlich',
          text: 'Bitte einen Spieler auswählen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Admin-Aktion abgebrochen', detail: 'Keine Auswahl für die Eliminierung getroffen.' }
        });
        return;
      }

      showConfirmation('Spieler eliminieren?', `Willst du ${playerToKill} wirklich eliminieren?`, () => {
        if (deadPlayers.includes(playerToKill)) {
          logAction({ type: 'info', label: 'Keine Eliminierung durchgeführt', detail: `${playerToKill} war bereits tot.` });
          showConfirmation('Keine Änderung', `${playerToKill} war bereits eliminiert.`, () => {}, 'Okay', false);
          return;
        }

        const affectedPlayers = [];
        const loverAlerts = [];

        const markAsDead = (name, { alertMessage } = {}) => {
          if (!deadPlayers.includes(name)) {
            deadPlayers.push(name);
            handlePlayerDeath(name);
            affectedPlayers.push(name);
            if (alertMessage) {
              loverAlerts.push(alertMessage);
            }
          }
        };

        markAsDead(playerToKill);

        lovers.forEach(pair => {
          if (pair.includes(playerToKill)) {
            const partner = pair[0] === playerToKill ? pair[1] : pair[0];
            if (!deadPlayers.includes(partner)) {
              markAsDead(partner, { alertMessage: `${partner} ist aus Liebeskummer gestorben!` });
            }
          }
        });

        updatePlayerCardVisuals();
        populateAdminKillSelect();
        populateAdminReviveSelect();

        if (loverAlerts.length > 0) {
          showInfoMessage({
            title: 'Liebende trauern',
            html: loverAlerts.join('<br>'),
            confirmText: 'Verstanden',
            log: { type: 'info', label: 'Liebende betroffen', detail: loverAlerts.join(' | ') }
          });
        }

        recordAction({
          type: 'admin',
          label: `Eliminierung: ${playerToKill}`,
          detail: affectedPlayers.length > 1 ? `Mit betroffen: ${affectedPlayers.slice(1).join(', ')}` : '',
          undo: () => {
            deadPlayers = deadPlayers.filter(p => !affectedPlayers.includes(p));
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          },
          redo: () => {
            affectedPlayers.forEach(name => {
              if (!deadPlayers.includes(name)) {
                deadPlayers.push(name);
                handlePlayerDeath(name, { silent: true });
              }
            });
            updatePlayerCardVisuals();
            populateAdminKillSelect();
            populateAdminReviveSelect();
            checkGameOver(true);
          }
        });

        showConfirmation('Spieler eliminiert', `${playerToKill} wurde eliminiert.`, () => {}, 'Okay', false);
        checkGameOver();
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.shiftKey && e.key === 'o') {
      adminPanel.classList.toggle('hidden');
      if (!adminPanel.classList.contains('hidden')) {
        populateAdminKillSelect();
        populateAdminReviveSelect();
        populateAdminChangeRoleSelects();
        populateMacroSelect();
      }
    }
  });

  if (triggerBloodMoonBtn) {
    triggerBloodMoonBtn.addEventListener('click', () => {
      const wasActive = bloodMoonActive;
      if (wasActive) {
        logAction({ type: 'info', label: 'Blutmond bereits aktiv', detail: 'Der Blutmond war bereits ausgelöst.' });
        showConfirmation('Keine Änderung', 'Der Blutmond ist bereits aktiv.', () => {}, 'Okay', false);
        return;
      }

      setBloodMoonState(true);
      syncBloodMoonUI({ silent: true });
      showConfirmation('Blutmond aktiviert', 'Der Blutmond wurde für die nächste Nacht manuell aktiviert.', () => {}, 'Okay', false);

      eventScheduler.addModifier({
        id: 'blood-moon-manual',
        originCardId: 'blood-moon',
        label: '🌕 Blutmond (manuell)',
        expiresAfterNight: nightCounter + 1
      });
      persistValue('bloodMoonPityTimer', '0');
      persistEventEngineState();
      renderNarratorDashboard();

      recordAction({
        type: 'admin',
        label: 'Blutmond manuell aktiviert',
        detail: 'Gilt für die kommende Nacht.',
        undo: () => {
          setBloodMoonState(wasActive);
          syncBloodMoonUI({ silent: true });
          eventScheduler.removeModifier('blood-moon-manual');
          persistEventEngineState();
          renderNarratorDashboard();
        },
        redo: () => {
          setBloodMoonState(true);
          syncBloodMoonUI({ silent: true });
          eventScheduler.addModifier({
            id: 'blood-moon-manual',
            originCardId: 'blood-moon',
            label: '🌕 Blutmond (manuell)',
            expiresAfterNight: nightCounter + 1
          });
          persistValue('bloodMoonPityTimer', '0');
          persistEventEngineState();
          renderNarratorDashboard();
        }
      });
    });
  }

  const rolesOverviewPlayerSelect = document.getElementById('roles-overview-player-select');
  const rolesOverviewShowPlayerBtn = document.getElementById('roles-overview-show-player-btn');
  const rolesOverviewShowAllBtn = document.getElementById('roles-overview-show-all-btn');

  function displayAllRolesInOverview() {
    rolesOverviewContent.innerHTML = '';
    const list = document.createElement('ul');
    players.forEach((player, index) => {
        const item = document.createElement('li');
        const jobs = getPlayerJobs(index);
        const label = formatRoleWithJobs(rolesAssigned[index], jobs);
        item.textContent = `${player}: ${label}`;
        if (deadPlayers.includes(player)) {
            item.classList.add('dead');
        }
        list.appendChild(item);
    });
    rolesOverviewContent.appendChild(list);
  }

  showRolesOverviewBtn.addEventListener('click', () => {
    rolesOverviewPlayerSelect.innerHTML = '';
    players.forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        rolesOverviewPlayerSelect.appendChild(option);
    });

    displayAllRolesInOverview();
    rolesOverviewModal.style.display = 'flex';
  });

  rolesOverviewShowPlayerBtn.addEventListener('click', () => {
    const selectedPlayer = rolesOverviewPlayerSelect.value;
    if (!selectedPlayer) return;

    const playerIndex = players.indexOf(selectedPlayer);
    const role = rolesAssigned[playerIndex];
    const jobs = getPlayerJobs(playerIndex);

    rolesOverviewContent.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'single-role-display';
    p.textContent = `${selectedPlayer}: ${formatRoleWithJobs(role, jobs)}`;
    if (deadPlayers.includes(selectedPlayer)) {
        p.classList.add('dead');
    }
    rolesOverviewContent.appendChild(p);
  });

  rolesOverviewShowAllBtn.addEventListener('click', displayAllRolesInOverview);

  if (typeof window !== 'undefined') {
    window.__WERWOLF_TEST__ = {
      getState() {
        return {
          players: players.slice(),
          rolesAssigned: rolesAssigned.slice(),
          deadPlayers: deadPlayers.slice(),
          lovers: lovers.map(pair => pair.slice()),
          silencedPlayer,
          healRemaining,
          poisonRemaining,
          bloodMoonActive,
          phoenixPulsePending,
          phoenixPulseJustResolved,
          phoenixPulseRevivedPlayers: phoenixPulseRevivedPlayers.slice(),
          firstNightShieldUsed,
          dayCount,
          mayor,
          nightMode,
          dayMode,
          nightSteps: nightSteps.slice(),
          nightIndex,
          currentNightVictims: currentNightVictims.slice(),
          michaelJacksonAccusations: JSON.parse(JSON.stringify(michaelJacksonAccusations || {})),
          jagerDiedLastNight,
          nightCounter,
          peaceDays,
          actionLog: actionLog.slice(),
          bodyguardPlayers: bodyguardPlayers.slice(),
          bodyguardProtectionTarget,
          bodyguardProtectionNight,
          bodyguardSavedTarget,
          doctorPlayers: doctorPlayers.slice(),
          doctorPendingTargets: doctorPendingTargets.slice(),
          doctorPendingNight,
          doctorTriggerSourceNight,
          doctorLastHealedTarget,
          doctorLastHealedNight,
          jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
          jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
          eventEngineState: getEventEngineSnapshot()
        };
      },
      setState(partial = {}) {
        let recalcJobs = false;
        let phoenixStateChanged = false;
        if (Array.isArray(partial.players)) {
          players = partial.players.slice();
          recalcJobs = true;
        }
        if (Array.isArray(partial.rolesAssigned)) {
          rolesAssigned = partial.rolesAssigned.slice();
          recalcJobs = true;
        }
        if (Array.isArray(partial.jobsAssigned)) {
          jobsAssigned = partial.jobsAssigned.map(entry => Array.isArray(entry) ? entry.slice() : []);
          recalcJobs = true;
        }
        if (Array.isArray(partial.deadPlayers)) {
          deadPlayers = partial.deadPlayers.slice();
        }
        if (Array.isArray(partial.lovers)) {
          lovers = partial.lovers.map(pair => pair.slice());
        }
        if ('silencedPlayer' in partial) {
          silencedPlayer = partial.silencedPlayer;
        }
        if ('healRemaining' in partial) {
          healRemaining = partial.healRemaining;
        }
        if ('poisonRemaining' in partial) {
          poisonRemaining = partial.poisonRemaining;
        }
        if ('bloodMoonActive' in partial) {
          setBloodMoonState(!!partial.bloodMoonActive);
        }
        if ('phoenixPulsePending' in partial) {
          phoenixPulsePending = !!partial.phoenixPulsePending;
          phoenixStateChanged = true;
        }
        if ('phoenixPulseJustResolved' in partial) {
          phoenixPulseJustResolved = !!partial.phoenixPulseJustResolved;
          phoenixStateChanged = true;
        }
        if (Array.isArray(partial.phoenixPulseRevivedPlayers)) {
          phoenixPulseRevivedPlayers = partial.phoenixPulseRevivedPlayers.slice();
          phoenixStateChanged = true;
        }
        if (partial.eventEngineState) {
          restoreEventEngineState(partial.eventEngineState);
        }
        if ('firstNightShieldUsed' in partial) {
          firstNightShieldUsed = !!partial.firstNightShieldUsed;
        }
        if ('dayCount' in partial) {
          dayCount = partial.dayCount;
        }
        if ('mayor' in partial) {
          mayor = partial.mayor;
        }
        if ('nightMode' in partial) {
          nightMode = partial.nightMode;
        }
        if ('dayMode' in partial) {
          dayMode = partial.dayMode;
        }
        if (Array.isArray(partial.nightSteps)) {
          nightSteps = partial.nightSteps.slice();
        }
        if ('nightIndex' in partial) {
          nightIndex = partial.nightIndex;
        }
        if (Array.isArray(partial.currentNightVictims)) {
          currentNightVictims = partial.currentNightVictims.slice();
        }
        if ('michaelJacksonAccusations' in partial) {
          michaelJacksonAccusations = JSON.parse(JSON.stringify(partial.michaelJacksonAccusations || {}));
        }
        if ('jagerDiedLastNight' in partial) {
          jagerDiedLastNight = partial.jagerDiedLastNight;
        }
        if ('nightCounter' in partial) {
          nightCounter = partial.nightCounter;
        }
        if ('peaceDays' in partial) {
          peaceDays = partial.peaceDays;
        }
        if ('bodyguardProtectionTarget' in partial) {
          bodyguardProtectionTarget = partial.bodyguardProtectionTarget;
        }
        if ('bodyguardProtectionNight' in partial) {
          bodyguardProtectionNight = Number.isFinite(partial.bodyguardProtectionNight)
            ? partial.bodyguardProtectionNight
            : null;
        }
        if ('bodyguardSavedTarget' in partial) {
          bodyguardSavedTarget = partial.bodyguardSavedTarget;
        }
        if (partial.jobConfig && typeof partial.jobConfig.bodyguardChance === 'number') {
          jobConfig.bodyguardChance = Math.min(Math.max(partial.jobConfig.bodyguardChance, 0), 1);
          updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
        }
        if (partial.jobConfig && typeof partial.jobConfig.doctorChance === 'number') {
          jobConfig.doctorChance = Math.min(Math.max(partial.jobConfig.doctorChance, 0), 1);
          updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
        }

        if (phoenixStateChanged) {
          setPhoenixPulseCharged(phoenixPulsePending);
          updatePhoenixPulseStatus();
        }

        if (recalcJobs || Array.isArray(partial.jobsAssigned) || Array.isArray(partial.bodyguardPlayers) || Array.isArray(partial.doctorPlayers)) {
          ensureJobsStructure();
          const legacyBodyguards = [];
          rolesAssigned.forEach((role, index) => {
            if (role === 'Bodyguard') {
              legacyBodyguards.push(index);
              rolesAssigned[index] = 'Dorfbewohner';
            }
          });
          if (legacyBodyguards.length > 0) {
            assignBodyguardJobToIndex(legacyBodyguards[0]);
          }
          if (Array.isArray(partial.bodyguardPlayers)) {
            partial.bodyguardPlayers.forEach(name => {
              const idx = players.indexOf(name);
              if (idx !== -1) {
                assignBodyguardJobToIndex(idx);
              }
            });
          }
          if (Array.isArray(partial.doctorPlayers)) {
            partial.doctorPlayers.forEach(name => {
              const idx = players.indexOf(name);
              if (idx !== -1) {
                assignDoctorJobToIndex(idx);
              }
            });
          }
          updateBodyguardPlayers();
          recalcJobs = false;
        } else if (recalcJobs) {
          ensureJobsStructure();
          updateBodyguardPlayers();
          recalcJobs = false;
        }
        if (Array.isArray(partial.doctorPendingTargets)) {
          doctorPendingTargets = partial.doctorPendingTargets.slice();
        }
        if ('doctorPendingNight' in partial) {
          doctorPendingNight = Number.isFinite(partial.doctorPendingNight)
            ? partial.doctorPendingNight
            : null;
        }
        if ('doctorTriggerSourceNight' in partial) {
          doctorTriggerSourceNight = Number.isFinite(partial.doctorTriggerSourceNight)
            ? partial.doctorTriggerSourceNight
            : null;
        }
        if ('doctorLastHealedTarget' in partial) {
          doctorLastHealedTarget = partial.doctorLastHealedTarget || null;
        }
        if ('doctorLastHealedNight' in partial) {
          doctorLastHealedNight = Number.isFinite(partial.doctorLastHealedNight)
            ? partial.doctorLastHealedNight
            : null;
        }
        updateDoctorPlayers();
        renderNarratorDashboard();
      },
      renderNarratorDashboard,
      getDashboardSnapshot() {
        return {
          phase: dashboardPhaseEl ? dashboardPhaseEl.textContent : '',
          teamCounts: dashboardTeamCountsEl ? dashboardTeamCountsEl.textContent : '',
          roleCounts: dashboardRoleCountsEl
            ? Array.from(dashboardRoleCountsEl.querySelectorAll('li')).map(li => li.textContent)
            : [],
          mayor: dashboardMayorEl ? dashboardMayorEl.textContent : '',
          spotlight: dashboardSpotlightEl ? dashboardSpotlightEl.textContent : '',
          silenced: dashboardSilencedEl ? dashboardSilencedEl.textContent : '',
          events: dashboardEventsEl
            ? Array.from(dashboardEventsEl.querySelectorAll('li')).map(li => li.textContent)
            : []
        };
      },
      handlePlayerDeath,
      electMayor,
      advanceNight,
      runMacro(id) {
        const macro = adminMacros.find(entry => entry.id === id);
        if (!macro) {
          return false;
        }
        const result = macro.execute();
        return !!result;
      },
      getActionLog() {
        return actionLog.slice();
      },
      phaseTimerManager,
      getEventEngineState() {
        return getEventEngineSnapshot();
      },
      triggerNightEvents() {
        const upcomingNight = nightCounter + 1;
        triggerRandomEvents();
        nightCounter = upcomingNight;
      },
      resolvePhoenixPulse: applyPhoenixPulseRevival,
      auth: {
        getUser() {
          return authManager?.getUser() || null;
        },
        forceUser(user) {
          if (authManager) {
            authManager.forceUser(user, { suppressScreen: true });
          }
        },
        async requireLogin() {
          if (!authManager) {
            return null;
          }
          const user = authManager.getUser();
          if (user) {
            return user;
          }
          authManager.showLogin();
          return authManager.waitForAuth();
        },
      }
    };
  }

  if (deferInitialEventEnablement) {
    applyGlobalEventsEnabledState();
  } else {
    refreshEventUI();
  }

  renderNarratorDashboard();

});
