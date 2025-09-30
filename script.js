/* Rollen Geber – Client-side JS */

let authManager = null;
let lobbyManager = null;

const apiClient = (() => {
  const baseUrl = '/api';
  const storageCache = new Map();
  const inflightReads = new Map();
  let activeLobby = null;

  function getScopeKey(lobby = activeLobby) {
    if (lobby && typeof lobby.id === 'number') {
      return `lobby:${lobby.id}`;
    }
    return 'personal';
  }

  function getScopedMap(container, scopeKey) {
    if (!container.has(scopeKey)) {
      container.set(scopeKey, new Map());
    }
    return container.get(scopeKey);
  }

  function cacheValue(key, value, lobby = activeLobby) {
    const scopeKey = getScopeKey(lobby);
    const cache = getScopedMap(storageCache, scopeKey);
    cache.set(key, value ?? null);
  }

  function getCachedValue(key, lobby = activeLobby) {
    const scopeKey = getScopeKey(lobby);
    const cache = storageCache.get(scopeKey);
    return cache?.get(key);
  }

  function clearCaches() {
    storageCache.clear();
    inflightReads.clear();
  }

  function setActiveLobby(lobby) {
    if (lobby && typeof lobby.id === 'number') {
      activeLobby = { ...lobby };
    } else {
      activeLobby = null;
    }
  }

  function getActiveLobby() {
    return activeLobby ? { ...activeLobby } : null;
  }

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

    if (activeLobby && typeof activeLobby.id === 'number') {
      headers['X-Werwolf-Lobby'] = String(activeLobby.id);
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

  async function getStorageItem(key, lobby = activeLobby) {
    const scopeKey = getScopeKey(lobby);
    const cache = getScopedMap(storageCache, scopeKey);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const inflightScope = getScopedMap(inflightReads, scopeKey);
    if (inflightScope.has(key)) {
      return inflightScope.get(key);
    }

    const promise = request(`/storage/${encodeURIComponent(key)}`)
      .then((data) => {
        const value = data && Object.prototype.hasOwnProperty.call(data, 'value')
          ? data.value
          : null;
        cacheValue(key, value, lobby);
        inflightScope.delete(key);
        return value;
      })
      .catch((error) => {
        inflightScope.delete(key);
        throw error;
      });

    inflightScope.set(key, promise);
    return promise;
  }

  function getCachedStorageItem(key, lobby = activeLobby) {
    const value = getCachedValue(key, lobby);
    return value === undefined ? null : value;
  }

  async function setStorageItem(key, value, lobby = activeLobby) {
    cacheValue(key, value, lobby);
    await request(`/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    return value;
  }

  async function removeStorageItem(key, lobby = activeLobby) {
    const scopeKey = getScopeKey(lobby);
    const cache = storageCache.get(scopeKey);
    cache?.delete(key);
    const inflightScope = inflightReads.get(scopeKey);
    inflightScope?.delete(key);
    await request(`/storage/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  async function prefetchStorage(keys) {
    await Promise.all(
      keys.map((key) =>
        getStorageItem(key).catch(() => null)
      )
    );
  }

  async function withLobby(lobbyLike, callback) {
    const previousLobby = activeLobby;
    if (typeof lobbyLike === 'number') {
      activeLobby = { id: lobbyLike };
    } else if (lobbyLike && typeof lobbyLike === 'object') {
      activeLobby = { ...lobbyLike };
    } else {
      activeLobby = null;
    }
    try {
      return await callback();
    } finally {
      activeLobby = previousLobby;
    }
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
        cacheValue('themeState', data);
        return data;
      },
      async set(update) {
        const payload = typeof update === 'string' ? { variant: update } : (update || {});
        const data = await request('/theme', {
          method: 'PUT',
          body: JSON.stringify({ selection: payload }),
        });
        cacheValue('themeState', data);
        return data;
      },
      async presets() {
        const data = await request('/themes');
        cacheValue('themePresets', data);
        return data;
      },
      getCachedState() {
        return getCachedValue('themeState');
      },
      setCachedState(state, lobby = activeLobby) {
        cacheValue('themeState', state, lobby);
      },
      getCachedPresets() {
        return getCachedValue('themePresets');
      },
    },
    locale: {
      async get() {
        const data = await request('/locale');
        return data || {};
      },
      async set(preference) {
        const payload = preference === undefined ? {} : { preference };
        return request('/locale', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
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
        const roles = Array.isArray(data?.roles) ? data.roles : [];;
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
    rolesConfig: {
      async get() {
        const data = await request('/roles-config');
        return {
          config: data?.config || null,
          source: data?.source || 'default',
        };
      },
      async set(config) {
        const data = await request('/roles-config', {
          method: 'PUT',
          body: JSON.stringify({ config }),
        });
        return {
          config: data?.config || null,
          source: data?.source || 'custom',
        };
      },
      async create(config) {
        const data = await request('/roles-config', {
          method: 'POST',
          body: JSON.stringify({ config }),
        });
        return {
          config: data?.config || null,
          source: data?.source || 'custom',
        };
      },
      async remove() {
        await request('/roles-config', { method: 'DELETE' });
      },
    },
    storageScopes: {
      withLobby,
      setActiveLobby,
      getActiveLobby,
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
      async timeline(timestamp) {
        if (!Number.isFinite(Number(timestamp))) {
          return null;
        }
        const data = await request(`/sessions/${encodeURIComponent(timestamp)}/timeline`);
        return data?.timeline ?? null;
      },
    },
    analytics: {
      async get() {
        const data = await request('/analytics');
        return data || {};
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
    lobby: {
      setActive(lobby) {
        setActiveLobby(lobby);
      },
      getActive: getActiveLobby,
      withLobby,
      async list() {
        const data = await request('/lobbies');
        return Array.isArray(data?.lobbies) ? data.lobbies : [];
      },
      async create({ name }) {
        const data = await request('/lobbies', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        return data || {};
      },
      async join(code) {
        const payload = typeof code === 'object' ? code : { code };
        const data = await request('/lobbies/join', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return data || {};
      },
      async update(lobbyId, payload) {
        const data = await request(`/lobbies/${encodeURIComponent(lobbyId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload || {}),
        });
        return data || {};
      },
      async rotateCode(lobbyId) {
        const data = await request(`/lobbies/${encodeURIComponent(lobbyId)}/rotate-code`, {
          method: 'POST',
          body: JSON.stringify({ rotate: true }),
        });
        return data || {};
      },
      async remove(lobbyId, { deleteLobby: destroy = false } = {}) {
        const options = destroy ? { method: 'DELETE', body: JSON.stringify({ delete: true }) } : { method: 'DELETE' };
        if (options.body) {
          options.headers = { 'Content-Type': 'application/json' };
        }
        const data = await request(`/lobbies/${encodeURIComponent(lobbyId)}`, options);
        return data || {};
      },
      async members(lobbyId) {
        return withLobby(lobbyId, () => request(`/lobbies/${encodeURIComponent(lobbyId)}/members`));
      },
      async updateMember(lobbyId, memberId, role) {
        return request(`/lobbies/${encodeURIComponent(lobbyId)}/members/${encodeURIComponent(memberId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
      },
      async removeMember(lobbyId, memberId) {
        return request(`/lobbies/${encodeURIComponent(lobbyId)}/members/${encodeURIComponent(memberId)}`, {
          method: 'DELETE',
        });
      },
    },
  };
})();

const localization = (() => {
  const DEFAULT_LOCALE = 'de';
  const SUPPORTED_LOCALES = new Set(['de', 'en']);
  const LOCALE_STORAGE_KEY = 'werwolfLocalePreference';
  const catalogs = new Map();
  const listeners = new Set();
  const pluralRules = new Map();
  let activeLocale = DEFAULT_LOCALE;
  let fallbackLocale = DEFAULT_LOCALE;
  let preference = 'system';
  let initPromise = null;
  let hasInitialized = false;

  function normalizeLocale(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    if (SUPPORTED_LOCALES.has(trimmed)) {
      return trimmed;
    }
    const parts = trimmed.split('-');
    if (parts.length > 1 && SUPPORTED_LOCALES.has(parts[0])) {
      return parts[0];
    }
    return null;
  }

  function normalizePreference(value) {
    if (value === null || value === undefined) {
      return 'system';
    }
    if (typeof value === 'string') {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === 'system' || trimmed === '') {
        return 'system';
      }
      const normalized = normalizeLocale(trimmed);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  function detectPreferredLocale() {
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test') {
      return DEFAULT_LOCALE;
    }
    if (typeof navigator !== 'undefined') {
      if (typeof navigator.userAgent === 'string' && navigator.userAgent.includes('jsdom')) {
        return DEFAULT_LOCALE;
      }
      const candidates = Array.isArray(navigator.languages)
        ? navigator.languages
        : (navigator.language ? [navigator.language] : []);
      for (const candidate of candidates) {
        const normalized = normalizeLocale(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }
    return DEFAULT_LOCALE;
  }

  function getNestedValue(target, key) {
    if (!target || typeof key !== 'string') {
      return undefined;
    }
    return key.split('.').reduce((acc, part) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
        return acc[part];
      }
      return undefined;
    }, target);
  }

  function getLocaleChain() {
    const chain = [activeLocale];
    if (fallbackLocale && fallbackLocale !== activeLocale) {
      chain.push(fallbackLocale);
    }
    return chain;
  }

  async function fetchJson(path) {
    if (typeof fetch !== 'function') {
      return null;
    }
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`Lokalisierungsdatei ${path} konnte nicht geladen werden.`, error);
      return null;
    }
  }

  async function ensureCatalog(locale) {
    if (!locale || catalogs.has(locale)) {
      return catalogs.get(locale) || null;
    }
    const [messages, gameplay] = await Promise.all([
      fetchJson(`/locales/${encodeURIComponent(locale)}/messages.json`),
      fetchJson(`/locales/${encodeURIComponent(locale)}/gameplay.json`)
    ]);
    const catalog = {
      messages: messages?.messages || {},
      gameplay: gameplay || {}
    };
    catalogs.set(locale, catalog);
    return catalog;
  }

  function getPluralRules(locale) {
    if (!pluralRules.has(locale)) {
      try {
        pluralRules.set(locale, new Intl.PluralRules(locale));
      } catch (error) {
        pluralRules.set(locale, new Intl.PluralRules(DEFAULT_LOCALE));
      }
    }
    return pluralRules.get(locale);
  }

  function formatPlaceholders(template, params) {
    if (!template || typeof template !== 'string') {
      return template;
    }
    if (!params || typeof params !== 'object') {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, token) => {
      if (Object.prototype.hasOwnProperty.call(params, token)) {
        const value = params[token];
        return value === undefined || value === null ? '' : String(value);
      }
      return match;
    });
  }

  function selectVariant(entry, params, locale) {
    if (entry === null || entry === undefined) {
      return null;
    }
    if (typeof entry === 'string') {
      return entry;
    }
    if (typeof entry !== 'object') {
      return null;
    }

    const { count, gender } = params || {};
    let candidate = null;

    if (typeof count === 'number') {
      const rules = getPluralRules(locale);
      const category = rules.select(count);
      if (Object.prototype.hasOwnProperty.call(entry, category)) {
        candidate = entry[category];
      }
      if (candidate === null || candidate === undefined) {
        candidate = entry.other;
      }
    }

    if ((candidate === null || candidate === undefined) && typeof gender === 'string') {
      const normalizedGender = gender.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(entry, normalizedGender)) {
        candidate = entry[normalizedGender];
      }
      if (candidate === null || candidate === undefined) {
        candidate = entry.other;
      }
    }

    if (candidate === null || candidate === undefined) {
      candidate = entry.other !== undefined ? entry.other : null;
    }

    if (candidate && typeof candidate === 'object') {
      return selectVariant(candidate, params, locale);
    }

    return candidate || null;
  }

  function formatMessageForLocale(locale, key, params) {
    if (!locale || !key) {
      return null;
    }
    const catalog = catalogs.get(locale);
    if (!catalog) {
      return null;
    }
    const raw = getNestedValue(catalog.messages, key);
    if (raw === null || raw === undefined) {
      return null;
    }
    const variant = selectVariant(raw, params, locale);
    if (typeof variant !== 'string') {
      return null;
    }
    return formatPlaceholders(variant, params);
  }

  function resolveGameplayEntry(type, id) {
    if (!id || !type) {
      return null;
    }
    const chain = getLocaleChain();
    for (const locale of chain) {
      const catalog = catalogs.get(locale);
      const entry = catalog?.gameplay?.[type]?.[id];
      if (entry) {
        return { locale, entry };
      }
    }
    return null;
  }

  function formatGameplayString(type, id, field, params) {
    const resolved = resolveGameplayEntry(type, id);
    if (!resolved) {
      return null;
    }
    const value = resolved.entry?.[field];
    const variant = selectVariant(value, params, resolved.locale);
    if (typeof variant !== 'string') {
      return null;
    }
    return formatPlaceholders(variant, params);
  }

  function getRoleDisplayName(roleName, params = {}) {
    const formatted = formatGameplayString('roles', roleName, 'displayName', params);
    return formatted || roleName;
  }

  function getRoleDescription(roleName, params = {}) {
    return formatGameplayString('roles', roleName, 'description', params);
  }

  function getRoleAbilities(roleName, params = {}) {
    const resolved = resolveGameplayEntry('roles', roleName);
    if (!resolved) {
      return [];
    }
    const abilities = Array.isArray(resolved.entry?.abilities) ? resolved.entry.abilities : [];
    return abilities
      .map((ability) => selectVariant(ability?.text, params, resolved.locale))
      .filter((text) => typeof text === 'string' && text.trim().length > 0)
      .map((text) => formatPlaceholders(text, params));
  }

  function getJobDisplayName(jobName, params = {}) {
    const formatted = formatGameplayString('jobs', jobName, 'displayName', params);
    return formatted || jobName;
  }

  function getJobDescription(jobName, params = {}) {
    return formatGameplayString('jobs', jobName, 'description', params);
  }

  function getEventStrings(eventId, params = {}) {
    const resolved = resolveGameplayEntry('events', eventId);
    if (!resolved) {
      return null;
    }
    const { locale, entry } = resolved;
    const formatField = (field) => {
      const variant = selectVariant(entry?.[field], params, locale);
      return typeof variant === 'string' ? formatPlaceholders(variant, params) : null;
    };
    const logLabel = selectVariant(entry?.log?.label, params, locale);
    const logDetail = selectVariant(entry?.log?.detail, params, locale);
    return {
      label: formatField('label'),
      description: formatField('description'),
      note: formatField('note'),
      message: formatField('message'),
      preview: formatField('preview'),
      log: (logLabel || logDetail)
        ? {
            label: logLabel ? formatPlaceholders(logLabel, params) : null,
            detail: logDetail ? formatPlaceholders(logDetail, params) : null,
          }
        : null,
    };
  }

  function getLogTemplate(key) {
    const resolved = resolveGameplayEntry('logs', key);
    if (!resolved) {
      return null;
    }
    const { locale, entry } = resolved;
    const labelVariant = selectVariant(entry?.label, {}, locale);
    const detailVariant = selectVariant(entry?.detail, {}, locale);
    return {
      label: typeof labelVariant === 'string' ? labelVariant : null,
      detail: typeof detailVariant === 'string' ? detailVariant : null,
    };
  }

  function collectTranslatableNodes(root) {
    if (!root) {
      return [];
    }
    if (root === document) {
      return Array.from(document.querySelectorAll('[data-i18n-key]'));
    }
    if (root instanceof Element || root instanceof DocumentFragment) {
      const nodes = [];
      if (root instanceof Element && root.hasAttribute('data-i18n-key')) {
        nodes.push(root);
      }
      nodes.push(...root.querySelectorAll('[data-i18n-key]'));
      return nodes;
    }
    return [];
  }

  function applyTranslations(root = document) {
    if (typeof document === 'undefined' || !root) {
      return;
    }
    const nodes = collectTranslatableNodes(root);
    nodes.forEach((node) => {
      const key = node.getAttribute('data-i18n-key');
      if (!key) {
        return;
      }
      const attr = node.getAttribute('data-i18n-attr');
      const paramsAttr = node.getAttribute('data-i18n-params');
      let params = {};
      if (paramsAttr) {
        try {
          params = JSON.parse(paramsAttr);
        } catch (error) {
          params = {};
        }
      }
      const message = t(key, params);
      if (message === null || message === undefined) {
        return;
      }
      if (!attr || attr === 'text') {
        node.textContent = message;
      } else if (attr === 'html') {
        node.innerHTML = message;
      } else {
        node.setAttribute(attr, message);
      }
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', activeLocale || DEFAULT_LOCALE);
    }
  }

  function setNodeTranslation(node, key, params = null, { attr = 'text' } = {}) {
    if (!node) {
      return;
    }
    if (!key) {
      node.removeAttribute('data-i18n-key');
      node.removeAttribute('data-i18n-attr');
      node.removeAttribute('data-i18n-params');
      if ('textContent' in node) {
        node.textContent = '';
      }
      return;
    }
    node.setAttribute('data-i18n-key', key);
    if (attr && attr !== 'text') {
      node.setAttribute('data-i18n-attr', attr);
    } else {
      node.removeAttribute('data-i18n-attr');
    }
    if (params && typeof params === 'object' && Object.keys(params).length > 0) {
      node.setAttribute('data-i18n-params', JSON.stringify(params));
    } else {
      node.removeAttribute('data-i18n-params');
    }
    applyTranslations(node instanceof Element ? node : undefined);
  }

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener(activeLocale);
      } catch (error) {
        console.error('Fehler beim Lokalisierungslistener:', error);
      }
    });
  }

  async function applyLocale(locale, { silent = false } = {}) {
    const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
    await ensureCatalog(normalized);
    activeLocale = normalized;
    if (!silent) {
      applyTranslations();
      notify();
    }
    return activeLocale;
  }

  async function persistPreference(value) {
    if (!apiClient?.storage) {
      return;
    }
    try {
      if (!value || value === 'system') {
        await apiClient.storage.removeItem(LOCALE_STORAGE_KEY);
      } else {
        await apiClient.storage.setItem(LOCALE_STORAGE_KEY, value);
      }
    } catch (error) {
      console.error('Sprachpräferenz konnte nicht gespeichert werden.', error);
    }
    if (apiClient?.locale?.set) {
      try {
        await apiClient.locale.set(value === 'system' ? null : value);
      } catch (error) {
        console.error('Serverseitige Sprachpräferenz konnte nicht gespeichert werden.', error);
      }
    }
  }

  async function setPreferredLocale(next, { persist = true, silent = false } = {}) {
    const normalized = normalizePreference(next);
    if (normalized === null) {
      return activeLocale;
    }
    preference = normalized;
    if (preference === 'system') {
      const detected = detectPreferredLocale();
      await applyLocale(detected, { silent });
      if (persist) {
        await persistPreference('system');
      }
      return detected;
    }
    await applyLocale(preference, { silent });
    if (persist) {
      await persistPreference(preference);
    }
    return activeLocale;
  }

  async function init() {
    if (initPromise) {
      return initPromise;
    }
    initPromise = (async () => {
      await ensureCatalog(fallbackLocale);
      let storedPreference = null;
      try {
        storedPreference = await apiClient.storage.getItem(LOCALE_STORAGE_KEY);
      } catch (error) {
        storedPreference = null;
      }
      let serverPreference = null;
      if (apiClient?.locale?.get) {
        try {
          const response = await apiClient.locale.get();
          if (response && typeof response.locale === 'string') {
            serverPreference = response.locale;
          }
        } catch (error) {
          serverPreference = null;
        }
      }
      const sourcePreference = serverPreference ?? storedPreference;
      const normalized = normalizePreference(sourcePreference);
      preference = normalized === null ? 'system' : normalized;
      if (preference === 'system') {
        await applyLocale(detectPreferredLocale(), { silent: true });
      } else {
        await applyLocale(preference, { silent: true });
      }
      applyTranslations();
      hasInitialized = true;
      return activeLocale;
    })();
    return initPromise;
  }

  function t(key, params = {}) {
    const chain = getLocaleChain();
    for (const locale of chain) {
      const message = formatMessageForLocale(locale, key, params);
      if (message !== null && message !== undefined) {
        return message;
      }
    }
    return null;
  }

  function onChange(listener) {
    if (typeof listener === 'function') {
      listeners.add(listener);
      if (hasInitialized) {
        try {
          listener(activeLocale);
        } catch (error) {
          console.error('Fehler beim Lokalisierungslistener:', error);
        }
      }
    }
    return () => listeners.delete(listener);
  }

  function getLocale() {
    return activeLocale;
  }

  function getPreference() {
    return preference;
  }

  return {
    init,
    t,
    applyTranslations,
    setNodeTranslation,
    setPreferredLocale,
    getLocale,
    getPreference,
    onChange,
    getRoleDisplayName,
    getRoleDescription,
    getRoleAbilities,
    getJobDisplayName,
    getJobDescription,
    getEventStrings,
    getLogTemplate,
    formatGameplayString,
    getLocaleChain,
    getSupportedLocales: () => Array.from(SUPPORTED_LOCALES),
    getFallbackLocale: () => fallbackLocale,
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

  localization.onChange(() => {
    updateUserChip();
  });

  function clearMessage() {
    if (!authMessage) {
      return;
    }
    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }
    localization.setNodeTranslation(authMessage, null);
    authMessage.textContent = '';
    authMessage.classList.remove('visible', 'error', 'success', 'info');
    authMessage.removeAttribute('data-variant');
  }

  function setMessage(message, variant = 'info', { persist = false } = {}) {
    if (!authMessage) {
      return;
    }

    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }

    let resolvedText = '';
    if (message && typeof message === 'object' && typeof message.key === 'string') {
      localization.setNodeTranslation(authMessage, message.key, message.params || null);
      resolvedText = localization.t(message.key, message.params || {}) || '';
    } else {
      localization.setNodeTranslation(authMessage, null);
      resolvedText = typeof message === 'string' ? message : '';
    }

    authMessage.textContent = resolvedText;
    authMessage.dataset.variant = variant;
    authMessage.classList.add('visible');
    authMessage.classList.remove('error', 'success', 'info');
    authMessage.classList.add(variant);

    if (!persist) {
      messageTimeout = setTimeout(() => {
        if (authMessage) {
          localization.setNodeTranslation(authMessage, null);
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
        localization.setNodeTranslation(userRoleEl, null);
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
      const fallbackName =
        localization.t('user.displayName.fallback') || 'Spielleitung';
      userNameEl.textContent = currentUser.displayName || currentUser.email || fallbackName;
    }
    if (userRoleEl) {
      if (currentUser.isAdmin) {
        localization.setNodeTranslation(userRoleEl, 'user.role.admin');
        userRoleEl.classList.remove('hidden');
      } else {
        localization.setNodeTranslation(userRoleEl, null);
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

    if (lobbyManager && typeof lobbyManager.handleUserChange === 'function') {
      lobbyManager.handleUserChange(currentUser, { refreshCaches: shouldRefreshCaches });
    }

    updateUserChip();

    if (currentUser) {
      if (Object.prototype.hasOwnProperty.call(currentUser, 'locale')) {
        const preferred = currentUser.locale || 'system';
        localization.setPreferredLocale(preferred, { persist: false }).catch((error) => {
          console.error('Lokalisierung konnte nicht mit dem Benutzerprofil synchronisiert werden.', error);
        });
      }
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
    } else {
      setMessage({ key: 'auth.errors.unauthorized' }, 'error', { persist: true });
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
        setMessage({ key: 'auth.errors.missingCredentials' }, 'error');
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
          setMessage({ key: 'auth.login.failure' }, 'error', { persist: true });
        }
      } catch (error) {
        setMessage(error?.message || { key: 'auth.login.failure' }, 'error', { persist: true });
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
        setMessage({ key: 'auth.errors.missingRegistrationFields' }, 'error');
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
          setMessage({ key: 'auth.register.failure' }, 'error', { persist: true });
        }
      } catch (error) {
        setMessage(error?.message || { key: 'auth.register.failure' }, 'error', { persist: true });
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
        setMessage({ key: 'auth.logout.success' }, 'info');
      } catch (error) {
        setMessage(error?.message || { key: 'auth.logout.failure' }, 'error', { persist: true });
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
      setMessage({ key: 'auth.login.required' }, 'info');
    } catch (error) {
      if (error?.status && error.status !== 401) {
        setMessage(error.message || { key: 'auth.login.unavailable' }, 'error', { persist: true });
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

let currentThemeVariant = 'light';
let themePreferenceStored = false;
let themeState = { selection: null, resolved: {}, preset: null, presetsVersion: null };
let themePresets = [];
let latestThemeWarnings = [];
let themeConfiguratorInitialized = false;
const appliedThemeVariables = new Set();
let activeBackgroundCheck = null;
let themeRealtimeSource = null;
let pendingThemePreview = null;
const MAX_THEME_UPLOAD_BYTES = 1024 * 1024 * 1.5;
const THEME_HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;
let configuratorPreviewWarnings = [];
const previewAppliedVariables = new Set();
let themePresetSelect = null;
let themeVariantSelect = null;
let themeAccentInput = null;
let themeBackgroundUrlInput = null;
let themeBackgroundUploadInput = null;
let themeBackgroundStatus = null;
let themeSaveBtn = null;
let themeResetBtn = null;
let themePreviewCard = null;
let themeRealtimeReconnectTimer = null;
let themeRealtimeRetryCount = 0;
let themeRealtimeLastLobby = null;

const THEME_REALTIME_RETRY_BASE_MS = 2000;
const THEME_REALTIME_RETRY_MAX_MS = 30000;

function clearThemeRealtimeTimer() {
  if (themeRealtimeReconnectTimer) {
    clearTimeout(themeRealtimeReconnectTimer);
    themeRealtimeReconnectTimer = null;
  }
}

function disconnectThemeRealtime(options = {}) {
  if (themeRealtimeSource) {
    try {
      themeRealtimeSource.close();
    } catch (error) {
      // ignore disconnect errors
    }
    themeRealtimeSource = null;
  }
  if (!options.keepTimer) {
    clearThemeRealtimeTimer();
  }
  if (!options.preserveAttempts) {
    themeRealtimeRetryCount = 0;
  }
}

function normalizeThemeLobby(lobby) {
  if (lobby && typeof lobby === 'object' && typeof lobby.id === 'number' && !lobby.isPersonal) {
    return { id: lobby.id, isPersonal: false };
  }
  return { id: null, isPersonal: true };
}

function scheduleThemeRealtimeReconnect() {
  if (!themeRealtimeLastLobby || themeRealtimeReconnectTimer) {
    return;
  }
  const attempt = Math.max(0, themeRealtimeRetryCount);
  const delay = Math.min(
    THEME_REALTIME_RETRY_MAX_MS,
    THEME_REALTIME_RETRY_BASE_MS * Math.max(1, 2 ** attempt),
  );
  themeRealtimeReconnectTimer = setTimeout(() => {
    themeRealtimeReconnectTimer = null;
    connectThemeRealtime(themeRealtimeLastLobby, { fromRetry: true });
  }, delay);
  themeRealtimeRetryCount = attempt + 1;
}

function connectThemeRealtime(lobby, options = {}) {
  if (typeof EventSource !== 'function') {
    return;
  }
  const { fromRetry = false } = options;
  const normalizedLobby = normalizeThemeLobby(lobby);
  themeRealtimeLastLobby = normalizedLobby;
  if (!fromRetry) {
    themeRealtimeRetryCount = 0;
  }
  clearThemeRealtimeTimer();
  disconnectThemeRealtime({ keepTimer: true, preserveAttempts: true });
  const params = new URLSearchParams();
  if (normalizedLobby.isPersonal) {
    params.set('lobby', 'personal');
  } else {
    params.set('lobby', String(normalizedLobby.id));
  }
  const url = `/api/realtime?${params.toString()}`;
  try {
    const source = new EventSource(url, { withCredentials: true });
    source.addEventListener('open', () => {
      themeRealtimeRetryCount = 0;
      clearThemeRealtimeTimer();
    });
    source.addEventListener('theme', (event) => {
      try {
        const data = JSON.parse(event.data || '{}');
        updateThemeState(data, { markPreference: true });
      } catch (error) {
        console.error('Theme-Update konnte nicht verarbeitet werden.', error);
      }
    });
    source.addEventListener('error', () => {
      // allow EventSource to retry, but drop reference if closed
      if (source.readyState === EventSource.CLOSED) {
        disconnectThemeRealtime({ preserveAttempts: true });
        scheduleThemeRealtimeReconnect();
      }
    });
    themeRealtimeSource = source;
  } catch (error) {
    console.error('Echtzeitkanal konnte nicht geöffnet werden.', error);
    scheduleThemeRealtimeReconnect();
  }
}

function cloneThemeJson(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (error) {
      // fallback
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function sanitizeThemeVariant(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'dark' || normalized === 'light') {
    return normalized;
  }
  return null;
}

function setThemeVariable(name, value) {
  if (typeof name !== 'string' || !name.startsWith('--')) {
    return;
  }
  const themedName = `--theme-${name.slice(2)}`;
  if (value === undefined || value === null) {
    document.documentElement.style.removeProperty(themedName);
    appliedThemeVariables.delete(themedName);
    return;
  }
  document.documentElement.style.setProperty(themedName, value);
  appliedThemeVariables.add(themedName);
}

function clearAppliedThemeVariables() {
  appliedThemeVariables.forEach((name) => {
    document.documentElement.style.removeProperty(name);
  });
  appliedThemeVariables.clear();
}

function extractUrlFromCss(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/url\((?:"([^\"]*)"|'([^']*)'|([^)]*))\)/);
  if (!match) {
    return null;
  }
  return match[1] || match[2] || match[3] || null;
}

function toCssUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const sanitized = value.replace(/"/g, '\\"');
  return `url("${sanitized}")`;
}

function parseThemeHexColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(THEME_HEX_COLOR_REGEX);
  if (!match) {
    return null;
  }
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function formatThemeRgba(color, alpha = 1) {
  const normalized = Math.min(1, Math.max(0, alpha));
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(normalized.toFixed(3))})`;
}

function adjustThemeColor(color, amount) {
  const ratio = Math.min(1, Math.max(-1, amount));
  const adjustChannel = (channel) => {
    if (ratio >= 0) {
      return Math.round(channel + (255 - channel) * ratio);
    }
    return Math.round(channel + channel * ratio);
  };
  return {
    r: Math.min(255, Math.max(0, adjustChannel(color.r))),
    g: Math.min(255, Math.max(0, adjustChannel(color.g))),
    b: Math.min(255, Math.max(0, adjustChannel(color.b))),
  };
}

function mixThemeColors(color, target, amount) {
  const ratio = Math.min(1, Math.max(0, amount));
  return {
    r: Math.round(color.r + (target.r - color.r) * ratio),
    g: Math.round(color.g + (target.g - color.g) * ratio),
    b: Math.round(color.b + (target.b - color.b) * ratio),
  };
}

function srgbChannelToLinearTheme(value) {
  const channel = value / 255;
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return ((channel + 0.055) / 1.055) ** 2.4;
}

function themeContrastRatio(colorA, colorB) {
  const lumA = 0.2126 * srgbChannelToLinearTheme(colorA.r)
    + 0.7152 * srgbChannelToLinearTheme(colorA.g)
    + 0.0722 * srgbChannelToLinearTheme(colorA.b);
  const lumB = 0.2126 * srgbChannelToLinearTheme(colorB.r)
    + 0.7152 * srgbChannelToLinearTheme(colorB.g)
    + 0.0722 * srgbChannelToLinearTheme(colorB.b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function sanitizeAccentInput(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!THEME_HEX_COLOR_REGEX.test(trimmed)) {
    return null;
  }
  return `#${trimmed.slice(1).toLowerCase()}`;
}

function sanitizeBackgroundInputClient(value) {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('data:image/')) {
      if (trimmed.length > MAX_THEME_UPLOAD_BYTES) {
        return null;
      }
      return { type: 'upload', value: trimmed };
    }
    const normalized = trimmed.replace(/\s+/g, '');
    if (!/^https?:\/\//i.test(normalized)) {
      return null;
    }
    return { type: 'url', value: normalized };
  }
  if (value && typeof value === 'object') {
    if (value.type === 'upload' && typeof value.value === 'string') {
      return sanitizeBackgroundInputClient(value.value);
    }
    if (value.type === 'url' && typeof value.value === 'string') {
      return sanitizeBackgroundInputClient(value.value);
    }
  }
  return null;
}

function buildPreviewAccentOverrides(accentRgb, variantKey) {
  const baseAlpha = variantKey === 'dark' ? 0.88 : 0.88;
  const hoverAlpha = variantKey === 'dark' ? 0.9 : 0.92;
  const start = adjustThemeColor(accentRgb, 0.12);
  const strongLight = mixThemeColors(accentRgb, { r: 255, g: 255, b: 255 }, 0.45);
  const hoverStart = adjustThemeColor(accentRgb, -0.08);
  const hoverEnd = adjustThemeColor(accentRgb, -0.2);
  const glowBase = mixThemeColors(accentRgb, { r: 255, g: 255, b: 255 }, 0.35);
  const lightGlowAlpha = variantKey === 'dark' ? 0.28 : 0.24;
  const shadowAlpha = variantKey === 'dark' ? 0.32 : 0.28;
  const hoverShadowAlpha = shadowAlpha + 0.04;
  return {
    '--button-bg': formatThemeRgba(accentRgb, baseAlpha),
    '--button-hover': formatThemeRgba(hoverStart, hoverAlpha),
    '--glass-button-bg-start': formatThemeRgba(start, variantKey === 'dark' ? 0.94 : 0.95),
    '--glass-button-bg-end': formatThemeRgba(accentRgb, variantKey === 'dark' ? 0.88 : 0.85),
    '--glass-button-hover-start': formatThemeRgba(hoverStart, 0.98),
    '--glass-button-hover-end': formatThemeRgba(hoverEnd, 0.92),
    '--glass-button-border': formatThemeRgba(strongLight, variantKey === 'dark' ? 0.45 : 0.58),
    '--glass-button-shadow': `0 20px 36px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Number(shadowAlpha.toFixed(3))}), 0 12px 24px rgba(15, 35, 22, 0.2)` ,
    '--glass-button-hover-shadow': `0 26px 44px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Number(hoverShadowAlpha.toFixed(3))}), 0 14px 28px rgba(15, 35, 22, 0.22)` ,
    '--glass-focus-ring': formatThemeRgba(accentRgb, variantKey === 'dark' ? 0.6 : 0.52),
    '--glow-color': formatThemeRgba(glowBase, lightGlowAlpha),
  };
}

function getPresetById(presetId) {
  if (!Array.isArray(themePresets) || themePresets.length === 0) {
    return null;
  }
  return themePresets.find((preset) => preset.id === presetId) || themePresets[0];
}

function resolvePreviewTheme(selection) {
  const preset = getPresetById(selection.presetId);
  if (!preset) {
    return { preset: null, resolved: {}, warnings: [] };
  }
  const resolved = {};
  const warnings = [];
  const accentHex = sanitizeAccentInput(selection.custom?.accentColor);
  let accentRgb = accentHex ? parseThemeHexColor(accentHex) : null;
  if (accentRgb) {
    const contrast = themeContrastRatio(accentRgb, { r: 255, g: 255, b: 255 });
    if (contrast < 4.5) {
      warnings.push('Akzentfarbe wurde nicht übernommen, da der Kontrast zu gering ist.');
      accentRgb = null;
    }
  }
  const background = sanitizeBackgroundInputClient(selection.custom?.backgroundImage || null);
  Object.entries(preset.variants).forEach(([variantKey, variantConfig]) => {
    const variables = { ...variantConfig.variables };
    const assets = {
      presetBackgroundImage: variantConfig.variables['--bg-image'] || null,
      backgroundImage: null,
    };
    if (accentRgb) {
      Object.assign(variables, buildPreviewAccentOverrides(accentRgb, variantKey));
    }
    if (background && background.value) {
      const cssUrl = toCssUrl(background.value);
      if (cssUrl) {
        variables['--bg-image'] = cssUrl;
        assets.backgroundImage = { type: background.type || 'custom', source: background.value };
      }
    }
    resolved[variantKey] = { variables, assets };
  });
  return { preset, resolved, warnings };
}

function buildConfiguratorSelectionFromState() {
  const baseSelection = themeState?.selection ? cloneThemeJson(themeState.selection) : null;
  if (baseSelection) {
    baseSelection.custom = baseSelection.custom ? { ...baseSelection.custom } : {};
    return baseSelection;
  }
  const preset = themePresets?.[0];
  return {
    presetId: preset?.id || null,
    variant: 'light',
    custom: {},
  };
}

function setThemeBackgroundStatus(key) {
  if (!themeBackgroundStatus) {
    return;
  }
  if (localization && typeof localization.setNodeTranslation === 'function') {
    localization.setNodeTranslation(themeBackgroundStatus, key);
    return;
  }
  if (themeBackgroundStatus.setAttribute) {
    themeBackgroundStatus.setAttribute('data-i18n-key', key);
  }
  if (localization && typeof localization.t === 'function') {
    const message = localization.t(key);
    if (typeof message === 'string' && message) {
      themeBackgroundStatus.textContent = message;
      return;
    }
  }
  themeBackgroundStatus.textContent = key;
}

function refreshThemeConfigurator() {
  if (!themePresetSelect || !themeVariantSelect) {
    return;
  }
  if (!Array.isArray(themePresets) || themePresets.length === 0) {
    themePresetSelect.innerHTML = '<option>Keine Presets verfügbar</option>';
    themePresetSelect.disabled = true;
    themeVariantSelect.innerHTML = '';
    configuratorPreviewWarnings = [];
    updateThemeWarningsBanner();
    return;
  }
  themePresetSelect.disabled = false;
  if (!pendingThemePreview) {
    pendingThemePreview = buildConfiguratorSelectionFromState();
  }
  let activePreset = getPresetById(pendingThemePreview.presetId);
  if (!activePreset) {
    activePreset = getPresetById(null);
  }
  themePresetSelect.innerHTML = '';
  themePresets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name || preset.id;
    if (preset.id === activePreset?.id) {
      option.selected = true;
    }
    themePresetSelect.appendChild(option);
  });
  if (activePreset) {
    pendingThemePreview.presetId = activePreset.id;
  }

  themeVariantSelect.innerHTML = '';
  if (activePreset && activePreset.variants) {
    Object.entries(activePreset.variants).forEach(([variantKey, variantConfig]) => {
      const option = document.createElement('option');
      option.value = variantKey;
      option.textContent = variantConfig?.label || (variantKey === 'dark' ? 'Nacht' : 'Tag');
      themeVariantSelect.appendChild(option);
    });
    if (!activePreset.variants[pendingThemePreview.variant]) {
      pendingThemePreview.variant = Object.keys(activePreset.variants)[0] || 'light';
    }
  }
  themeVariantSelect.value = sanitizeThemeVariant(pendingThemePreview.variant) || 'light';

  if (themeAccentInput) {
    const accent = sanitizeAccentInput(pendingThemePreview.custom?.accentColor)
      || activePreset?.preview?.accent
      || '#22c55e';
    themeAccentInput.value = accent;
  }

  if (themeBackgroundUrlInput) {
    if (pendingThemePreview.custom?.backgroundImage?.type === 'url') {
      themeBackgroundUrlInput.value = pendingThemePreview.custom.backgroundImage.value;
    } else {
      themeBackgroundUrlInput.value = '';
    }
  }
  if (themeBackgroundUploadInput) {
    themeBackgroundUploadInput.value = '';
  }
  if (themeBackgroundStatus) {
    if (!pendingThemePreview.custom?.backgroundImage) {
      setThemeBackgroundStatus('settings.theme.backgroundStatus.preset');
    } else if (pendingThemePreview.custom.backgroundImage.type === 'upload') {
      setThemeBackgroundStatus('settings.theme.backgroundStatus.upload');
    } else {
      setThemeBackgroundStatus('settings.theme.backgroundStatus.url');
    }
  }

  themeConfiguratorInitialized = true;
  updateThemeConfiguratorPreview();
}

function updateThemeConfiguratorPreview() {
  if (!themePreviewCard) {
    configuratorPreviewWarnings = [];
    updateThemeWarningsBanner();
    return;
  }
  if (!pendingThemePreview) {
    pendingThemePreview = buildConfiguratorSelectionFromState();
  }
  const selection = cloneThemeJson(pendingThemePreview);
  selection.custom = selection.custom ? { ...selection.custom } : {};
  const preview = resolvePreviewTheme(selection);
  configuratorPreviewWarnings = preview.warnings || [];
  const variantKey = sanitizeThemeVariant(selection.variant) || 'light';
  const resolvedVariant = preview.resolved?.[variantKey] || preview.resolved?.light || null;

  previewAppliedVariables.forEach((name) => {
    themePreviewCard.style.removeProperty(name);
  });
  previewAppliedVariables.clear();

  if (resolvedVariant && resolvedVariant.variables) {
    Object.entries(resolvedVariant.variables).forEach(([key, value]) => {
      if (typeof value === 'string') {
        const themedName = `--theme-${key.slice(2)}`;
        themePreviewCard.style.setProperty(themedName, value);
        previewAppliedVariables.add(themedName);
      }
    });
  }

  updateThemeWarningsBanner();
}

function applyThemeVariables(resolvedVariant) {
  if (!resolvedVariant || typeof resolvedVariant !== 'object') {
    return;
  }
  clearAppliedThemeVariables();
  const variables = resolvedVariant.variables || {};
  Object.entries(variables).forEach(([key, value]) => {
    if (typeof value === 'string') {
      setThemeVariable(key, value);
    }
  });
}

function verifyThemeBackground(variantKey, resolvedVariant) {
  if (activeBackgroundCheck && typeof activeBackgroundCheck.loader?.removeAttribute === 'function') {
    // nothing to clean explicitly; we'll simply allow GC to collect
  }
  activeBackgroundCheck = null;
  const asset = resolvedVariant?.assets?.backgroundImage;
  const presetBackground = resolvedVariant?.assets?.presetBackgroundImage || null;
  const cssValue = resolvedVariant?.variables?.['--bg-image'];
  const url = extractUrlFromCss(cssValue);
  if (!asset || !asset.source || !url || url.startsWith('data:')) {
    return;
  }
  const loader = new Image();
  activeBackgroundCheck = { loader, variant: variantKey, preset: presetBackground };
  loader.onload = () => {
    if (activeBackgroundCheck?.loader === loader) {
      activeBackgroundCheck = null;
    }
  };
  loader.onerror = () => {
    if (activeBackgroundCheck?.loader !== loader) {
      return;
    }
    const fallback = activeBackgroundCheck.preset;
    activeBackgroundCheck = null;
    if (currentThemeVariant === variantKey && typeof fallback === 'string') {
      setThemeVariable('--bg-image', fallback);
    }
  };
  try {
    loader.src = url;
  } catch (error) {
    if (activeBackgroundCheck?.loader === loader) {
      activeBackgroundCheck = null;
    }
  }
}

function getResolvedThemeVariant(variant) {
  if (!themeState || !themeState.resolved) {
    return null;
  }
  return themeState.resolved[variant] || null;
}

function applyThemeVariant(variant) {
  const sanitized = sanitizeThemeVariant(variant) || 'light';
  const resolved = getResolvedThemeVariant(sanitized);
  if (resolved) {
    applyThemeVariables(resolved);
    verifyThemeBackground(sanitized, resolved);
  }
  document.documentElement.setAttribute('data-theme', sanitized);
  currentThemeVariant = sanitized;
  updateThemeConfiguratorPreview();
}

function updateThemeWarningsBanner() {
  if (!themeConfiguratorInitialized) {
    return;
  }
  const warningContainer = document.getElementById('theme-warning-list');
  const warningWrapper = document.getElementById('theme-warning-container');
  if (!warningContainer || !warningWrapper) {
    return;
  }
  warningContainer.innerHTML = '';
  const combinedWarnings = [...new Set([...(latestThemeWarnings || []), ...(configuratorPreviewWarnings || [])])]
    .filter((warning) => typeof warning === 'string' && warning.trim().length > 0);
  if (combinedWarnings.length === 0) {
    warningWrapper.classList.add('hidden');
    return;
  }
  combinedWarnings.forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = typeof warning === 'string' ? warning : 'Theme-Hinweis verfügbar.';
    warningContainer.appendChild(item);
  });
  warningWrapper.classList.remove('hidden');
}

function updateThemeState(newState, { markPreference = true, silent = false } = {}) {
  if (!newState || typeof newState !== 'object') {
    return;
  }
  pendingThemePreview = null;
  themeState = {
    selection: newState.selection ? cloneThemeJson(newState.selection) : null,
    resolved: newState.resolved ? cloneThemeJson(newState.resolved) : {},
    preset: newState.preset ? cloneThemeJson(newState.preset) : null,
    presetsVersion: typeof newState.presetsVersion === 'number' ? newState.presetsVersion : (themeState?.presetsVersion || null),
  };
  latestThemeWarnings = Array.isArray(newState.warnings) ? [...newState.warnings] : [];
  const variant = sanitizeThemeVariant(themeState.selection?.variant) || currentThemeVariant;
  applyThemeVariant(variant);
  themePreferenceStored = Boolean(themeState.selection?.updatedAt);
  if (!silent) {
    try {
      apiClient.theme.setCachedState(themeState);
    } catch (error) {
      // cache update failures are non-critical
    }
  }
  refreshThemeConfigurator();
  updateThemeWarningsBanner();
}

async function setTheme(variant, { persist = true, markPreference = true } = {}) {
  const sanitized = sanitizeThemeVariant(variant) || 'light';
  const previousVariant = currentThemeVariant;
  applyThemeVariant(sanitized);
  if (!persist) {
    if (themeState.selection) {
      themeState.selection.variant = sanitized;
    }
    if (markPreference) {
      themePreferenceStored = true;
    }
    return sanitized;
  }

  try {
    const state = await apiClient.theme.set({ variant: sanitized });
    updateThemeState(state, { markPreference });
    return sanitized;
  } catch (error) {
    applyThemeVariant(previousVariant);
    themePreferenceStored = false;
    throw error;
  }
}

async function initTheme() {
  try {
    const presetResponse = await apiClient.theme.presets();
    if (presetResponse && Array.isArray(presetResponse.presets)) {
      themePresets = presetResponse.presets;
    }
  } catch (error) {
    console.error('Theme-Presets konnten nicht geladen werden.', error);
    const cached = apiClient.theme.getCachedPresets();
    if (cached && Array.isArray(cached.presets)) {
      themePresets = cached.presets;
    }
  }

  const cachedState = apiClient.theme.getCachedState();
  if (cachedState && cachedState.selection) {
    updateThemeState(cachedState, { silent: true });
  }

  try {
    const state = await apiClient.theme.get();
    updateThemeState(state, { markPreference: true });
    return currentThemeVariant;
  } catch (error) {
    console.error('Theme konnte nicht geladen werden.', error);
  }

  if (themeState.selection) {
    return currentThemeVariant;
  }

  themePreferenceStored = false;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const fallbackVariant = prefersDark ? 'dark' : 'light';
  try {
    await setTheme(fallbackVariant, { persist: false, markPreference: false });
  } catch (error) {
    console.error('Theme konnte nicht gespeichert werden.', error);
  }
  return currentThemeVariant;
}

document.addEventListener("DOMContentLoaded", async () => {
  authManager = createAuthManager();
  lobbyManager = createLobbyManager();

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
    'werwolfLastUsed',
    'werwolfLocalePreference'
  ];

  let latestLobbySnapshot = null;
  let canEditActiveLobby = false;
  let lobbyUiInitialized = false;
  let pendingSessionReload = false;
  const READ_ONLY_HINT = 'Du hast nur Leserechte in dieser Lobby.';
  let localeSelect = null;
  let roleSchemaReady = false;
  let eventDefinitionsReady = false;
  let phoenixPulseStatus = null;

  try {
    await localization.init();
  } catch (error) {
    console.error('Lokalisierung konnte nicht initialisiert werden.', error);
  }
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.includes('jsdom')) {
    try {
      await localization.setPreferredLocale('de', { persist: false, silent: true });
    } catch (error) {
      // ignore test environment locale adjustments
    }
  }

  function updateReadOnlyClass() {
    const shouldMarkReadOnly = Boolean(latestLobbySnapshot && !canEditActiveLobby);
    document.body.classList.toggle('lobby-readonly', shouldMarkReadOnly);
  }

  function updateWriteControlsState() {
    if (!lobbyUiInitialized) {
      return;
    }
    if (typeof applyLobbyWriteState === 'function') {
      applyLobbyWriteState(canEditActiveLobby);
    }
  }

  function syncLocaleSelector() {
    if (!localeSelect) {
      return;
    }
    const preference = localization.getPreference();
    if (preference === 'system') {
      localeSelect.value = 'system';
    } else {
      localeSelect.value = preference || localization.getLocale() || 'system';
    }
  }

  syncLocaleSelector();

  if (localeSelect) {
    localeSelect.addEventListener('change', async (event) => {
      const selected = event.target.value;
      try {
        await localization.setPreferredLocale(selected);
      } catch (error) {
        console.error('Sprachpräferenz konnte nicht aktualisiert werden.', error);
      }
    });
  }

  localization.onChange(() => {
    localization.applyTranslations();
    syncLocaleSelector();
    if (roleSchemaReady) {
      refreshLocalizationCaches();
    }
  });

  async function syncLobbyContext(lobby) {
    latestLobbySnapshot = lobby ? { ...lobby } : null;
    canEditActiveLobby = Boolean(lobbyManager?.canWriteActiveLobby?.() ?? lobbyManager?.canEditActiveLobby?.());
    updateReadOnlyClass();

    if (latestLobbySnapshot) {
      try {
        await apiClient.storage.prefetch(storageKeysToPrefetch);
      } catch (error) {
        console.error('Persistente Werte konnten nicht geladen werden.', error);
      }
      if (lobbyUiInitialized) {
        loadSessions();
        pendingSessionReload = false;
      } else {
        pendingSessionReload = true;
      }
    } else if (lobbyUiInitialized && sessionsList) {
      sessionsList.innerHTML = '';
      const emptyItem = document.createElement('li');
      localization.setNodeTranslation(emptyItem, 'lobbies.emptySelection');
      sessionsList.appendChild(emptyItem);
      updateReplaySessionOptions([]);
      pendingSessionReload = false;
    }

    updateWriteControlsState();
    if (latestLobbySnapshot) {
      connectThemeRealtime(latestLobbySnapshot);
    } else {
      disconnectThemeRealtime();
    }
  }

  lobbyManager.onChange((lobby) => {
    syncLobbyContext(lobby);
  });

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

  try {
    await lobbyManager.initialize();
  } catch (error) {
    console.error('Lobbys konnten nicht initialisiert werden.', error);
  }

  await initTheme();
  let roleEditorState = null;
  let roleEditorDirty = false;
  let roleEditorReady = false;
  let roleEditorStatusEl = null;
  let roleEditorRolesEl = null;
  let roleEditorJobsEl = null;
  let roleEditorNightListEl = null;
  let roleEditorAddRoleBtn = null;
  let roleEditorAddJobBtn = null;
  let roleEditorAddNightStepBtn = null;
  let roleEditorSaveBtn = null;
  let roleEditorResetBtn = null;

  // Eingebettetes Standardschema als letzte Rückfallebene – synchron zu data/roles.json halten.
  const EMBEDDED_DEFAULT_ROLE_SCHEMA = Object.freeze({
    version: 1,
    categories: [
      { id: 'village', label: 'Dorfbewohner' },
      { id: 'werwolf', label: 'Werwölfe' },
      { id: 'special', label: 'Sonderrollen' }
    ],
    roles: [
      {
        name: 'Dorfbewohner',
        category: 'village',
        description: 'Gewinnt, wenn alle Werwölfe eliminiert sind.',
        abilities: []
      },
      {
        name: 'Seer',
        category: 'village',
        description: 'Kann jede Nacht die Rolle eines Spielers sehen.',
        abilities: ['Sieht jede Nacht eine Spielerrolle.']
      },
      {
        name: 'Jäger',
        category: 'village',
        description: 'Darf vor seinem Tod einen Spieler erschießen.',
        abilities: ['Kann beim Tod eine Person mitreißen.']
      },
      {
        name: 'Hexe',
        category: 'village',
        description: 'Hat einen Heil- und einen Gifttrank.',
        abilities: ['Ein Heiltrank', 'Ein Gifttrank']
      },
      {
        name: 'Stumme Jule',
        category: 'village',
        description: 'Wählt jede Nacht jemanden, der bis zum nächsten Tag nicht reden darf.',
        abilities: ['Schweigt eine Person pro Nacht']
      },
      {
        name: 'Inquisitor',
        category: 'village',
        description: 'Kann jede Nacht prüfen, ob jemand zur Werwolf-Fraktion gehört.',
        abilities: ['Prüft eine Person pro Nacht']
      },
      {
        name: 'Sündenbock',
        category: 'village',
        description: 'Wird bei einem Gleichstand gelyncht.',
        abilities: ['Opfert sich bei Stimmengleichstand']
      },
      {
        name: 'Geschwister',
        category: 'village',
        description: 'Zwei Dorfbewohner, die sich gegenseitig kennen.',
        abilities: ['Erkennen Geschwister in der ersten Nacht']
      },
      {
        name: 'Geist',
        category: 'village',
        description: 'Kann nach seinem Tod eine Nachricht senden.',
        abilities: ['Sendet nach dem Tod eine Nachricht']
      },
      {
        name: 'Werwolf',
        category: 'werwolf',
        description: 'Gewinnt, wenn sie alle Dorfbewohner eliminieren.',
        abilities: ['Eliminieren nachts gemeinsam']
      },
      {
        name: 'Verfluchte',
        category: 'werwolf',
        description: 'Startet als Dorfbewohner und wird bei einem Angriff der Werwölfe selbst zum Werwolf.',
        abilities: ['Wechselt bei Werwolf-Angriff die Seite']
      },
      {
        name: 'Amor',
        category: 'special',
        description: 'Verknüpft zwei Liebende, die gemeinsam gewinnen.',
        abilities: ['Verbindet zwei Liebende']
      },
      {
        name: 'Trickster',
        category: 'special',
        description: 'Gewinnt, wenn er gelyncht wird, bevor die Werwölfe gewinnen.',
        abilities: ['Gewinnt beim eigenen Lynch']
      },
      {
        name: 'Henker',
        category: 'special',
        description: 'Gewinnt, wenn sein geheimes Ziel vom Dorf gelyncht wird. Spielt für sich allein.',
        abilities: ['Erfährt ein geheimes Ziel']
      },
      {
        name: 'Friedenstifter',
        category: 'special',
        description: 'Gewinnt, wenn für zwei aufeinanderfolgende Runden niemand stirbt.',
        abilities: ['Gewinnt nach zwei friedlichen Runden']
      },
      {
        name: 'Michael Jackson',
        category: 'special',
        description: 'Dorfbewohner-Sonderrolle: Ab der ersten Beschuldigung zählt seine Stimme doppelt, bei der zweiten Beschuldigung stirbt er sofort.',
        abilities: ['Stimme zählt doppelt nach erster Beschuldigung', 'Stirbt bei zweiter Beschuldigung']
      }
    ],
    jobs: [
      {
        name: 'Bodyguard',
        description: 'Wählt jede Nacht eine Person und schützt sie vor Angriffen der Werwölfe.',
        eligibleRoles: [
          'Dorfbewohner',
          'Seer',
          'Jäger',
          'Hexe',
          'Stumme Jule',
          'Inquisitor',
          'Verfluchte',
          'Sündenbock',
          'Geschwister',
          'Geist',
          'Michael Jackson',
          'Friedenstifter'
        ]
      },
      {
        name: 'Doctor',
        description: 'Wacht nach einer blutigen Nacht auf und kann eine der Opferpersonen zurück ins Leben holen.',
        eligibleRoles: [
          'Dorfbewohner',
          'Seer',
          'Jäger',
          'Hexe',
          'Stumme Jule',
          'Inquisitor',
          'Verfluchte',
          'Sündenbock',
          'Geschwister',
          'Geist',
          'Michael Jackson',
          'Friedenstifter'
        ]
      }
    ],
    night: {
      sequence: [
        {
          id: 'Bodyguard',
          prompt: 'Der Bodyguard wacht auf. Bitte wähle eine Person zum Beschützen.',
          requires: { jobs: ['Bodyguard'] },
          phase: 'night'
        },
        {
          id: 'Doctor',
          prompt: 'Der Arzt wacht auf. Du darfst eine der Opferpersonen der letzten Nacht heilen.',
          requires: { jobs: ['Doctor'] },
          conditions: { requiresDoctorTargets: true },
          phase: 'night'
        },
        {
          id: 'Henker',
          prompt: 'Der Henker wacht auf und erfährt sein Ziel.',
          requires: { roles: ['Henker'] },
          conditions: { firstNightOnly: true },
          phase: 'night'
        },
        {
          id: 'Geschwister',
          prompt: 'Die Geschwister öffnen die Augen und erkennen sich.',
          requires: { roles: ['Geschwister'] },
          conditions: { firstNightOnly: true },
          phase: 'night'
        },
        {
          id: 'Amor',
          prompt: 'Amor wacht auf. Bitte wähle zwei Liebende.',
          requires: { roles: ['Amor'] },
          conditions: { firstNightOnly: true },
          phase: 'night'
        },
        {
          id: 'Seer',
          prompt: 'Der Seher wacht auf. Bitte wähle eine Person zum Ansehen.',
          requires: { roles: ['Seer'] },
          phase: 'night'
        },
        {
          id: 'Inquisitor',
          prompt: 'Der Inquisitor wacht auf. Bitte prüfe eine Person auf Werwolf-Zugehörigkeit.',
          requires: { roles: ['Inquisitor'] },
          phase: 'night'
        },
        {
          id: 'Werwolf',
          prompt: 'Werwölfe wachen auf. Sucht euer Opfer.',
          requires: { roles: ['Werwolf'] },
          phase: 'night'
        },
        {
          id: 'Hexe',
          prompt: 'Die Hexe wacht auf. Entscheide Heil- oder Gifttrank.',
          requires: { roles: ['Hexe'] },
          phase: 'night'
        },
        {
          id: 'Stumme Jule',
          prompt: 'Stumme Jule wacht auf. Wähle eine Person, die nicht reden darf.',
          requires: { roles: ['Stumme Jule'] },
          phase: 'night'
        }
      ]
    }
  });

  let roleSchema = {
    version: 1,
    categories: [],
    roles: [],
    jobs: [],
    night: { sequence: [] },
    updatedAt: null
  };
  let roleSchemaSource = 'default';
  let categorizedRoles = { village: [], werwolf: [], special: [] };
  let roleDescriptions = {};
  const roleAbilityMap = new Map();
  let jobDescriptions = {};
  const jobEligibilityMap = new Map();
  let bodyguardEligibleRoles = new Set();
  let doctorEligibleRoles = new Set();
  let nightSequence = [];
  let nightTexts = {};
  const nightStepDefinitions = new Map();
  const supportedStepConditions = ['firstNightOnly', 'requiresDoctorTargets'];

  function getRoleSchemaSnapshot() {
    return JSON.parse(JSON.stringify(roleSchema));
  }

  function getRoleAbilities(roleName) {
    return roleAbilityMap.get(roleName) || [];
  }

  function setCategorizedRolesFromSchema(roles) {
    const next = { village: [], werwolf: [], special: [] };
    roles.forEach((role) => {
      if (!role || typeof role.name !== 'string') {
        return;
      }
      const name = role.name.trim();
      if (!name) {
        return;
      }
      const category = role.category === 'werwolf'
        ? 'werwolf'
        : (role.category === 'village' ? 'village' : 'special');
      next[category].push(name);
    });
    next.village.sort((a, b) => a.localeCompare(b, 'de'));
    next.werwolf.sort((a, b) => a.localeCompare(b, 'de'));
    next.special.sort((a, b) => a.localeCompare(b, 'de'));
    categorizedRoles = next;
  }

  function applyRoleSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return;
    }

    roleSchema = {
      version: Number.isFinite(Number(schema.version)) ? Number(schema.version) : 1,
      categories: Array.isArray(schema.categories)
        ? schema.categories.map((cat) => ({
            id: typeof cat.id === 'string' ? cat.id.trim() : '',
            label: typeof cat.label === 'string' ? cat.label.trim() : (typeof cat.id === 'string' ? cat.id.trim() : '')
          })).filter((cat) => cat.id)
        : [],
      roles: Array.isArray(schema.roles)
        ? schema.roles.map((role) => ({
            name: typeof role.name === 'string' ? role.name.trim() : '',
            category: typeof role.category === 'string' ? role.category.trim() : 'special',
            description: typeof role.description === 'string' ? role.description.trim() : '',
            abilities: Array.isArray(role.abilities)
              ? role.abilities.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
              : []
          })).filter((role) => role.name)
        : [],
      jobs: Array.isArray(schema.jobs)
        ? schema.jobs.map((job) => ({
            name: typeof job.name === 'string' ? job.name.trim() : '',
            description: typeof job.description === 'string' ? job.description.trim() : '',
            eligibleRoles: Array.isArray(job.eligibleRoles)
              ? job.eligibleRoles
                  .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                  .map((entry) => entry.trim())
              : []
          })).filter((job) => job.name)
        : [],
      night: {
        sequence: Array.isArray(schema?.night?.sequence)
          ? schema.night.sequence.map((step) => ({
              id: typeof step?.id === 'string' ? step.id.trim() : '',
              prompt: typeof step?.prompt === 'string' ? step.prompt.trim() : '',
              requires: {
                roles: Array.isArray(step?.requires?.roles)
                  ? step.requires.roles
                      .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                      .map((entry) => entry.trim())
                  : [],
                jobs: Array.isArray(step?.requires?.jobs)
                  ? step.requires.jobs
                      .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                      .map((entry) => entry.trim())
                  : []
              },
              phase: typeof step?.phase === 'string' && step.phase.trim().length > 0
                ? step.phase.trim()
                : 'night',
              conditions: (() => {
                const normalized = {};
                if (step && typeof step.conditions === 'object') {
                  supportedStepConditions.forEach((key) => {
                    if (typeof step.conditions[key] === 'boolean') {
                      normalized[key] = step.conditions[key];
                    }
                  });
                }
                return normalized;
              })()
            })).filter((step) => step.id)
          : []
      },
      updatedAt: typeof schema.updatedAt === 'string' ? schema.updatedAt : null
    };

    setCategorizedRolesFromSchema(roleSchema.roles);

    roleDescriptions = {};
    roleAbilityMap.clear();
    roleSchema.roles.forEach((role) => {
      const localizedDescription = localization.getRoleDescription(role.name);
      roleDescriptions[role.name] = localizedDescription || role.description || '';
      const localizedAbilities = localization.getRoleAbilities(role.name);
      if (Array.isArray(localizedAbilities) && localizedAbilities.length > 0) {
        roleAbilityMap.set(role.name, localizedAbilities);
      } else {
        roleAbilityMap.set(role.name, Array.isArray(role.abilities) ? role.abilities.slice() : []);
      }
    });

    jobDescriptions = {};
    jobEligibilityMap.clear();
    roleSchema.jobs.forEach((job) => {
      const localizedDescription = localization.getJobDescription(job.name);
      jobDescriptions[job.name] = localizedDescription || job.description || '';
      jobEligibilityMap.set(job.name, new Set(job.eligibleRoles || []));
    });

    bodyguardEligibleRoles = new Set(jobEligibilityMap.get('Bodyguard') || []);
    doctorEligibleRoles = new Set(jobEligibilityMap.get('Doctor') || []);

    nightSequence = [];
    nightTexts = {};
    nightStepDefinitions.clear();
    roleSchema.night.sequence.forEach((step) => {
      nightSequence.push(step.id);
      const prompt = step.prompt || `${step.id} ist an der Reihe.`;
      nightTexts[step.id] = prompt;
      nightStepDefinitions.set(step.id, {
        id: step.id,
        prompt,
        requires: {
          roles: Array.isArray(step.requires?.roles) ? step.requires.roles.slice() : [],
          jobs: Array.isArray(step.requires?.jobs) ? step.requires.jobs.slice() : []
        },
        phase: step.phase || 'night',
        conditions: step.conditions ? { ...step.conditions } : {}
      });
    });

    roleEditorState = getRoleSchemaSnapshot();
    ensureRoleEditorStateStructure();
    roleEditorDirty = false;
    if (roleEditorReady) {
      renderRoleEditorRoles();
      renderRoleEditorJobs();
      renderRoleEditorNight();
    }
    updateRoleEditorStatus();
  }

  function refreshLocalizationCaches() {
    if (roleSchema && Array.isArray(roleSchema.roles)) {
      roleSchema.roles.forEach((role) => {
        const localizedDescription = localization.getRoleDescription(role.name);
        if (localizedDescription) {
          roleDescriptions[role.name] = localizedDescription;
        }
        const localizedAbilities = localization.getRoleAbilities(role.name);
        if (Array.isArray(localizedAbilities) && localizedAbilities.length > 0) {
          roleAbilityMap.set(role.name, localizedAbilities);
        }
      });
    }
    if (roleSchema && Array.isArray(roleSchema.jobs)) {
      roleSchema.jobs.forEach((job) => {
        const localizedDescription = localization.getJobDescription(job.name);
        if (localizedDescription) {
          jobDescriptions[job.name] = localizedDescription;
        }
      });
    }
    applyEventLocalization();
    updatePhoenixPulseStatus();
    if (roleEditorReady) {
      renderRoleEditorRoles();
      renderRoleEditorJobs();
      renderRoleEditorNight();
    }
  }

  async function loadFallbackRoleSchema() {
    if (typeof fetch === 'function') {
      try {
        const response = await fetch('/data/roles.json', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === 'object') {
            return data;
          }
        }
      } catch (error) {
        console.error('Fallback-Rollenschema konnte nicht geladen werden.', error);
      }
    }

    return JSON.parse(JSON.stringify(EMBEDDED_DEFAULT_ROLE_SCHEMA));
  }

  async function initializeRoleSchema() {
    try {
      const { config, source } = await apiClient.rolesConfig.get();
      if (config) {
        applyRoleSchema(config);
        roleSchemaSource = source || 'custom';
        return;
      }
    } catch (error) {
      console.error('Rollenkonfiguration konnte nicht geladen werden.', error);
    }

    const fallback = await loadFallbackRoleSchema();
    if (fallback) {
      applyRoleSchema(fallback);
      roleSchemaSource = 'default';
      return;
    }

    applyRoleSchema({ roles: [], jobs: [], night: { sequence: [] } });
    roleSchemaSource = 'default';
  }

  function isRoleEligibleForJob(roleName, jobName) {
    if (!roleName || !jobName) {
      return false;
    }
    const eligibility = jobEligibilityMap.get(jobName);
    if (!eligibility) {
      return false;
    }
    return eligibility.has(roleName);
  }

  function getLivingRoleSet() {
    const set = new Set();
    players.forEach((player, index) => {
      if (!deadPlayers.includes(player)) {
        const roleName = rolesAssigned[index];
        if (roleName) {
          set.add(roleName);
        }
      }
    });
    return set;
  }

  function getActiveJobsSet() {
    return jobsAssigned.reduce((acc, jobs) => {
      if (Array.isArray(jobs)) {
        jobs.forEach((job) => acc.add(job));
      }
      return acc;
    }, new Set());
  }

  function isNightStepAvailable(stepId, { doctorShouldAct = false, livingRoleSet = null } = {}) {
    const definition = nightStepDefinitions.get(stepId);
    if (!definition) {
      return true;
    }
    const requires = definition.requires || {};
    if (Array.isArray(requires.roles) && requires.roles.length > 0) {
      const roleSet = livingRoleSet || getLivingRoleSet();
      const hasRole = requires.roles.some((roleName) => roleSet.has(roleName));
      if (!hasRole) {
        return false;
      }
    }
    if (Array.isArray(requires.jobs) && requires.jobs.length > 0) {
      const activeJobs = getActiveJobsSet();
      const hasJob = requires.jobs.some((jobName) => activeJobs.has(jobName));
      if (!hasJob) {
        return false;
      }
    }
    const conditions = definition.conditions || {};
    if (conditions.firstNightOnly && dayCount > 0) {
      return false;
    }
    if (conditions.requiresDoctorTargets && !doctorShouldAct) {
      return false;
    }
    return true;
  }

  function generateNightSteps(context = {}) {
    return nightSequence.filter((stepId) => isNightStepAvailable(stepId, context));
  }


  await initializeRoleSchema();
  roleSchemaReady = true;
  refreshLocalizationCaches();

  // Sidebar elements and toggle
  const sessionsSidebar = document.getElementById('sessions-sidebar');
  const sessionsList = document.getElementById('sessions-list');
  const sessionsToggle = document.getElementById('sessions-toggle');

  const replaySessionSelect = document.getElementById('replay-session-select');
  const replayScrubber = document.getElementById('replay-scrubber');
  const replayActionLabel = document.getElementById('replay-action-label');
  const replayApplyBtn = document.getElementById('replay-apply-btn');
  const replayActionList = document.getElementById('replay-action-list');

  const analyticsSummaryEl = document.getElementById('analytics-summary');
  const analyticsWinratesEl = document.getElementById('analytics-winrates');
  const analyticsMetaEl = document.getElementById('analytics-meta');
  const analyticsHighlightsEl = document.getElementById('analytics-highlights');
  const analyticsPlayerTableBody = document.getElementById('analytics-player-table-body');
  const analyticsModal = document.getElementById('analytics-modal');
  const openAnalyticsBtn = document.getElementById('open-analytics-btn');
  const closeAnalyticsBtn = document.getElementById('analytics-close-btn');
  const analyticsRefreshBtn = document.getElementById('analytics-refresh-btn');
  const analyticsMetricSessionsEl = document.getElementById('analytics-metric-sessions');
  const analyticsMetricTrackedEl = document.getElementById('analytics-metric-tracked');
  const analyticsMetricPlayersEl = document.getElementById('analytics-metric-players');
  const analyticsMetricAveragePlayersEl = document.getElementById('analytics-metric-average-players');
  const analyticsMetricAverageActionsEl = document.getElementById('analytics-metric-average-actions');
  const analyticsMetricDurationEl = document.getElementById('analytics-metric-duration');
  const analyticsRefreshBtnDefaultText = analyticsRefreshBtn ? analyticsRefreshBtn.textContent : 'Aktualisieren';
  let lastAnalyticsTrigger = null;

  let replayTimeline = null;
  let replayPointer = -1;
  let isLoadingReplay = false;

  if (sessionsToggle) {
    sessionsToggle.addEventListener('click', () => {
      sessionsSidebar.classList.toggle('show');
      document.body.classList.toggle('sidebar-open');
    });
  }

  const saveGameBtn = document.getElementById('save-game-btn');
  if (saveGameBtn) {
    saveGameBtn.addEventListener('click', async () => {
      if (!canEditActiveLobby) {
        showInfoMessage({
          title: 'Schreibgeschützt',
          text: READ_ONLY_HINT,
          confirmText: 'Okay',
        });
        return;
      }
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
      const previousTheme = currentThemeVariant;
      const newTheme = previousTheme === 'dark' ? 'light' : 'dark';
      try {
        await setTheme(newTheme);
      } catch (error) {
        applyThemeVariant(previousTheme);
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
  const revealControlsEl = document.getElementById('reveal-controls');
  const currentRevealPlayerEl = document.getElementById('current-player-display');
  const revealNextBtn = document.getElementById('reveal-next-btn');
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
  localeSelect = document.getElementById('locale-select');
  const openConfigBtn = document.getElementById('open-config-btn');
  const configModal = document.getElementById('config-modal');
  const closeConfigBtn = document.getElementById('close-config-btn');
  const closeConfigFooterBtn = document.getElementById('close-config-footer-btn');
  themePresetSelect = document.getElementById('theme-preset-select');
  themeVariantSelect = document.getElementById('theme-variant-select');
  themeAccentInput = document.getElementById('theme-accent-input');
  themeBackgroundUrlInput = document.getElementById('theme-background-url');
  themeBackgroundUploadInput = document.getElementById('theme-background-upload');
  themeBackgroundStatus = document.getElementById('theme-background-status');
  themeSaveBtn = document.getElementById('theme-save-btn');
  themeResetBtn = document.getElementById('theme-reset-btn');
  themePreviewCard = document.getElementById('theme-preview-card');

  if (themePresetSelect) {
    themePresetSelect.addEventListener('change', () => {
      const newPresetId = themePresetSelect.value;
      pendingThemePreview = {
        presetId: newPresetId,
        variant: sanitizeThemeVariant(themeVariantSelect?.value) || 'light',
        custom: {},
      };
      refreshThemeConfigurator();
    });
  }

  if (themeVariantSelect) {
    themeVariantSelect.addEventListener('change', () => {
      if (!pendingThemePreview) {
        pendingThemePreview = buildConfiguratorSelectionFromState();
      }
      pendingThemePreview.variant = sanitizeThemeVariant(themeVariantSelect.value) || 'light';
      updateThemeConfiguratorPreview();
    });
  }

  if (themeAccentInput) {
    themeAccentInput.addEventListener('input', () => {
      if (!pendingThemePreview) {
        pendingThemePreview = buildConfiguratorSelectionFromState();
      }
      const accent = sanitizeAccentInput(themeAccentInput.value);
      if (accent) {
        pendingThemePreview.custom = pendingThemePreview.custom || {};
        pendingThemePreview.custom.accentColor = accent;
      } else if (pendingThemePreview.custom) {
        delete pendingThemePreview.custom.accentColor;
      }
      updateThemeConfiguratorPreview();
    });
  }

  if (themeBackgroundUrlInput) {
    themeBackgroundUrlInput.addEventListener('change', () => {
      if (!pendingThemePreview) {
        pendingThemePreview = buildConfiguratorSelectionFromState();
      }
      const sanitized = sanitizeBackgroundInputClient(themeBackgroundUrlInput.value);
      if (sanitized) {
        pendingThemePreview.custom = pendingThemePreview.custom || {};
        pendingThemePreview.custom.backgroundImage = sanitized;
        setThemeBackgroundStatus('settings.theme.backgroundStatus.url');
      } else if (pendingThemePreview.custom) {
        delete pendingThemePreview.custom.backgroundImage;
        setThemeBackgroundStatus('settings.theme.backgroundStatus.preset');
      }
      updateThemeConfiguratorPreview();
    });
  }

  if (themeBackgroundUploadInput) {
    themeBackgroundUploadInput.addEventListener('change', () => {
      const [file] = themeBackgroundUploadInput.files || [];
      if (!file) {
        return;
      }
      if (file.size > MAX_THEME_UPLOAD_BYTES) {
        showInfoMessage({
          title: 'Datei zu groß',
          text: 'Bitte wähle eine Bilddatei mit höchstens 1,5 MB.',
          confirmText: 'Okay',
        });
        themeBackgroundUploadInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (!pendingThemePreview) {
          pendingThemePreview = buildConfiguratorSelectionFromState();
        }
        pendingThemePreview.custom = pendingThemePreview.custom || {};
        pendingThemePreview.custom.backgroundImage = { type: 'upload', value: reader.result };
        setThemeBackgroundStatus('settings.theme.backgroundStatus.upload');
        if (themeBackgroundUrlInput) {
          themeBackgroundUrlInput.value = '';
        }
        updateThemeConfiguratorPreview();
      };
      reader.onerror = () => {
        showInfoMessage({
          title: 'Upload fehlgeschlagen',
          text: 'Die Bilddatei konnte nicht gelesen werden.',
          confirmText: 'Okay',
        });
      };
      reader.readAsDataURL(file);
    });
  }

  if (themeResetBtn) {
    themeResetBtn.addEventListener('click', () => {
      pendingThemePreview = buildConfiguratorSelectionFromState();
      setThemeBackgroundStatus('settings.theme.backgroundStatus.preset');
      refreshThemeConfigurator();
    });
  }

  if (themeSaveBtn) {
    themeSaveBtn.addEventListener('click', () => withButtonLoading(themeSaveBtn, 'Speichern...', async () => {
      const selection = cloneThemeJson(pendingThemePreview || buildConfiguratorSelectionFromState());
      selection.custom = selection.custom ? { ...selection.custom } : {};
      if (selection.custom.accentColor) {
        selection.custom.accentColor = sanitizeAccentInput(selection.custom.accentColor);
      }
      if (selection.custom.backgroundImage) {
        selection.custom.backgroundImage = sanitizeBackgroundInputClient(selection.custom.backgroundImage);
      }
      const state = await apiClient.theme.set(selection);
      pendingThemePreview = null;
      updateThemeState(state, { markPreference: true });
      showInfoMessage({
        title: 'Theme aktualisiert',
        text: 'Theme-Einstellungen wurden gespeichert.',
        confirmText: 'Okay',
        log: { type: 'info', label: 'Theme aktualisiert' }
      });
    }).catch((error) => {
      console.error('Theme konnte nicht gespeichert werden.', error);
      showInfoMessage({
        title: 'Theme speichern fehlgeschlagen',
        text: error?.message || 'Das Theme konnte nicht gespeichert werden.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Theme speichern fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
      });
    }));
  }

  refreshThemeConfigurator();
  const JOB_CONFIG_STORAGE_KEY = 'werwolfJobConfig';
  const EVENT_CONFIG_STORAGE_KEY = 'werwolfEventConfig';
  const BLOOD_MOON_CONFIG_STORAGE_KEY = 'werwolfBloodMoonConfig';
  const LOCALE_PREFERENCE_STORAGE_KEY = 'werwolfLocalePreference';
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

  const HTML_ESCAPE_LOOKUP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_LOOKUP[char] || char);
  }

  function createLobbyManager() {
    const toolbar = document.getElementById('lobby-toolbar');
    const lobbySelect = document.getElementById('lobby-select');
    const createLobbyBtn = document.getElementById('create-lobby-btn');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const shareLobbyBtn = document.getElementById('share-lobby-btn');
    const manageLobbyBtn = document.getElementById('manage-lobby-btn');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
    const roleBadge = document.getElementById('lobby-role-badge');
    const cloneNamesBtn = document.getElementById('clone-names-btn');
    const cloneRolesBtn = document.getElementById('clone-roles-btn');

    let lobbies = [];
    let activeLobbyState = null;
    const changeListeners = new Set();

    function cloneLobby(lobby) {
      return lobby ? { ...lobby } : null;
    }

    function canWrite(lobby = activeLobbyState) {
      if (!lobby) {
        return false;
      }
      return lobby.isPersonal || lobby.isOwner || lobby.isAdmin;
    }

    function updateRoleBadge() {
      if (!roleBadge) {
        return;
      }
      if (!activeLobbyState) {
        roleBadge.textContent = '';
        roleBadge.classList.add('hidden');
        return;
      }
      let label = '';
      if (activeLobbyState.isPersonal) {
        label = 'Persönlich';
      } else if (activeLobbyState.isOwner) {
        label = 'Besitzer:in';
      } else if (activeLobbyState.isAdmin) {
        label = 'Admin-Team';
      } else {
        label = 'Mitglied';
      }
      roleBadge.textContent = label;
      roleBadge.dataset.variant = activeLobbyState.role || (activeLobbyState.isPersonal ? 'personal' : 'member');
      roleBadge.classList.toggle('read-only', !canWrite());
      roleBadge.classList.remove('hidden');
    }

    function updateSelectOptions() {
      if (!lobbySelect) {
        return;
      }
      lobbySelect.innerHTML = '';
      lobbies.forEach((lobby) => {
        const option = document.createElement('option');
        option.value = String(lobby.id);
        let suffix = '';
        if (lobby.isPersonal) {
          suffix = ' (persönlich)';
        } else if (lobby.isOwner) {
          suffix = ' (Besitz)';
        } else if (lobby.isAdmin) {
          suffix = ' (Admin)';
        }
        option.textContent = `${lobby.name}${suffix}`;
        lobbySelect.appendChild(option);
      });
      if (activeLobbyState) {
        lobbySelect.value = String(activeLobbyState.id);
      }
    }

    function notifyChange() {
      const snapshot = cloneLobby(activeLobbyState);
      changeListeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (error) {
          console.error('Lobby-Listener fehlgeschlagen', error);
        }
      });
    }

    function updateToolbarVisibility() {
      if (toolbar) {
        toolbar.classList.toggle('hidden', lobbies.length === 0);
      }
      if (shareLobbyBtn) {
        shareLobbyBtn.disabled = !activeLobbyState || !activeLobbyState.joinCode;
        shareLobbyBtn.classList.toggle('hidden', !activeLobbyState || (!activeLobbyState.joinCode && !canWrite()));
      }
      if (manageLobbyBtn) {
        manageLobbyBtn.disabled = !canWrite();
        manageLobbyBtn.classList.toggle('hidden', !activeLobbyState || (!canWrite() && !activeLobbyState.isOwner));
      }
      if (createLobbyBtn) {
        createLobbyBtn.disabled = !authManager?.getUser();
      }
      if (joinLobbyBtn) {
        joinLobbyBtn.disabled = !authManager?.getUser();
      }
      if (cloneNamesBtn) {
        const canClone = activeLobbyState && lobbies.length > 1 && canWrite();
        cloneNamesBtn.disabled = !canClone;
        cloneNamesBtn.title = canClone ? '' : 'Nur mit Schreibrechten möglich.';
      }
      if (cloneRolesBtn) {
        const canClone = activeLobbyState && lobbies.length > 1 && canWrite();
        cloneRolesBtn.disabled = !canClone;
        cloneRolesBtn.title = canClone ? '' : 'Nur mit Schreibrechten möglich.';
      }
      if (leaveLobbyBtn) {
        const canLeave = Boolean(activeLobbyState && !activeLobbyState.isPersonal);
        leaveLobbyBtn.classList.toggle('hidden', !canLeave);
        leaveLobbyBtn.disabled = !canLeave;
        if (canLeave) {
          leaveLobbyBtn.textContent = activeLobbyState.isOwner ? 'Lobby löschen' : 'Lobby verlassen';
        }
      }
    }

    function setActiveLobbyState(lobby, { emitEvent = true } = {}) {
      activeLobbyState = cloneLobby(lobby);
      apiClient.storageScopes.setActiveLobby(activeLobbyState);
      updateSelectOptions();
      updateRoleBadge();
      updateToolbarVisibility();
      if (emitEvent) {
        notifyChange();
      }
    }

    async function refreshLobbies({ preserveActive = true } = {}) {
      let nextLobby = null;
      try {
        const data = await apiClient.lobby.list();
        lobbies = Array.isArray(data) ? data : [];
        if (preserveActive && activeLobbyState) {
          nextLobby = lobbies.find((entry) => entry.id === activeLobbyState.id) || null;
        }
      } catch (error) {
        console.error('Lobbys konnten nicht geladen werden.', error);
        lobbies = [];
        nextLobby = null;
      }

      if (!nextLobby) {
        nextLobby = lobbies.find((entry) => entry.isPersonal) || lobbies[0] || null;
      }

      setActiveLobbyState(nextLobby, { emitEvent: true });
      return cloneLobby(activeLobbyState);
    }

    function showLobbyPrompt({ title, label, placeholder = '', defaultValue = '', validate, onInvalid, confirmText = 'Speichern' }) {
      return new Promise((resolve) => {
        let lastValue = defaultValue || '';
        const inputId = `lobby-input-${Math.random().toString(36).slice(2, 8)}`;

        const openPrompt = () => {
          showConfirmation({
            title,
            html: `<div class="modal-field"><label for="${inputId}">${label}</label><input id="${inputId}" type="text" class="modal-input" placeholder="${placeholder}" /></div>`,
            confirmText,
            cancelText: 'Abbrechen',
            focus: 'confirm',
            onConfirm: () => {
              const inputEl = document.getElementById(inputId);
              const value = inputEl ? inputEl.value.trim() : '';
              lastValue = value;
              if (validate && !validate(value)) {
                if (typeof onInvalid === 'function') {
                  onInvalid(value);
                }
                setTimeout(openPrompt, 0);
                return;
              }
              resolve(value);
            },
            onCancel: () => resolve(null),
          });

          requestAnimationFrame(() => {
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
              inputEl.value = lastValue;
              inputEl.focus();
              inputEl.select();
            }
          });
        };

        openPrompt();
      });
    }

    function buildMembersHtml(members, canManage) {
      if (!Array.isArray(members) || members.length === 0) {
        return '<p class="empty-hint">Noch keine weiteren Teammitglieder.</p>';
      }
      return `
        <ul class="lobby-members-list">
          ${members.map((member) => {
            const actions = [];
            if (canManage && !member.isOwner) {
              if (member.isAdmin) {
                actions.push(`<button data-action="demote" data-member="${member.userId}" class="secondary-btn small-btn">Zu Mitglied</button>`);
              } else {
                actions.push(`<button data-action="promote" data-member="${member.userId}" class="secondary-btn small-btn">Zu Admin</button>`);
              }
              actions.push(`<button data-action="remove" data-member="${member.userId}" class="danger-btn small-btn">Entfernen</button>`);
            }
            const badge = member.isOwner ? 'Besitz' : (member.isAdmin ? 'Admin' : 'Mitglied');
            return `
              <li class="lobby-member">
                <div class="member-info">
                  <span class="member-name">${escapeHtml(member.displayName || member.email || 'Nutzer')}</span>
                  <span class="member-role" data-role="${member.isOwner ? 'owner' : member.isAdmin ? 'admin' : 'member'}">${badge}</span>
                </div>
                ${actions.length ? `<div class="member-actions">${actions.join('')}</div>` : ''}
              </li>
            `;
          }).join('')}
        </ul>
      `;
    }

    function openManageMembers() {
      if (!activeLobbyState) {
        return;
      }
      const lobbyId = activeLobbyState.id;
      const modalId = `lobby-members-${lobbyId}`;

      const render = async () => {
        let result = null;
        try {
          result = await apiClient.lobby.members(lobbyId);
        } catch (error) {
          console.error('Mitglieder konnten nicht geladen werden.', error);
          showInfoMessage({
            title: 'Fehler beim Laden',
            text: 'Die Mitgliederliste konnte nicht geladen werden.',
            confirmText: 'Okay',
          });
          return;
        }

        const members = Array.isArray(result?.members) ? result.members : [];
        const canManage = canWrite() && activeLobbyState?.isOwner;
        showConfirmation({
          title: `Team ${activeLobbyState.name}`,
          html: `<div id="${modalId}" class="lobby-members-manager">${buildMembersHtml(members, canManage)}</div>`,
          confirmText: 'Schließen',
          showCancel: false,
          modalClass: 'lobby-modal',
          onConfirm: () => {},
        });

        requestAnimationFrame(() => {
          const container = document.getElementById(modalId);
          if (!container) {
            return;
          }
          container.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-member]');
            if (!button) {
              return;
            }
            const memberId = Number(button.dataset.member);
            const action = button.dataset.action;
            try {
              if (action === 'promote') {
                await apiClient.lobby.updateMember(lobbyId, memberId, 'admin');
              } else if (action === 'demote') {
                await apiClient.lobby.updateMember(lobbyId, memberId, 'member');
              } else if (action === 'remove') {
                await apiClient.lobby.removeMember(lobbyId, memberId);
              }
              await render();
            } catch (error) {
              console.error('Mitgliedsänderung fehlgeschlagen.', error);
              showInfoMessage({
                title: 'Aktion fehlgeschlagen',
                text: 'Die Änderung konnte nicht durchgeführt werden.',
                confirmText: 'Okay',
              });
            }
          }, { once: true });
        });
      };

      render();
    }

    async function promptForSourceLobby({ title, excludeActive = true } = {}) {
      const choices = lobbies.filter((entry) => !excludeActive || !activeLobbyState || entry.id !== activeLobbyState.id);
      if (choices.length === 0) {
        showInfoMessage({
          title: 'Keine weiteren Lobbys',
          text: 'Es sind keine weiteren Lobbys verfügbar.',
          confirmText: 'Okay',
        });
        return null;
      }
      const selectId = `lobby-source-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve) => {
        showConfirmation({
          title,
          html: `<div class="modal-field"><label for="${selectId}">Quelle auswählen</label><select id="${selectId}" class="modal-select">${choices.map((entry) => `<option value="${entry.id}">${escapeHtml(entry.name)}${entry.isPersonal ? ' (persönlich)' : ''}</option>`).join('')}</select></div>`,
          confirmText: 'Übernehmen',
          cancelText: 'Abbrechen',
          focus: 'confirm',
          onConfirm: () => {
            const selectEl = document.getElementById(selectId);
            const value = selectEl ? Number(selectEl.value) : NaN;
            resolve(Number.isFinite(value) ? value : null);
          },
          onCancel: () => resolve(null),
        });
        requestAnimationFrame(() => {
          document.getElementById(selectId)?.focus();
        });
      });
    }

    async function clonePresetsFromLobby(sourceLobbyId, { copyNames = false, copyRoles = false } = {}) {
      if (!canWrite()) {
        showInfoMessage({
          title: 'Nur Leserechte',
          text: 'In dieser Lobby kannst du keine Daten verändern.',
          confirmText: 'Okay',
        });
        return;
      }
      if (!activeLobbyState || !Number.isInteger(sourceLobbyId) || sourceLobbyId === activeLobbyState.id) {
        return;
      }

      const tasks = [];
      if (copyNames) {
        tasks.push((async () => {
          const names = await apiClient.lobby.withLobby(sourceLobbyId, () => apiClient.savedNames.get());
          await apiClient.lobby.withLobby(activeLobbyState, () => apiClient.savedNames.set(Array.isArray(names) ? names : []));
        })());
      }
      if (copyRoles) {
        tasks.push((async () => {
          const roles = await apiClient.lobby.withLobby(sourceLobbyId, () => apiClient.rolePresets.get());
          await apiClient.lobby.withLobby(activeLobbyState, () => apiClient.rolePresets.set(Array.isArray(roles) ? roles : []));
        })());
      }

      try {
        await Promise.all(tasks);
        if (copyNames && cloneNamesBtn) {
          cloneNamesBtn.classList.add('success');
          setTimeout(() => cloneNamesBtn.classList.remove('success'), 1200);
        }
        if (copyRoles && cloneRolesBtn) {
          cloneRolesBtn.classList.add('success');
          setTimeout(() => cloneRolesBtn.classList.remove('success'), 1200);
        }
      } catch (error) {
        console.error('Voreinstellungen konnten nicht kopiert werden.', error);
        showInfoMessage({
          title: 'Kopieren fehlgeschlagen',
          text: 'Die ausgewählten Daten konnten nicht kopiert werden.',
          confirmText: 'Okay',
        });
      }
    }

    async function handleCreateLobby() {
      const name = await showLobbyPrompt({
        title: 'Neue Lobby anlegen',
        label: 'Lobbynamen eingeben',
        placeholder: 'z. B. Sommerlager',
        defaultValue: '',
        validate: (value) => value.trim().length >= 2,
        onInvalid: () => showInfoMessage({ title: 'Ungültiger Name', text: 'Der Name muss mindestens zwei Zeichen haben.', confirmText: 'Okay' }),
      });
      if (!name) {
        return;
      }
      await withButtonLoading(createLobbyBtn, 'Erstelle …', async () => {
        try {
          const response = await apiClient.lobby.create({ name });
          if (Array.isArray(response?.lobbies)) {
            lobbies = response.lobbies;
          }
          if (response?.lobby) {
            setActiveLobbyState(response.lobby, { emitEvent: true });
          } else {
            await refreshLobbies({ preserveActive: false });
          }
          showInfoMessage({
            title: 'Lobby erstellt',
            text: 'Die Lobby wurde erfolgreich erstellt.',
            confirmText: 'Okay',
          });
        } catch (error) {
          console.error('Lobby konnte nicht erstellt werden.', error);
          showInfoMessage({
            title: 'Erstellung fehlgeschlagen',
            text: 'Die Lobby konnte nicht erstellt werden.',
            confirmText: 'Okay',
          });
        }
      });
    }

    async function handleJoinLobby() {
      const code = await showLobbyPrompt({
        title: 'Lobby beitreten',
        label: 'Beitrittscode eingeben',
        placeholder: 'CODE123',
        validate: (value) => value.length >= 4,
        onInvalid: () => showInfoMessage({ title: 'Ungültiger Code', text: 'Bitte gib einen gültigen Beitrittscode ein.', confirmText: 'Okay' }),
        confirmText: 'Beitreten',
      });
      if (!code) {
        return;
      }
      await withButtonLoading(joinLobbyBtn, 'Tritt bei …', async () => {
        try {
          const response = await apiClient.lobby.join({ code });
          if (Array.isArray(response?.lobbies)) {
            lobbies = response.lobbies;
          }
          if (response?.lobby) {
            setActiveLobbyState(response.lobby, { emitEvent: true });
          } else {
            await refreshLobbies({ preserveActive: false });
          }
          showInfoMessage({
            title: 'Beitritt erfolgreich',
            text: 'Du bist der Lobby beigetreten.',
            confirmText: 'Okay',
          });
        } catch (error) {
          console.error('Lobby konnte nicht beigetreten werden.', error);
          showInfoMessage({
            title: 'Beitritt fehlgeschlagen',
            text: 'Der Beitrittscode wurde nicht akzeptiert.',
            confirmText: 'Okay',
          });
        }
      });
    }

    function handleShareLobby() {
      if (!activeLobbyState || !activeLobbyState.joinCode) {
        showInfoMessage({
          title: 'Kein Beitrittscode',
          text: 'Für diese Lobby steht kein Beitrittscode zur Verfügung.',
          confirmText: 'Okay',
        });
        return;
      }
      showInfoMessage({
        title: 'Beitrittscode',
        html: `<p class="join-code">${escapeHtml(activeLobbyState.joinCode)}</p><p class="join-hint">Teile diesen Code mit deinem Team, um gemeinsam an Sessions und Voreinstellungen zu arbeiten.</p>`,
        confirmText: 'Verstanden',
      });
    }

    async function handleDeleteOrLeaveLobby() {
      if (!activeLobbyState) {
        return;
      }
      if (activeLobbyState.isPersonal) {
        showInfoMessage({
          title: 'Nicht möglich',
          text: 'Die persönliche Lobby kann nicht verlassen werden.',
          confirmText: 'Okay',
        });
        return;
      }

      const isOwner = activeLobbyState.isOwner;
      const confirmTitle = isOwner ? 'Lobby löschen?' : 'Lobby verlassen?';
      const confirmText = isOwner
        ? 'Willst du diese Lobby wirklich dauerhaft löschen?'
        : 'Willst du diese Lobby wirklich verlassen?';

      showConfirmation({
        title: confirmTitle,
        text: confirmText,
        confirmText: isOwner ? 'Löschen' : 'Verlassen',
        cancelText: 'Abbrechen',
        modalClass: 'danger',
        onConfirm: async () => {
          if (isOwner) {
            await apiClient.lobby.remove(activeLobbyState.id, { deleteLobby: true });
          } else {
            await apiClient.lobby.remove(activeLobbyState.id);
          }
          await refreshLobbies({ preserveActive: false });
        },
      });
    }

    function bindEventHandlers() {
      if (lobbySelect) {
        lobbySelect.addEventListener('change', () => {
          const selectedId = Number(lobbySelect.value);
          const next = lobbies.find((entry) => entry.id === selectedId);
          if (next) {
            setActiveLobbyState(next, { emitEvent: true });
          }
        });
      }
      if (createLobbyBtn) {
        createLobbyBtn.addEventListener('click', handleCreateLobby);
      }
      if (joinLobbyBtn) {
        joinLobbyBtn.addEventListener('click', handleJoinLobby);
      }
      if (shareLobbyBtn) {
        shareLobbyBtn.addEventListener('click', handleShareLobby);
      }
      if (manageLobbyBtn) {
        manageLobbyBtn.addEventListener('click', openManageMembers);
      }
      if (cloneNamesBtn) {
        cloneNamesBtn.addEventListener('click', async () => {
          const sourceId = await promptForSourceLobby({ title: 'Namen kopieren' });
          if (Number.isInteger(sourceId)) {
            await clonePresetsFromLobby(sourceId, { copyNames: true });
          }
        });
      }
      if (cloneRolesBtn) {
        cloneRolesBtn.addEventListener('click', async () => {
          const sourceId = await promptForSourceLobby({ title: 'Rollenvoreinstellungen kopieren' });
          if (Number.isInteger(sourceId)) {
            await clonePresetsFromLobby(sourceId, { copyRoles: true });
          }
        });
      }
      const deleteBtn = document.getElementById('leave-lobby-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteOrLeaveLobby);
      }
    }

    bindEventHandlers();

    return {
      async initialize() {
        return refreshLobbies({ preserveActive: true });
      },
      async refresh() {
        return refreshLobbies({ preserveActive: true });
      },
      getActiveLobby() {
        return cloneLobby(activeLobbyState);
      },
      canEditActiveLobby() {
        return canWrite();
      },
      onChange(listener) {
        if (typeof listener === 'function') {
          changeListeners.add(listener);
          listener(cloneLobby(activeLobbyState));
        }
        return () => changeListeners.delete(listener);
      },
      handleUserChange(user, { refreshCaches = false } = {}) {
        if (!user) {
          lobbies = [];
          setActiveLobbyState(null, { emitEvent: true });
          return;
        }
        refreshLobbies({ preserveActive: !refreshCaches });
      },
      async cloneFrom(sourceLobbyId, options) {
        await clonePresetsFromLobby(sourceLobbyId, options);
      },
      setActiveLobbyById(lobbyId) {
        const target = lobbies.find((entry) => entry.id === lobbyId);
        if (target) {
          setActiveLobbyState(target, { emitEvent: true });
        }
      },
      canWriteActiveLobby() {
        return canWrite();
      },
    };
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
  eventDefinitionsReady = true;

  function applyEventLocalization() {
    if (!eventDefinitionsReady) {
      return;
    }
    eventCardDefinitions.forEach((card) => {
      if (!card || !card.id) {
        return;
      }
      if (!card.__localizedWrapped) {
        const originalEffect = typeof card.effect === 'function' ? card.effect.bind(card) : null;
        if (originalEffect) {
          card.effect = function (...args) {
            const result = originalEffect(...args);
            const currentStrings = localization.getEventStrings(card.id) || {};
            if (result && typeof result === 'object') {
              if (currentStrings.log) {
                result.log = {
                  ...(result.log || {}),
                  label: currentStrings.log.label || result.log?.label || undefined,
                  detail: currentStrings.log.detail || result.log?.detail || undefined,
                };
              }
              if (currentStrings.message && Object.prototype.hasOwnProperty.call(result, 'message')) {
                result.message = currentStrings.message;
              }
              if (currentStrings.note && Object.prototype.hasOwnProperty.call(result, 'narratorNote')) {
                result.narratorNote = currentStrings.note;
              }
            }
            return result;
          };
        }
        if (typeof card.preview === 'function') {
          const originalPreview = card.preview.bind(card);
          card.preview = function (...args) {
            const currentStrings = localization.getEventStrings(card.id);
            if (currentStrings?.preview) {
              return currentStrings.preview;
            }
            return originalPreview(...args);
          };
        }
        card.__localizedWrapped = true;
      }
      const strings = localization.getEventStrings(card.id);
      if (strings?.label) {
        card.label = strings.label;
      }
      if (strings?.description) {
        card.description = strings.description;
      }
    });
    renderEventDeckControls();
    renderEventCardPreview();
    renderCampaignSelect();
    renderCampaignPreview();
  }

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

  function setAnalyticsModalVisibility(isOpen) {
    if (!analyticsModal) {
      return;
    }
    analyticsModal.style.display = isOpen ? 'flex' : 'none';
    analyticsModal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function focusFirstAnalyticsElement() {
    if (!analyticsModal) {
      return;
    }
    const focusable = analyticsModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus();
    }
  }

  function openAnalyticsModal() {
    if (!analyticsModal) {
      return;
    }
    lastAnalyticsTrigger = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement
      : null;
    setAnalyticsModalVisibility(true);
    focusFirstAnalyticsElement();
    loadAnalytics({ showLoading: false });
  }

  function closeAnalyticsModal() {
    if (!analyticsModal) {
      return;
    }
    setAnalyticsModalVisibility(false);
    if (lastAnalyticsTrigger) {
      lastAnalyticsTrigger.focus();
    } else if (openAnalyticsBtn && typeof openAnalyticsBtn.focus === 'function') {
      openAnalyticsBtn.focus();
    }
  }

  function setAnalyticsLoadingState(isLoading, { showLoadingText = true } = {}) {
    if (analyticsRefreshBtn) {
      analyticsRefreshBtn.disabled = isLoading;
      if (showLoadingText) {
        analyticsRefreshBtn.textContent = isLoading ? 'Aktualisiere…' : analyticsRefreshBtnDefaultText;
      }
    }
  }

  if (analyticsModal) {
    setAnalyticsModalVisibility(false);
    analyticsModal.addEventListener('click', (event) => {
      if (event.target === analyticsModal) {
        closeAnalyticsModal();
      }
    });
  }

  if (openAnalyticsBtn && analyticsModal) {
    openAnalyticsBtn.addEventListener('click', () => {
      openAnalyticsModal();
    });
  }

  if (closeAnalyticsBtn) {
    closeAnalyticsBtn.addEventListener('click', () => {
      closeAnalyticsModal();
    });
  }

  if (analyticsRefreshBtn) {
    analyticsRefreshBtn.addEventListener('click', () => {
      loadAnalytics({ showLoading: true });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (configModal?.style.display === 'flex') {
        closeConfigModal();
      }
      if (analyticsModal?.style.display === 'flex') {
        closeAnalyticsModal();
      }
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
  phoenixPulseStatus = document.getElementById('phoenix-pulse-status');
  const ambiencePlaylistContainer = document.getElementById('ambience-playlists');
  const ambienceStingerContainer = document.getElementById('ambience-stingers');
  const ambienceLightingContainer = document.getElementById('ambience-lighting');
  const ambiencePreviewList = document.getElementById('ambience-preview-list');
  const playlistAudioEl = document.getElementById('narrator-playlist-audio');
  const stingerAudioEl = document.getElementById('narrator-stinger-audio');

  const ambienceManager = (() => {
    if (!document || !document.body) {
      return {
        init() {},
        setPhaseAmbience() {},
        setNightStep() {},
        clearNightStep() {},
        setEventAmbience() {},
        flashPhoenixPulse() {},
        triggerStinger() {},
        setManualPlaylist() {},
        setManualLighting() {},
        getSnapshot() {
          return {
            activePlaylist: null,
            playlistSource: null,
            activeLighting: null,
            lightingSource: null,
            activeParticles: null,
            particleSource: null,
            overlays: [],
            manualPlaylist: null,
            manualLighting: null
          };
        }
      };
    }

    const MANUAL_STOP_ID = '__manual-stop__';
    const MANUAL_NEUTRAL_ID = '__manual-neutral__';
    const isJsDom = typeof window !== 'undefined'
      && !!window.navigator
      && typeof window.navigator.userAgent === 'string'
      && window.navigator.userAgent.toLowerCase().includes('jsdom');
    const playlistButtons = new Map();
    const lightingButtons = new Map();
    const manualState = { playlist: null, lighting: null };
    const sourcePriority = ['manual', 'step', 'event', 'phase'];
    const playlistSources = { manual: null, event: null, step: null, phase: null };
    const lightingSources = { manual: null, event: null, step: null, phase: null };
    const particleSources = { manual: null, event: null, step: null, phase: null };
    const overlaySources = {
      manual: new Set(),
      event: new Set(),
      step: new Set(),
      phase: new Set()
    };
    const overlayFlags = new Set();
    let activePlaylistId = null;
    let activePlaylistSource = null;
    let activeLightingId = null;
    let activeLightingSource = null;
    let activeParticleId = null;
    let activeParticleSource = null;
    let playlistTransition = Promise.resolve();

    function resolveSource(map) {
      for (const source of sourcePriority) {
        const candidate = map[source];
        if (candidate) {
          return { id: candidate, source };
        }
      }
      return { id: null, source: null };
    }

    const clampVolume = (value) => {
      if (!Number.isFinite(value)) {
        return 0;
      }
      if (value < 0) {
        return 0;
      }
      if (value > 1) {
        return 1;
      }
      return value;
    };

    function safePause(audio) {
      if (isJsDom || !audio || typeof audio.pause !== 'function') {
        return;
      }
      try {
        audio.pause();
      } catch (error) {
        // ignore jsdom not implemented errors
      }
    }

    function safePlay(audio) {
      if (isJsDom || !audio || typeof audio.play !== 'function') {
        return null;
      }
      try {
        const result = audio.play();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
        return result;
      } catch (error) {
        return null;
      }
    }

    function fadeAudio(audio, targetVolume, duration = 400) {
      if (!audio || typeof audio.volume !== 'number') {
        return Promise.resolve();
      }
      const startVolume = clampVolume(audio.volume);
      const endVolume = clampVolume(Number.isFinite(targetVolume) ? targetVolume : 0);
      const delta = endVolume - startVolume;
      if (Math.abs(delta) < 0.001 || duration <= 0) {
        audio.volume = endVolume;
        return Promise.resolve();
      }
      if (isJsDom) {
        audio.volume = endVolume;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const step = (timestamp) => {
          const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? timestamp
            : Date.now();
          const progress = Math.min(1, (now - startTime) / duration);
          const nextVolume = clampVolume(startVolume + delta * progress);
          audio.volume = nextVolume;
          if (progress < 1) {
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(step);
            } else {
              setTimeout(() => step(Date.now()), 16);
            }
          } else {
            resolve();
          }
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(step);
        } else {
          setTimeout(() => step(Date.now()), 16);
        }
      });
    }

    function updateOverlay() {
      overlayFlags.clear();
      sourcePriority.forEach((source) => {
        overlaySources[source].forEach((flag) => overlayFlags.add(flag));
      });
      if (overlayFlags.size > 0) {
        document.body.dataset.overlay = Array.from(overlayFlags).join(' ');
      } else {
        delete document.body.dataset.overlay;
      }
      updatePreview();
    }

    function setOverlayForSource(source, flags) {
      overlaySources[source] = new Set(Array.isArray(flags) ? flags : []);
      updateOverlay();
    }

    function setParticleSource(source, id) {
      particleSources[source] = id || null;
      syncParticles();
    }

    function setPlaylistSource(source, id) {
      const nextId = typeof id === 'string' ? id : null;
      playlistSources[source] = nextId;
      if (source === 'manual') {
        manualState.playlist = nextId;
        updateManualButtons();
      }
      syncPlaylist();
    }

    function setLightingSource(source, id) {
      const nextId = typeof id === 'string' ? id : null;
      lightingSources[source] = nextId;
      const preset = id ? lightingPresets[id] : null;
      const particles = preset && preset.particles ? preset.particles : null;
      setParticleSource(source, particles);
      setOverlayForSource(source, preset && Array.isArray(preset.overlay) ? preset.overlay : []);
      if (source === 'manual') {
        manualState.lighting = nextId;
        updateManualButtons();
      }
      syncLighting();
    }

    function syncPlaylist() {
      const { id: nextId, source: nextSource } = resolveSource(playlistSources);
      if (nextId === activePlaylistId && nextSource === activePlaylistSource) {
        updatePreview();
        return;
      }
      const prevId = activePlaylistId;
      activePlaylistId = nextId;
      activePlaylistSource = nextSource;
      playlistTransition = playlistTransition.then(async () => {
        if (!playlistAudioEl) {
          updatePreview();
          return;
        }
        if (prevId && prevId !== nextId && prevId !== MANUAL_STOP_ID) {
          await fadeAudio(playlistAudioEl, 0, 320);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
        }
        if (!nextId || nextId === MANUAL_STOP_ID) {
          await fadeAudio(playlistAudioEl, 0, 220);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
          playlistAudioEl.removeAttribute('src');
          updatePreview();
          return;
        }
        const config = narratorAudioLibrary.playlists[nextId];
        if (config) {
          if (playlistAudioEl.src !== config.src) {
            playlistAudioEl.src = config.src;
          }
          playlistAudioEl.loop = config.loop !== false;
          safePlay(playlistAudioEl);
          playlistAudioEl.volume = 0;
          await fadeAudio(playlistAudioEl, config.volume ?? 0.6, 620);
        } else {
          await fadeAudio(playlistAudioEl, 0, 220);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
          playlistAudioEl.removeAttribute('src');
        }
        updatePreview();
      });
    }

    function syncLighting() {
      const { id: nextId, source: nextSource } = resolveSource(lightingSources);
      if (nextId === activeLightingId && nextSource === activeLightingSource) {
        updatePreview();
        return;
      }
      activeLightingId = nextId;
      activeLightingSource = nextSource;
      if (nextId && nextId !== MANUAL_NEUTRAL_ID) {
        document.body.dataset.lighting = nextId;
      } else {
        delete document.body.dataset.lighting;
      }
      updatePreview();
    }

    function syncParticles() {
      const { id: nextId, source: nextSource } = resolveSource(particleSources);
      if (nextId === activeParticleId && nextSource === activeParticleSource) {
        updatePreview();
        return;
      }
      activeParticleId = nextId;
      activeParticleSource = nextSource;
      if (nextId) {
        document.body.dataset.particles = nextId;
      } else {
        delete document.body.dataset.particles;
      }
      updatePreview();
    }

    function triggerStinger(id) {
      const config = narratorAudioLibrary.stingers[id];
      if (!stingerAudioEl || !config) {
        return;
      }
      safePause(stingerAudioEl);
      stingerAudioEl.currentTime = 0;
      stingerAudioEl.src = config.src;
      stingerAudioEl.volume = 0;
      safePlay(stingerAudioEl);
      fadeAudio(stingerAudioEl, config.volume ?? 0.85, 140).then(() => {
        setTimeout(() => {
          fadeAudio(stingerAudioEl, 0, 220).then(() => {
            safePause(stingerAudioEl);
            stingerAudioEl.currentTime = 0;
          });
        }, 260);
      });
    }

    function updateManualButtons() {
      playlistButtons.forEach((btn, id) => {
        btn.setAttribute('aria-pressed', manualState.playlist === id ? 'true' : 'false');
      });
      lightingButtons.forEach((btn, id) => {
        btn.setAttribute('aria-pressed', manualState.lighting === id ? 'true' : 'false');
      });
    }

    function buildControls() {
      playlistButtons.clear();
      lightingButtons.clear();
      if (ambiencePlaylistContainer) {
        ambiencePlaylistContainer.innerHTML = '';
      }
      if (ambienceStingerContainer) {
        ambienceStingerContainer.innerHTML = '';
      }
      if (ambienceLightingContainer) {
        ambienceLightingContainer.innerHTML = '';
      }
      if (ambiencePlaylistContainer) {
        Object.values(narratorAudioLibrary.playlists).forEach((config) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = config.label;
          btn.dataset.id = config.id;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', () => {
            const nextId = manualState.playlist === config.id ? null : config.id;
            setManualPlaylist(nextId);
          });
          ambiencePlaylistContainer.appendChild(btn);
          playlistButtons.set(config.id, btn);
        });
        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'ambience-toggle';
        stopBtn.textContent = '⏹️ Stoppen';
        stopBtn.setAttribute('aria-pressed', 'false');
        stopBtn.addEventListener('click', () => {
          const nextId = manualState.playlist === MANUAL_STOP_ID ? null : MANUAL_STOP_ID;
          setManualPlaylist(nextId);
        });
        stopBtn.dataset.id = MANUAL_STOP_ID;
        ambiencePlaylistContainer.appendChild(stopBtn);
        playlistButtons.set(MANUAL_STOP_ID, stopBtn);
      }

      if (ambienceStingerContainer) {
        Object.values(narratorAudioLibrary.stingers).forEach((config) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = config.label;
          btn.addEventListener('click', () => {
            triggerStinger(config.id);
          });
          ambienceStingerContainer.appendChild(btn);
        });
      }

      if (ambienceLightingContainer) {
        Object.entries(lightingPresets).forEach(([id, preset]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = preset.label;
          btn.dataset.id = id;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', () => {
            const nextId = manualState.lighting === id ? null : id;
            setManualLighting(nextId);
          });
          ambienceLightingContainer.appendChild(btn);
          lightingButtons.set(id, btn);
        });
        const neutralBtn = document.createElement('button');
        neutralBtn.type = 'button';
        neutralBtn.className = 'ambience-toggle';
        neutralBtn.textContent = '🌫️ Neutral';
        neutralBtn.setAttribute('aria-pressed', 'false');
        neutralBtn.addEventListener('click', () => {
          const nextId = manualState.lighting === MANUAL_NEUTRAL_ID ? null : MANUAL_NEUTRAL_ID;
          setManualLighting(nextId);
        });
        neutralBtn.dataset.id = MANUAL_NEUTRAL_ID;
        ambienceLightingContainer.appendChild(neutralBtn);
        lightingButtons.set(MANUAL_NEUTRAL_ID, neutralBtn);
      }

      updateManualButtons();
    }

    function updatePreview() {
      if (!ambiencePreviewList) {
        return;
      }
      ambiencePreviewList.innerHTML = '';
      const entries = [];
      if (activePlaylistId === MANUAL_STOP_ID) {
        entries.push({ icon: '🎵', label: '⏹️ Stumm', source: activePlaylistSource });
      } else if (activePlaylistId) {
        const config = narratorAudioLibrary.playlists[activePlaylistId];
        const label = config ? config.label : activePlaylistId;
        entries.push({ icon: '🎵', label, source: activePlaylistSource });
      }
      if (activeLightingId === MANUAL_NEUTRAL_ID) {
        entries.push({ icon: '💡', label: '🌫️ Neutral', source: activeLightingSource });
      } else if (activeLightingId) {
        const preset = lightingPresets[activeLightingId];
        const label = preset ? preset.label : activeLightingId;
        entries.push({ icon: '💡', label, source: activeLightingSource });
      }
      if (activeParticleId) {
        entries.push({ icon: '✨', label: activeParticleId, source: activeParticleSource });
      }
      overlayFlags.forEach((flag) => {
        const label = overlayLabels[flag] || flag;
        entries.push({ icon: '🌌', label, source: 'event' });
      });

      if (entries.length === 0) {
        const item = document.createElement('li');
        item.className = 'ambience-empty';
        item.textContent = 'Keine Effekte aktiv.';
        ambiencePreviewList.appendChild(item);
        return;
      }

      entries.forEach((entry) => {
        const li = document.createElement('li');
        const iconSpan = document.createElement('span');
        iconSpan.textContent = entry.icon;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = entry.label;
        li.appendChild(iconSpan);
        li.appendChild(labelSpan);
        if (entry.source) {
          const tag = document.createElement('span');
          tag.className = 'ambience-tag';
          tag.textContent = sourceLabels[entry.source] || entry.source;
          li.appendChild(tag);
        }
        ambiencePreviewList.appendChild(li);
      });
    }

    function setPhaseAmbience(phaseKey) {
      const preset = phaseAmbiencePresets[phaseKey] || phaseAmbiencePresets.setup;
      setPlaylistSource('phase', preset.playlist || null);
      setLightingSource('phase', preset.lighting || null);
      setParticleSource('phase', preset.particles || null);
    }

    function setNightStep(role) {
      const preset = role && nightStepAmbience[role] ? nightStepAmbience[role] : null;
      setPlaylistSource('step', preset && preset.playlist ? preset.playlist : null);
      setLightingSource('step', preset ? preset.lighting || null : null);
      setParticleSource('step', preset ? preset.particles || null : null);
    }

    function setEventAmbience(eventKey, active) {
      if (!active) {
        if (eventKey === 'blood-moon' && playlistSources.event === 'bloodmoon') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'phoenix' && playlistSources.event === 'phoenix') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'victory' && playlistSources.event === 'daybreak') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'blood-moon' && lightingSources.event === 'blood-moon') {
          setLightingSource('event', null);
        }
        if (eventKey === 'phoenix' && lightingSources.event === 'phoenix') {
          setLightingSource('event', null);
        }
        if (eventKey === 'victory' && lightingSources.event === 'victory') {
          setLightingSource('event', null);
        }
        return;
      }
      if (eventKey === 'blood-moon') {
        setPlaylistSource('event', 'bloodmoon');
        setLightingSource('event', 'blood-moon');
      } else if (eventKey === 'phoenix') {
        setPlaylistSource('event', 'phoenix');
        setLightingSource('event', 'phoenix');
      } else if (eventKey === 'victory') {
        setPlaylistSource('event', 'daybreak');
        setLightingSource('event', 'victory');
      }
    }

    function flashPhoenixPulse() {
      setPlaylistSource('step', 'phoenix');
      setLightingSource('step', 'phoenix');
      triggerStinger('phoenixRise');
      setTimeout(() => {
        if (lightingSources.step === 'phoenix') {
          setLightingSource('step', null);
          setPlaylistSource('step', null);
        }
      }, 3600);
    }

    function setManualPlaylist(id) {
      setPlaylistSource('manual', id);
    }

    function setManualLighting(id) {
      setLightingSource('manual', id);
    }

    function getSnapshot() {
      const effectivePlaylist = activePlaylistId === MANUAL_STOP_ID ? null : activePlaylistId;
      const effectiveLighting = activeLightingId === MANUAL_NEUTRAL_ID ? null : activeLightingId;
      return {
        activePlaylist: effectivePlaylist,
        playlistSource: activePlaylistSource,
        activeLighting: effectiveLighting,
        lightingSource: activeLightingSource,
        activeParticles: activeParticleId,
        particleSource: activeParticleSource,
        overlays: Array.from(overlayFlags),
        manualPlaylist: manualState.playlist,
        manualLighting: manualState.lighting,
        manualStopActive: manualState.playlist === MANUAL_STOP_ID,
        manualNeutralActive: manualState.lighting === MANUAL_NEUTRAL_ID
      };
    }

    function init() {
      buildControls();
      setPhaseAmbience('setup');
      syncPlaylist();
      syncLighting();
      syncParticles();
      updateOverlay();
      updatePreview();
    }

    return {
      init,
      setPhaseAmbience,
      setNightStep,
      clearNightStep() {
        setPlaylistSource('step', null);
        setLightingSource('step', null);
        setParticleSource('step', null);
      },
      setEventAmbience,
      flashPhoenixPulse,
      triggerStinger,
      setManualPlaylist,
      setManualLighting,
      getSnapshot
    };
  })();

  const initAmbienceManager = () => {
    try {
      ambienceManager.init();
    } catch (error) {
      console.error('Ambience manager failed to initialize', error);
    }
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(initAmbienceManager);
  } else {
    Promise.resolve().then(initAmbienceManager);
  }

  function showWin(title, message) {
    ambienceManager.setPhaseAmbience('victory');
    ambienceManager.setEventAmbience('victory', true);
    ambienceManager.setEventAmbience('blood-moon', false);
    ambienceManager.setEventAmbience('phoenix', false);
    ambienceManager.clearNightStep();
    winTitle.textContent = title;
    winMessage.textContent = message;
    winOverlay.style.display = 'flex';
    winOverlay.classList.add('show');
    winBtn.onclick = () => location.reload();
    lastWinner = {
      title,
      message,
      timestamp: Date.now()
    };
    queueMicrotask(() => {
      if (typeof loadAnalytics === 'function') {
        loadAnalytics({ showLoading: false });
      }
    });
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
  let lastWinner = null;

  function setBloodMoonState(isActive) {
    bloodMoonActive = !!isActive;
    if (bloodMoonActive) {
      document.body.classList.add('blood-moon-active');
      ambienceManager.setEventAmbience('blood-moon', true);
      ambienceManager.triggerStinger('bloodStrike');
    } else {
      document.body.classList.remove('blood-moon-active');
      ambienceManager.setEventAmbience('blood-moon', false);
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
    ambienceManager.setEventAmbience('phoenix', false);
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
      const deckNameKey = `events.decks.${deck.id}.name`;
      toggleSpan.textContent = localization.t(deckNameKey) || deck.name || deck.id;
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
      sliderLabel.textContent = localization.t('settings.events.deckWeight') || 'Gewichtung';
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

      const deckDescriptionKey = `events.decks.${deck.id}.description`;
      const deckDescription = localization.t(deckDescriptionKey) || deck.description;
      if (deckDescription) {
        const helper = document.createElement('p');
        helper.className = 'config-helper';
        helper.textContent = deckDescription;
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
    freeOption.textContent = localization.t('events.campaigns.freePlay') || 'Freies Spiel';
    campaignSelectEl.appendChild(freeOption);

    campaignDefinitions.forEach(campaign => {
      if (!campaign || !campaign.id) {
        return;
      }
      const option = document.createElement('option');
      option.value = campaign.id;
      const nameKey = `events.campaigns.${campaign.id}.name`;
      const descriptionKey = `events.campaigns.${campaign.id}.description`;
      option.textContent = localization.t(nameKey) || campaign.name || campaign.id;
      option.dataset.description = localization.t(descriptionKey) || campaign.description || '';
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
      li.textContent = localization.t('events.campaigns.noneActive') || 'Keine Kampagne aktiv.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    const executedKeys = new Set(eventEngineState?.campaignProgress?.executed || []);
    const script = Array.isArray(campaign.script) ? campaign.script : [];
    const upcoming = script.filter(step => !executedKeys.has(`${step.night || 0}:${step.eventId || step.id}`));
    if (upcoming.length === 0) {
      const li = document.createElement('li');
      li.textContent = localization.t('events.campaigns.complete') || 'Alle Beats dieser Kampagne wurden erlebt.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    upcoming.sort((a, b) => (a.night || 0) - (b.night || 0));
    upcoming.forEach(step => {
      const li = document.createElement('li');
      const card = eventCardDefinitions.find(entry => entry.id === step.eventId);
      const label = card ? card.label || card.id : step.eventId;
      const titleKey = `events.campaigns.${campaign.id}.stepTitle`;
      const descriptionKey = `events.campaigns.${campaign.id}.stepDescription`;
      const localizedTitle = localization.t(titleKey, { event: label, night: step.night }) || step.title || label;
      const localizedDescription = localization.t(descriptionKey, { event: label, night: step.night })
        || step.description
        || card?.description
        || '';
      const nightLabel = localization.t('events.campaigns.nightLabel', { night: step.night }) || `Nacht ${step.night}`;
      li.innerHTML = `<strong>${escapeHtml(nightLabel)}</strong>: ${escapeHtml(localizedTitle)}${localizedDescription ? ` – ${escapeHtml(localizedDescription)}` : ''}`;
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
    const translated = localization.getJobDisplayName(job);
    if (translated) {
      const fallbackLabel = jobDisplayNames[job];
      if (fallbackLabel && !translated.includes(fallbackLabel)) {
        return `${translated} (${fallbackLabel})`;
      }
      return translated;
    }
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
    const roleLabel = localization.getRoleDisplayName(role) || role;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return roleLabel;
    }
    const displayJobs = jobs.map(getJobDisplayName).filter(Boolean);
    if (displayJobs.length === 0) {
      return roleLabel;
    }
    return `${roleLabel} & ${displayJobs.join(' & ')}`;
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
  let currentlyFlippedCard = null;
  let revealTurnOrder = [];
  let revealTurnIndex = -1;
  let revealCards = [];
  let revealCurrentPlayerHasFlipped = false;

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
      showRoleInfo(input.value || value);
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

  const AUDIO_BASE64 = {
    day: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubw==`.replace(/\s+/g, ''),
    night: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/o8Pf8v399OHHpoNfPiINAgAIGjRUd5u82e/7/vfmza6LZ0UoEQQABhYuTG+TtdPr+f/569O1k29MLhYGAAQRKEVni67N5vf+++/ZvJt3VDQaCAACDSI+X4Omx+H0/f3y38Ojf1s7HwwBAQodN1h7n8Dc8fz+9uTKqodjQiUPAwAHGDFQc5e51u36/vjo0LKPa0krEwUABRMrSWuPstDo+P767da5l3NQMRgHAAMPJUJjh6rK5Pb+/PHcwJ97WDcdCgEBDB87W3+jw9/y/f304cemg18+Ig0CAAgaNFR3m7zZ7/v+9+bNrotnRSgRBAAGFi5Mb5O10+v5//nr07WTb0wuFgYABBEoRWeLrs3m9/7779m8m3dUNBoIAAINIj5fg6bH4fT9/fLfw6N/WzsfDAEBCh03WHufwNzx/P725A==`.replace(/\s+/g, ''),
    blood: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/kaOzw9Lf6vL5/f79+vTs4dXHt6aVg3FfTj4vIhcNBgIAAAMIEBomNENUZXeJm6y8zNnl7/b7/v789/Dm282+rp2LeWdWRTYoGxEJBAAAAQYNFiEuPExdb4GTpLXF0+Dr8/n9//358+vg08W1pJOBb11MPC4hFg0GAQAABAkRGyg2RVZneYudrr7N2+bw9/z+/vv27+XZzLysm4l3ZVRDNCYaEAgDAAACBg0XIi8+Tl9xg5Wmt8fV4ez0+v3+/fny6t/Sw7OjkX9tW0s7LB8UDAUBAAEEChIdKTdHWGl7jZ+wwM/c5/H4/P7++/bu5NjKu6qZh3VjUkIyJRkPCAMAAAIHDhgjMUBQYXOFl6i5yNbj7fX6/v79+PHo3dDCsqGPfWtaSTkrHhMLBQEAAQULEx4rOUlaa32PobLC0N3o8Q==`.replace(/\s+/g, ''),
    phoenix: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/3P7QbxgCO5/v+LVQCAxYvPrrlzQBHXfW/9Z3HQE0l+v6vFgMCFC1+O+fOwIYb9D+3H8iAC6P5vzDXw8GSa728qZCBBNnyv3hhygAKIfh/cpnEwRCpvL2rkkGD1/D/OaPLgAif9z+0G8YAjuf7/i1UAgMWLz665c0AR131v/Wdx0BNJfr+rxYDAhQtfjvnzsCGG/Q/tx/IgAuj+b8w18PBkmu9vKmQgQTZ8r94YcoACiH4f3KZxMEQqby9q5JBg9fw/zmjy4AIn/c/tBvGAI7n+/4tVAIDFi8+uuXNAEdd9b/1ncdATSX6/q8WAwIULX47587Ahhv0P7cfyIALo/m/MNfDwZJrvbypkIEE2fK/eGHKAAoh+H9ymcTBEKm8vauSQYPX8P85o8uACJ/3P7QbxgCO5/v+LVQCAxYvPrrlw==`.replace(/\s+/g, '')
  };

  const narratorAudioLibrary = {
    playlists: {
      daybreak: { id: 'daybreak', label: '🌅 Morgendämmerung', src: `data:audio/wav;base64,${AUDIO_BASE64.day}`, loop: true, volume: 0.55 },
      nightwatch: { id: 'nightwatch', label: '🌙 Nachtwache', src: `data:audio/wav;base64,${AUDIO_BASE64.night}`, loop: true, volume: 0.5 },
      bloodmoon: { id: 'bloodmoon', label: '🩸 Blutmond-Dröhnen', src: `data:audio/wav;base64,${AUDIO_BASE64.blood}`, loop: true, volume: 0.58 },
      phoenix: { id: 'phoenix', label: '🔥 Phoenix-Aufgang', src: `data:audio/wav;base64,${AUDIO_BASE64.phoenix}`, loop: true, volume: 0.6 }
    },
    stingers: {
      bloodStrike: { id: 'bloodStrike', label: 'Werwolf-Heulen', src: `data:audio/wav;base64,${AUDIO_BASE64.blood}`, volume: 0.85 },
      phoenixRise: { id: 'phoenixRise', label: 'Phoenix-Aufstieg', src: `data:audio/wav;base64,${AUDIO_BASE64.phoenix}`, volume: 0.9 }
    }
  };

  const lightingPresets = {
    day: { label: 'Tageslicht', particles: 'motes' },
    night: { label: 'Nachtwache', particles: 'embers' },
    ritual: { label: 'Ritualglut', particles: 'embers' },
    witch: { label: 'Hexenglut', particles: 'aurora' },
    seer: { label: 'Seherblick', particles: 'aurora' },
    hunter: { label: 'Jägerfeuer', particles: 'sparks' },
    'blood-moon': { label: 'Blutmond', particles: 'embers', overlay: ['blood-moon'] },
    phoenix: { label: 'Phoenix Pulse', particles: 'phoenix', overlay: ['phoenix'] },
    victory: { label: 'Triumphlicht', particles: 'sparks' }
  };

  const phaseAmbiencePresets = {
    setup: { playlist: null, lighting: null, particles: null },
    night: { playlist: 'nightwatch', lighting: 'night', particles: 'embers' },
    day: { playlist: 'daybreak', lighting: 'day', particles: 'motes' },
    victory: { playlist: 'daybreak', lighting: 'victory', particles: 'sparks' }
  };

  const nightStepAmbience = {
    Werwolf: { lighting: 'ritual', particles: 'embers' },
    Hexe: { lighting: 'witch', particles: 'aurora' },
    Seer: { lighting: 'seer', particles: 'aurora' },
    Inquisitor: { lighting: 'seer', particles: 'aurora' },
    Jäger: { lighting: 'hunter', particles: 'sparks' },
    Amor: { lighting: 'ritual', particles: 'motes' },
    Doctor: { lighting: 'day', particles: 'motes' },
    Bodyguard: { lighting: 'night', particles: 'embers' },
    'Stumme Jule': { lighting: 'witch', particles: 'aurora' },
    Geschwister: { lighting: 'night', particles: 'motes' }
  };

  const sourceLabels = {
    manual: 'Manuell',
    event: 'Event',
    step: 'Schritt',
    phase: 'Phase'
  };

  const overlayLabels = {
    'blood-moon': 'Blutmond-Schleier',
    phoenix: 'Phoenix-Resonanz'
  };

  /* -------------------- Erste Nacht Logik -------------------- */

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

  const timerEventHistory = [];
  let timerEventCounter = 0;

  function recordTimerEvent(kind, payload = {}) {
    timerEventCounter += 1;
    const timestamp = Date.now();
    const event = {
      id: `timer-${timestamp}-${timerEventCounter}`,
      sequence: timerEventCounter,
      kind,
      timestamp,
      metadata: {
        ...payload,
        dayCount,
        nightCounter,
        phase: nightMode ? 'night' : (dayMode ? 'day' : 'setup')
      }
    };
    timerEventHistory.push(event);
    if (timerEventHistory.length > 200) {
      timerEventHistory.shift();
    }
    return event;
  }

  function resetTimerEventHistory() {
    timerEventHistory.length = 0;
    timerEventCounter = 0;
  }

  const phaseTimerManager = (() => {
    let timers = new Map();
    let paused = false;
    let onChange = () => {};
    let counter = 0;

    function notifyChange() {
      onChange();
    }

    function serializeTimer(timer) {
      return {
        id: timer.id,
        label: timer.label,
        delay: timer.delay,
        remaining: timer.remaining
      };
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
        recordTimerEvent('triggered', { timerId: id, label });
        callback();
        notifyChange();
      };

      timer.run = run;

      if (!paused) {
        timer.timeoutId = setTimeout(run, delay);
      }

      timers.set(id, timer);
      recordTimerEvent('scheduled', { timerId: id, label, delay });
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
      recordTimerEvent('paused', { timers: Array.from(timers.values()).map(serializeTimer) });
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
            recordTimerEvent('triggered', { timerId: timer.id, label: timer.label });
            timer.callback();
            notifyChange();
          }, 0);
        } else {
          timer.timeoutId = setTimeout(() => {
            timers.delete(timer.id);
            recordTimerEvent('triggered', { timerId: timer.id, label: timer.label });
            timer.callback();
            notifyChange();
          }, timer.remaining);
        }
      });
      recordTimerEvent('resumed', { timers: Array.from(timers.values()).map(serializeTimer) });
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
      recordTimerEvent('cancelled', { timerId: id, label: timer.label });
      notifyChange();
      return true;
    }

    function cancelAll() {
      const activeTimers = Array.from(timers.values()).map(serializeTimer);
      timers.forEach(timer => {
        if (timer.timeoutId) {
          clearTimeout(timer.timeoutId);
        }
      });
      timers.clear();
      recordTimerEvent('cancelled_all', { timers: activeTimers });
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

    function history() {
      return timerEventHistory.slice();
    }

    function resetHistory() {
      resetTimerEventHistory();
    }

    return { schedule, pause, resume, cancel, cancelAll, list, setOnChange, isPaused, history, resetHistory };
  })();

  const gameCheckpoints = [];
  let checkpointCounter = 0;
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
    logAction({
      type: 'night',
      label: logLabel || undefined,
      detail,
      logKey: 'bodyguard.saved',
      params: { player: target }
    });
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
      phoenixPulseStatus.textContent = localization.t('phoenix.status.disabled') || 'Phoenix Pulse: deaktiviert';
      return;
    }

    if (phoenixPulsePending) {
      phoenixPulseStatus.textContent = localization.t('phoenix.status.ready') || 'Phoenix Pulse: bereit';
      phoenixPulseStatus.classList.add('active');
    } else if (phoenixPulseJustResolved && phoenixPulseRevivedPlayers.length > 0) {
      const revivedList = phoenixPulseRevivedPlayers.join(', ');
      phoenixPulseStatus.textContent = localization.t('phoenix.status.resolved', { players: revivedList })
        || `Phoenix Pulse: ${revivedList} zurück`;
      phoenixPulseStatus.classList.add('resolved');
    } else {
      phoenixPulseStatus.textContent = localization.t('phoenix.status.default') || 'Phoenix Pulse: –';
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

      ambienceManager.flashPhoenixPulse();

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
      ambienceManager.clearNightStep();
      nightOverlay.style.display = "none";
      startDayPhase();
      return;
    }
    
    const role = nightSteps[nightIndex];
    // Normalize role name for comparison
    const normalizedRole = role.toLowerCase();
    ambienceManager.setNightStep(role);

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
                const prompt = escapeHtml(nightTexts['Werwolf'] || 'Werwölfe wachen auf.');
                nightTextEl.innerHTML = `${prompt}<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.`;
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
      const prompt = escapeHtml(nightTexts[role] || 'Der Arzt wacht auf.');
      if (targets.length > 0) {
        const targetText = targets.map((name) => escapeHtml(name)).join(', ');
        nightTextEl.innerHTML = `${prompt}<br><small>Verfügbare Ziele: ${targetText}</small>`;
        renderPlayerChoices(1, targets);
      } else {
        nightTextEl.innerHTML = `${prompt}<br><small>Es gibt niemanden zu heilen.</small>`;
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
            const henkerName = escapeHtml(henker.player || '');
            const targetName = escapeHtml(henker.target || '');
            nightTextEl.innerHTML = `Der Henker ist <strong>${henkerName}</strong>.<br>Sein Ziel, das gelyncht werden muss, ist <strong>${targetName}</strong>.`;
        } else {
            nightTextEl.textContent = nightTexts[role];
        }
        nightChoices.innerHTML = "";
        nightChoices.style.display = "none";
    } else if (role === "Geschwister") {
      if (dayCount === 0) { // Only on the first night
        const otherGeschwister = geschwister.filter(p => !deadPlayers.includes(p));
        const siblingText = otherGeschwister.map((name) => escapeHtml(name)).join(', ');
        nightTextEl.innerHTML = `Ihr seid die Geschwister. Die anderen Geschwister sind: <br><strong>${siblingText}</strong>`;
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
    ambienceManager.setPhaseAmbience('day');
    ambienceManager.clearNightStep();

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
            logAction({
              type: 'night',
              logKey: 'doctor.skipped',
              params: {},
              detail: 'Keine Heilung gewählt'
            });
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
          logAction({
            type: 'night',
            logKey: 'doctor.healed',
            params: { player: name },
            detail: name
          });
        } else {
          if (resultOutput) {
            resultOutput.innerHTML += `<br>🩺 Der Arzt wollte ${name} heilen, aber die Person lebt bereits.`;
          }
          logAction({
            type: 'night',
            logKey: 'doctor.alive',
            params: { player: name },
            detail: `${name} war bereits am Leben`
          });
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
    ambienceManager.setPhaseAmbience('night');
    ambienceManager.clearNightStep();
    updateBodyguardPlayers();
    const livingRoleSet = getLivingRoleSet();
    const upcomingNightNumber = nightCounter + 1;
    const doctorTargets = getDoctorAvailableTargets();
    if (doctorPendingNight !== null && doctorPendingNight < upcomingNightNumber) {
      clearDoctorPending();
    }
    const doctorShouldAct = hasActiveDoctor()
      && doctorPendingNight === upcomingNightNumber
      && doctorTargets.length > 0;
    if (doctorPendingNight === upcomingNightNumber && doctorTargets.length === 0) {
      clearDoctorPending();
    }

    nightSteps = generateNightSteps({ doctorShouldAct, livingRoleSet });

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

  function applyLobbyWriteState(canWrite) {
    const hint = canWrite ? '' : READ_ONLY_HINT;

    const writableControls = [
      saveNamesBtn,
      saveRolesBtn,
      saveGameBtn,
      roleEditorSaveBtn,
      roleEditorResetBtn,
      roleEditorAddRoleBtn,
      roleEditorAddJobBtn,
      roleEditorAddNightStepBtn,
    ];

    writableControls.forEach((control) => {
      if (!control) {
        return;
      }
      control.disabled = !canWrite;
      if ('title' in control) {
        control.title = hint;
      }
      control.classList.toggle('read-only', !canWrite);
    });

    const writableInputs = [
      eventsEnabledCheckbox,
      bloodMoonEnabledCheckbox,
      firstNightShieldCheckbox,
      phoenixPulseEnabledCheckbox,
      revealDeadRolesCheckbox,
      bloodMoonChanceInput,
      phoenixPulseChanceInput,
      bodyguardJobChanceInput,
      doctorJobChanceInput,
    ];

    writableInputs.forEach((input) => {
      if (!input) {
        return;
      }
      input.disabled = !canWrite;
      if ('title' in input) {
        input.title = hint;
      }
      input.classList.toggle('read-only', !canWrite);
    });
  }

  lobbyUiInitialized = true;
  updateWriteControlsState();
  if (pendingSessionReload) {
    loadSessions();
    pendingSessionReload = false;
  }

  function refreshRoleInputsFromSchema({ preserveExisting = false } = {}) {
    const previousSnapshot = preserveExisting ? getRoleLayoutSnapshot() : null;
    const knownRoles = new Set([
      ...categorizedRoles.village,
      ...categorizedRoles.werwolf,
      ...categorizedRoles.special
    ]);
    rolesContainerVillage.innerHTML = "";
    rolesContainerWerwolf.innerHTML = "";
    rolesContainerSpecial.innerHTML = "";

    const applyCategory = (categoryKey, roleList, container) => {
      roleList.forEach((roleName) => {
        const qty = previousSnapshot && previousSnapshot[categoryKey]
          ? previousSnapshot[categoryKey][roleName] ?? 0
          : 0;
        addRoleRow(roleName, qty, container);
      });
    };

    applyCategory('village', categorizedRoles.village, rolesContainerVillage);
    applyCategory('werwolf', categorizedRoles.werwolf, rolesContainerWerwolf);
    applyCategory('special', categorizedRoles.special, rolesContainerSpecial);

    if (previousSnapshot) {
      ['village', 'werwolf', 'special'].forEach((categoryKey) => {
        const entries = previousSnapshot[categoryKey] || {};
        Object.keys(entries).forEach((roleName) => {
          if (!knownRoles.has(roleName)) {
            addRoleRow(roleName, entries[roleName] || 0, rolesContainerSpecial);
          }
        });
      });
    }
  }

  roleEditorStatusEl = document.getElementById('role-editor-status');
  roleEditorRolesEl = document.getElementById('role-editor-roles');
  roleEditorJobsEl = document.getElementById('role-editor-jobs');
  roleEditorNightListEl = document.getElementById('role-editor-night-list');
  roleEditorAddRoleBtn = document.getElementById('role-editor-add-role');
  roleEditorAddJobBtn = document.getElementById('role-editor-add-job');
  roleEditorAddNightStepBtn = document.getElementById('role-editor-add-night-step');
  roleEditorSaveBtn = document.getElementById('role-editor-save');
  roleEditorResetBtn = document.getElementById('role-editor-reset');

  roleEditorReady = Boolean(roleEditorRolesEl && roleEditorJobsEl && roleEditorNightListEl);
  roleEditorState = null;
  roleEditorDirty = false;
  const nightDragState = { draggingId: null };

  function ensureRoleEditorStateStructure() {
    if (!roleEditorState || typeof roleEditorState !== 'object') {
      roleEditorState = getRoleSchemaSnapshot();
    }
    if (!roleEditorState || typeof roleEditorState !== 'object') {
      roleEditorState = { version: roleSchema.version || 1, categories: roleSchema.categories.slice(), roles: [], jobs: [], night: { sequence: [] } };
    }
    if (!Array.isArray(roleEditorState.categories) || roleEditorState.categories.length === 0) {
      roleEditorState.categories = roleSchema.categories.slice();
    }
    if (!Array.isArray(roleEditorState.roles)) {
      roleEditorState.roles = [];
    }
    if (!Array.isArray(roleEditorState.jobs)) {
      roleEditorState.jobs = [];
    }
    if (!roleEditorState.night || typeof roleEditorState.night !== 'object') {
      roleEditorState.night = { sequence: [] };
    }
    if (!Array.isArray(roleEditorState.night.sequence)) {
      roleEditorState.night.sequence = [];
    }
  }

  function createRoleTemplate() {
    ensureRoleEditorStateStructure();
    return { name: '', category: 'special', description: '', abilities: [] };
  }

  function createJobTemplate() {
    ensureRoleEditorStateStructure();
    return { name: '', description: '', eligibleRoles: [] };
  }

  function createNightStepTemplate() {
    ensureRoleEditorStateStructure();
    const nextIndex = Array.isArray(roleEditorState?.night?.sequence)
      ? roleEditorState.night.sequence.length
      : 0;
    return {
      id: `Schritt ${nextIndex + 1}`,
      prompt: '',
      requires: { roles: [], jobs: [] },
      conditions: {},
      phase: 'night'
    };
  }

  function updateRoleEditorStatus() {
    if (roleEditorStatusEl) {
      const sourceText = roleSchemaSource === 'custom' ? 'Benutzerdefiniert' : 'Standard';
      roleEditorStatusEl.textContent = roleEditorDirty
        ? `Konfiguration: ${sourceText} – Änderungen nicht gespeichert`
        : `Konfiguration: ${sourceText}`;
    }
    if (roleEditorSaveBtn) {
      roleEditorSaveBtn.disabled = !roleEditorDirty;
    }
  }

  function markRoleEditorDirty() {
    if (!roleEditorReady) {
      return;
    }
    roleEditorDirty = true;
    updateRoleEditorStatus();
  }

  function renameRoleReferences(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return;
    }
    if (Array.isArray(roleEditorState?.jobs)) {
      roleEditorState.jobs.forEach((job) => {
        if (!Array.isArray(job.eligibleRoles)) {
          job.eligibleRoles = [];
          return;
        }
        job.eligibleRoles = job.eligibleRoles.map((roleName) => (roleName === oldName ? newName : roleName));
      });
    }
    if (Array.isArray(roleEditorState?.night?.sequence)) {
      roleEditorState.night.sequence.forEach((step) => {
        if (!Array.isArray(step?.requires?.roles)) {
          return;
        }
        step.requires.roles = step.requires.roles.map((roleName) => (roleName === oldName ? newName : roleName));
      });
    }
  }

  function renameJobReferences(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return;
    }
    if (Array.isArray(roleEditorState?.night?.sequence)) {
      roleEditorState.night.sequence.forEach((step) => {
        if (!Array.isArray(step?.requires?.jobs)) {
          return;
        }
        step.requires.jobs = step.requires.jobs.map((jobName) => (jobName === oldName ? newName : jobName));
      });
    }
  }

  function updateRoleJobSummaries() {
    if (!roleEditorReady || !roleEditorRolesEl) {
      return;
    }
    const jobMap = new Map();
    if (Array.isArray(roleEditorState?.jobs)) {
      roleEditorState.jobs.forEach((job) => {
        const jobName = job?.name || '';
        if (!jobName) {
          return;
        }
        const eligible = Array.isArray(job.eligibleRoles) ? job.eligibleRoles : [];
        eligible.forEach((roleName) => {
          if (!jobMap.has(roleName)) {
            jobMap.set(roleName, []);
          }
          jobMap.get(roleName).push(jobName);
        });
      });
    }
    roleEditorRolesEl.querySelectorAll('[data-role-summary]').forEach((summaryEl) => {
      const roleName = summaryEl.dataset.roleSummary || '';
      summaryEl.innerHTML = '';
      const jobs = jobMap.get(roleName) || [];
      if (jobs.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'admin-helper-text';
        hint.textContent = 'Keine Jobs';
        summaryEl.appendChild(hint);
        return;
      }
      jobs.forEach((jobName) => {
        const badge = document.createElement('span');
        const modifier = getJobClassModifier(jobName);
        badge.className = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
        badge.textContent = getJobDisplayName(jobName);
        summaryEl.appendChild(badge);
      });
    });
  }

  function renderRoleEditorRoles() {
    if (!roleEditorReady || !roleEditorRolesEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorRolesEl.innerHTML = '';
    const categoryOptions = [
      { value: 'village', label: 'Dorfbewohner' },
      { value: 'werwolf', label: 'Werwölfe' },
      { value: 'special', label: 'Sonderrollen' }
    ];
    const roles = Array.isArray(roleEditorState?.roles) ? roleEditorState.roles : [];
    roles.forEach((role, index) => {
      const card = document.createElement('div');
      card.className = 'role-editor-role';
      card.dataset.roleIndex = String(index);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Rollenname';
      nameInput.value = role?.name || '';
      nameInput.setAttribute('aria-label', `Rollenname ${index + 1}`);
      nameInput.dataset.previousValue = role?.name || '';
      const summaryEl = document.createElement('div');
      summaryEl.className = 'role-editor-role-jobs';
      summaryEl.dataset.roleSummary = role?.name || '';

      nameInput.addEventListener('focus', () => {
        nameInput.dataset.previousValue = role?.name || '';
      });
      nameInput.addEventListener('input', (event) => {
        role.name = event.target.value;
        summaryEl.dataset.roleSummary = event.target.value;
        markRoleEditorDirty();
        updateRoleEditorStatus();
      });
      nameInput.addEventListener('blur', () => {
        const previous = nameInput.dataset.previousValue || '';
        const normalized = nameInput.value.trim();
        if (normalized !== role.name) {
          role.name = normalized;
        }
        nameInput.value = normalized;
        summaryEl.dataset.roleSummary = normalized;
        if (previous && normalized && previous !== normalized) {
          renameRoleReferences(previous, normalized);
          renderRoleEditorJobs();
          renderRoleEditorNight();
        }
        updateRoleJobSummaries();
        updateRoleEditorStatus();
      });

      const categorySelect = document.createElement('select');
      categorySelect.setAttribute('aria-label', `Kategorie für ${role?.name || 'Rolle'}`);
      categoryOptions.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        if ((role?.category || 'special') === option.value) {
          opt.selected = true;
        }
        categorySelect.appendChild(opt);
      });
      categorySelect.addEventListener('change', (event) => {
        role.category = event.target.value;
        markRoleEditorDirty();
      });

      const descriptionTextarea = document.createElement('textarea');
      descriptionTextarea.placeholder = 'Beschreibung';
      descriptionTextarea.value = role?.description || '';
      descriptionTextarea.setAttribute('aria-label', `Beschreibung für ${role?.name || 'Rolle'}`);
      descriptionTextarea.addEventListener('input', (event) => {
        role.description = event.target.value;
        markRoleEditorDirty();
      });

      const abilityTextarea = document.createElement('textarea');
      abilityTextarea.placeholder = 'Fähigkeiten (eine pro Zeile)';
      abilityTextarea.value = Array.isArray(role?.abilities) ? role.abilities.join('\n') : '';
      abilityTextarea.setAttribute('aria-label', `Fähigkeiten für ${role?.name || 'Rolle'}`);
      abilityTextarea.addEventListener('input', (event) => {
        const lines = event.target.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        role.abilities = lines;
        markRoleEditorDirty();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Rolle entfernen';
      removeBtn.addEventListener('click', () => {
        const removed = roles.splice(index, 1)[0];
        if (removed && removed.name) {
          const name = removed.name;
          if (Array.isArray(roleEditorState?.jobs)) {
            roleEditorState.jobs.forEach((job) => {
              if (Array.isArray(job.eligibleRoles)) {
                job.eligibleRoles = job.eligibleRoles.filter((roleName) => roleName !== name);
              }
            });
          }
          if (Array.isArray(roleEditorState?.night?.sequence)) {
            roleEditorState.night.sequence.forEach((step) => {
              if (Array.isArray(step?.requires?.roles)) {
                step.requires.roles = step.requires.roles.filter((roleName) => roleName !== name);
              }
            });
          }
        }
        markRoleEditorDirty();
        renderRoleEditorRoles();
        renderRoleEditorJobs();
        renderRoleEditorNight();
        updateRoleJobSummaries();
      });

      card.appendChild(nameInput);
      card.appendChild(categorySelect);
      card.appendChild(descriptionTextarea);
      card.appendChild(abilityTextarea);
      card.appendChild(summaryEl);
      card.appendChild(removeBtn);

      roleEditorRolesEl.appendChild(card);
    });
    updateRoleJobSummaries();
  }

  function renderRoleEditorJobs() {
    if (!roleEditorReady || !roleEditorJobsEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorJobsEl.innerHTML = '';
    const jobs = Array.isArray(roleEditorState?.jobs) ? roleEditorState.jobs : [];
    const roleNames = Array.isArray(roleEditorState?.roles)
      ? roleEditorState.roles.map((role) => role?.name || '').filter((name) => name.length > 0)
      : [];

    jobs.forEach((job, index) => {
      const card = document.createElement('div');
      card.className = 'role-editor-job';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Jobname';
      nameInput.value = job?.name || '';
      nameInput.setAttribute('aria-label', `Jobname ${index + 1}`);
      nameInput.dataset.previousValue = job?.name || '';
      nameInput.addEventListener('focus', () => {
        nameInput.dataset.previousValue = job?.name || '';
      });
      nameInput.addEventListener('input', (event) => {
        job.name = event.target.value;
        markRoleEditorDirty();
      });
      nameInput.addEventListener('blur', () => {
        const previous = nameInput.dataset.previousValue || '';
        const normalized = nameInput.value.trim();
        job.name = normalized;
        nameInput.value = normalized;
        if (previous && normalized && previous !== normalized) {
          renameJobReferences(previous, normalized);
          renderRoleEditorNight();
        }
        updateRoleJobSummaries();
        updateRoleEditorStatus();
      });

      const descriptionTextarea = document.createElement('textarea');
      descriptionTextarea.placeholder = 'Beschreibung';
      descriptionTextarea.value = job?.description || '';
      descriptionTextarea.setAttribute('aria-label', `Beschreibung für ${job?.name || 'Job'}`);
      descriptionTextarea.addEventListener('input', (event) => {
        job.description = event.target.value;
        markRoleEditorDirty();
      });

      const targetsContainer = document.createElement('div');
      targetsContainer.className = 'role-editor-job-targets';
      roleNames.forEach((roleName) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Array.isArray(job?.eligibleRoles)
          ? job.eligibleRoles.includes(roleName)
          : false;
        checkbox.addEventListener('change', () => {
          if (!Array.isArray(job.eligibleRoles)) {
            job.eligibleRoles = [];
          }
          if (checkbox.checked) {
            if (!job.eligibleRoles.includes(roleName)) {
              job.eligibleRoles.push(roleName);
            }
          } else {
            job.eligibleRoles = job.eligibleRoles.filter((name) => name !== roleName);
          }
          markRoleEditorDirty();
          updateRoleJobSummaries();
        });
        label.appendChild(checkbox);
        const text = document.createElement('span');
        text.textContent = roleName;
        label.appendChild(text);
        targetsContainer.appendChild(label);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Job entfernen';
      removeBtn.addEventListener('click', () => {
        const removed = jobs.splice(index, 1)[0];
        if (removed && removed.name) {
          const jobName = removed.name;
          if (Array.isArray(roleEditorState?.night?.sequence)) {
            roleEditorState.night.sequence.forEach((step) => {
              if (Array.isArray(step?.requires?.jobs)) {
                step.requires.jobs = step.requires.jobs.filter((name) => name !== jobName);
              }
            });
          }
        }
        markRoleEditorDirty();
        renderRoleEditorJobs();
        renderRoleEditorNight();
        updateRoleJobSummaries();
      });

      card.appendChild(nameInput);
      card.appendChild(descriptionTextarea);
      card.appendChild(targetsContainer);
      card.appendChild(removeBtn);

      roleEditorJobsEl.appendChild(card);
    });
    updateRoleJobSummaries();
  }

  function getNightStepDragAfterElement(y) {
    const elements = Array.from(roleEditorNightListEl.querySelectorAll('.role-editor-step:not(.dragging)'));
    return elements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function syncNightStepOrderFromDom() {
    if (!roleEditorReady || !roleEditorNightListEl) {
      return;
    }
    const orderedIds = Array.from(roleEditorNightListEl.querySelectorAll('.role-editor-step'))
      .map((item) => item.dataset.stepId)
      .filter((id) => id);
    if (!Array.isArray(roleEditorState?.night?.sequence)) {
      return;
    }
    const lookup = new Map();
    roleEditorState.night.sequence.forEach((step) => {
      lookup.set(step.id, step);
    });
    roleEditorState.night.sequence = orderedIds
      .map((id) => lookup.get(id))
      .filter((step) => step);
  }

  function renderRoleEditorNight() {
    if (!roleEditorReady || !roleEditorNightListEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorNightListEl.innerHTML = '';
    const steps = Array.isArray(roleEditorState?.night?.sequence)
      ? roleEditorState.night.sequence
      : [];
    const availableRoles = Array.isArray(roleEditorState?.roles)
      ? roleEditorState.roles.map((role) => role?.name || '').filter((name) => name.length > 0)
      : [];
    const availableJobs = Array.isArray(roleEditorState?.jobs)
      ? roleEditorState.jobs.map((job) => job?.name || '').filter((name) => name.length > 0)
      : [];

    steps.forEach((step, index) => {
      if (!step.requires) {
        step.requires = { roles: [], jobs: [] };
      } else {
        step.requires.roles = Array.isArray(step.requires.roles) ? step.requires.roles : [];
        step.requires.jobs = Array.isArray(step.requires.jobs) ? step.requires.jobs : [];
      }
      if (!step.conditions || typeof step.conditions !== 'object') {
        step.conditions = {};
      }

      if (!step.id || !step.id.trim()) {
        step.id = `Schritt ${index + 1}`;
      }

      const item = document.createElement('li');
      item.className = 'role-editor-step';
      item.draggable = true;
      item.dataset.stepId = step.id;

      item.addEventListener('dragstart', (event) => {
        nightDragState.draggingId = step.id;
        item.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          try {
            event.dataTransfer.setData('text/plain', step.id);
          } catch (error) {
            // Ignored – some browsers restrict setData during dragstart for certain mime types.
          }
        }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        nightDragState.draggingId = null;
        syncNightStepOrderFromDom();
        markRoleEditorDirty();
      });

      const header = document.createElement('div');
      header.className = 'role-editor-step-header';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.textContent = '☰';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Schrittname';
      nameInput.value = step.id || '';
      nameInput.setAttribute('aria-label', `Schrittname ${index + 1}`);
      nameInput.addEventListener('input', (event) => {
        step.id = event.target.value;
        item.dataset.stepId = event.target.value;
        markRoleEditorDirty();
      });
      nameInput.addEventListener('blur', () => {
        const normalized = nameInput.value.trim() || `Schritt ${index + 1}`;
        step.id = normalized;
        nameInput.value = normalized;
        item.dataset.stepId = normalized;
        markRoleEditorDirty();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Schritt entfernen';
      removeBtn.addEventListener('click', () => {
        steps.splice(index, 1);
        markRoleEditorDirty();
        renderRoleEditorNight();
      });

      header.appendChild(dragHandle);
      header.appendChild(nameInput);
      header.appendChild(removeBtn);

      const promptTextarea = document.createElement('textarea');
      promptTextarea.placeholder = 'Ansagetext für diesen Schritt';
      promptTextarea.value = step.prompt || '';
      promptTextarea.setAttribute('aria-label', `Ansagetext ${index + 1}`);
      promptTextarea.addEventListener('input', (event) => {
        step.prompt = event.target.value;
        markRoleEditorDirty();
      });

      const rolesContainer = document.createElement('div');
      rolesContainer.className = 'role-editor-job-targets';
      if (availableRoles.length > 0) {
        availableRoles.forEach((roleName) => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = step.requires.roles.includes(roleName);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (!step.requires.roles.includes(roleName)) {
                step.requires.roles.push(roleName);
              }
            } else {
              step.requires.roles = step.requires.roles.filter((name) => name !== roleName);
            }
            markRoleEditorDirty();
          });
          const text = document.createElement('span');
          text.textContent = roleName;
          label.appendChild(checkbox);
          label.appendChild(text);
          rolesContainer.appendChild(label);
        });
      }

      const jobsContainer = document.createElement('div');
      jobsContainer.className = 'role-editor-job-targets';
      if (availableJobs.length > 0) {
        availableJobs.forEach((jobName) => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = step.requires.jobs.includes(jobName);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (!step.requires.jobs.includes(jobName)) {
                step.requires.jobs.push(jobName);
              }
            } else {
              step.requires.jobs = step.requires.jobs.filter((name) => name !== jobName);
            }
            markRoleEditorDirty();
          });
          const text = document.createElement('span');
          text.textContent = jobName;
          label.appendChild(checkbox);
          label.appendChild(text);
          jobsContainer.appendChild(label);
        });
      }

      const conditionsContainer = document.createElement('div');
      conditionsContainer.className = 'role-editor-conditions';

      const firstNightLabel = document.createElement('label');
      const firstNightCheckbox = document.createElement('input');
      firstNightCheckbox.type = 'checkbox';
      firstNightCheckbox.checked = Boolean(step.conditions.firstNightOnly);
      firstNightCheckbox.addEventListener('change', () => {
        step.conditions.firstNightOnly = firstNightCheckbox.checked;
        if (!firstNightCheckbox.checked) {
          delete step.conditions.firstNightOnly;
        }
        markRoleEditorDirty();
      });
      firstNightLabel.appendChild(firstNightCheckbox);
      const firstNightText = document.createElement('span');
      firstNightText.textContent = 'Nur in der ersten Nacht';
      firstNightLabel.appendChild(firstNightText);
      conditionsContainer.appendChild(firstNightLabel);

      const doctorLabel = document.createElement('label');
      const doctorCheckbox = document.createElement('input');
      doctorCheckbox.type = 'checkbox';
      doctorCheckbox.checked = Boolean(step.conditions.requiresDoctorTargets);
      doctorCheckbox.addEventListener('change', () => {
        step.conditions.requiresDoctorTargets = doctorCheckbox.checked;
        if (!doctorCheckbox.checked) {
          delete step.conditions.requiresDoctorTargets;
        }
        markRoleEditorDirty();
      });
      doctorLabel.appendChild(doctorCheckbox);
      const doctorText = document.createElement('span');
      doctorText.textContent = 'Nur mit Arztzielen';
      doctorLabel.appendChild(doctorText);
      conditionsContainer.appendChild(doctorLabel);

      item.appendChild(header);
      item.appendChild(promptTextarea);
      if (availableRoles.length > 0) {
        item.appendChild(rolesContainer);
      }
      if (availableJobs.length > 0) {
        item.appendChild(jobsContainer);
      }
      item.appendChild(conditionsContainer);

      roleEditorNightListEl.appendChild(item);
    });

    if (steps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'role-editor-night-empty';
      empty.textContent = 'Keine Nachtaktionen definiert.';
      roleEditorNightListEl.appendChild(empty);
    }
  }

  function buildRoleEditorConfigFromState() {
    ensureRoleEditorStateStructure();
    const errors = [];

    const categoriesSource = Array.isArray(roleEditorState.categories) && roleEditorState.categories.length > 0
      ? roleEditorState.categories
      : roleSchema.categories;

    const categories = Array.isArray(categoriesSource)
      ? categoriesSource
          .map((category) => {
            if (typeof category === 'string') {
              return { id: category.trim(), label: category.trim() };
            }
            const id = typeof category?.id === 'string' ? category.id.trim() : '';
            const label = typeof category?.label === 'string' && category.label.trim().length > 0
              ? category.label.trim()
              : (typeof category?.id === 'string' ? category.id.trim() : '');
            return id ? { id, label } : null;
          })
          .filter(Boolean)
      : [];

    if (categories.length === 0) {
      categories.push({ id: 'village', label: 'Dorfbewohner' });
      categories.push({ id: 'werwolf', label: 'Werwölfe' });
      categories.push({ id: 'special', label: 'Sonderrollen' });
    }

    const validCategoryIds = new Set(categories.map((category) => category.id));
    const defaultCategory = categories[0]?.id || 'special';

    const normalizedRoles = [];
    const seenRoleKeys = new Set();
    const abilityDeduper = (entries) => {
      const seen = new Set();
      const result = [];
      entries.forEach((entry) => {
        const trimmed = typeof entry === 'string' ? entry.trim() : '';
        if (!trimmed) {
          return;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        result.push(trimmed);
      });
      return result;
    };

    roleEditorState.roles.forEach((role) => {
      const name = typeof role?.name === 'string' ? role.name.trim() : '';
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (seenRoleKeys.has(key)) {
        errors.push(`Rolle „${name}“ ist mehrfach vorhanden.`);
        return;
      }
      seenRoleKeys.add(key);

      const category = validCategoryIds.has(role?.category) ? role.category : defaultCategory;
      const description = typeof role?.description === 'string' ? role.description.trim() : '';
      const abilities = Array.isArray(role?.abilities) ? abilityDeduper(role.abilities) : [];
      normalizedRoles.push({ name, category, description, abilities });
    });

    if (normalizedRoles.length === 0) {
      errors.push('Mindestens eine Rolle muss definiert sein.');
    }

    const roleNameSet = new Set(normalizedRoles.map((role) => role.name.toLowerCase()));

    const normalizedJobs = [];
    const seenJobKeys = new Set();
    roleEditorState.jobs.forEach((job) => {
      const name = typeof job?.name === 'string' ? job.name.trim() : '';
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (seenJobKeys.has(key)) {
        errors.push(`Job „${name}“ ist mehrfach vorhanden.`);
        return;
      }
      seenJobKeys.add(key);

      const description = typeof job?.description === 'string' ? job.description.trim() : '';
      const eligibleRolesRaw = Array.isArray(job?.eligibleRoles) ? job.eligibleRoles : [];
      const eligibleSet = new Set();
      const eligibleRoles = [];
      eligibleRolesRaw.forEach((roleName) => {
        const trimmed = typeof roleName === 'string' ? roleName.trim() : '';
        if (!trimmed) {
          return;
        }
        const keyName = trimmed.toLowerCase();
        if (!roleNameSet.has(keyName) || eligibleSet.has(keyName)) {
          return;
        }
        eligibleSet.add(keyName);
        eligibleRoles.push(trimmed);
      });
      normalizedJobs.push({ name, description, eligibleRoles });
    });

    const jobNameSet = new Set(normalizedJobs.map((job) => job.name.toLowerCase()));

    const normalizedSteps = [];
    const seenStepIds = new Map();

    const steps = Array.isArray(roleEditorState.night.sequence)
      ? roleEditorState.night.sequence
      : [];

    steps.forEach((step, index) => {
      const rawId = typeof step?.id === 'string' ? step.id.trim() : '';
      const baseId = rawId || `Schritt ${index + 1}`;
      let normalizedId = baseId;
      let suffix = 2;
      while (seenStepIds.has(normalizedId.toLowerCase())) {
        normalizedId = `${baseId} (${suffix})`;
        suffix += 1;
      }
      seenStepIds.set(normalizedId.toLowerCase(), true);

      const prompt = typeof step?.prompt === 'string' ? step.prompt.trim() : '';

      const requiresRoles = Array.isArray(step?.requires?.roles)
        ? step.requires.roles
            .map((roleName) => typeof roleName === 'string' ? roleName.trim() : '')
            .filter((roleName, idx, arr) => roleName.length > 0
              && roleNameSet.has(roleName.toLowerCase())
              && arr.indexOf(roleName) === idx)
        : [];

      const requiresJobs = Array.isArray(step?.requires?.jobs)
        ? step.requires.jobs
            .map((jobName) => typeof jobName === 'string' ? jobName.trim() : '')
            .filter((jobName, idx, arr) => jobName.length > 0
              && jobNameSet.has(jobName.toLowerCase())
              && arr.indexOf(jobName) === idx)
        : [];

      const phase = typeof step?.phase === 'string' && step.phase.trim().length > 0
        ? step.phase.trim()
        : 'night';

      const conditions = {};
      if (step?.conditions && typeof step.conditions === 'object') {
        if (step.conditions.firstNightOnly) {
          conditions.firstNightOnly = true;
        }
        if (step.conditions.requiresDoctorTargets) {
          conditions.requiresDoctorTargets = true;
        }
      }

      normalizedSteps.push({
        id: normalizedId,
        prompt,
        requires: { roles: requiresRoles, jobs: requiresJobs },
        phase,
        conditions
      });
    });

    const version = Number.isFinite(Number(roleEditorState.version))
      ? Number(roleEditorState.version)
      : (Number.isFinite(Number(roleSchema.version)) ? Number(roleSchema.version) : 1);

    return {
      config: {
        version,
        categories,
        roles: normalizedRoles,
        jobs: normalizedJobs,
        night: { sequence: normalizedSteps }
      },
      errors
    };
  }

  if (roleEditorNightListEl) {
    roleEditorNightListEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      const afterElement = getNightStepDragAfterElement(event.clientY);
      const draggable = roleEditorNightListEl.querySelector('.role-editor-step.dragging');
      if (!draggable) {
        return;
      }
      if (!afterElement) {
        roleEditorNightListEl.appendChild(draggable);
      } else {
        roleEditorNightListEl.insertBefore(draggable, afterElement);
      }
    });

    roleEditorNightListEl.addEventListener('drop', (event) => {
      event.preventDefault();
      syncNightStepOrderFromDom();
      markRoleEditorDirty();
    });
  }

  async function saveRoleEditorConfig() {
    ensureRoleEditorStateStructure();
    const { config, errors } = buildRoleEditorConfigFromState();
    if (errors.length > 0) {
      const list = errors.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
      showInfoMessage({
        title: 'Speichern nicht möglich',
        html: `<p>Bitte behebe folgende Probleme:</p><ul>${list}</ul>`,
        confirmText: 'Okay',
        log: { type: 'error', label: 'Rollenkonfiguration ungültig', detail: errors.join(' | ') }
      });
      return;
    }

    await withButtonLoading(roleEditorSaveBtn, 'Speichere …', async () => {
      try {
        const response = await apiClient.rolesConfig.set(config);
        const nextConfig = response?.config || config;
        const source = response?.source || 'custom';
        roleSchemaSource = source;
        applyRoleSchema(nextConfig);
        refreshRoleInputsFromSchema({ preserveExisting: false });
        lastSuggestionSnapshot = null;
        roleLayoutCustomized = false;
        renderNarratorDashboard();
        roleEditorDirty = false;
        updateRoleEditorStatus();
        showInfoMessage({
          title: 'Konfiguration gespeichert',
          text: 'Die Rollen- und Nachtabfolge wurde übernommen.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Rollenkonfiguration gespeichert', detail: `Quelle: ${source === 'custom' ? 'Benutzerdefiniert' : 'Standard'}` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Rollenkonfiguration konnte nicht gespeichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Rollenkonfiguration speichern fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  }

  async function resetRoleEditorConfig() {
    await withButtonLoading(roleEditorResetBtn, 'Setze zurück …', async () => {
      try {
        await apiClient.rolesConfig.reset();
        const { config, source } = await apiClient.rolesConfig.get();
        if (config) {
          roleSchemaSource = source || 'default';
          applyRoleSchema(config);
        } else {
          roleSchemaSource = 'default';
          const fallback = await loadFallbackRoleSchema();
          if (fallback) {
            applyRoleSchema(fallback);
          }
        }
        refreshRoleInputsFromSchema({ preserveExisting: false });
        lastSuggestionSnapshot = null;
        roleLayoutCustomized = false;
        renderNarratorDashboard();
        roleEditorDirty = false;
        updateRoleEditorStatus();
        showInfoMessage({
          title: 'Standard wiederhergestellt',
          text: 'Die ursprüngliche Rollenkonfiguration wurde geladen.',
          confirmText: 'Okay',
          log: { type: 'warning', label: 'Rollenkonfiguration zurückgesetzt', detail: 'Zurück zum Standardprofil gewechselt.' }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Zurücksetzen fehlgeschlagen',
          text: 'Die Rollenkonfiguration konnte nicht zurückgesetzt werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Rollenkonfiguration zurücksetzen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  }

  if (roleEditorAddRoleBtn) {
    roleEditorAddRoleBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.roles.push(createRoleTemplate());
      markRoleEditorDirty();
      renderRoleEditorRoles();
      renderRoleEditorJobs();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorAddJobBtn) {
    roleEditorAddJobBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.jobs.push(createJobTemplate());
      markRoleEditorDirty();
      renderRoleEditorJobs();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorAddNightStepBtn) {
    roleEditorAddNightStepBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.night.sequence.push(createNightStepTemplate());
      markRoleEditorDirty();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorSaveBtn) {
    roleEditorSaveBtn.addEventListener('click', () => {
      saveRoleEditorConfig();
    });
  }

  if (roleEditorResetBtn) {
    roleEditorResetBtn.addEventListener('click', () => {
      showConfirmation({
        title: 'Standard wiederherstellen?',
        text: 'Alle Änderungen gehen verloren. Fortfahren?',
        confirmText: 'Zurücksetzen',
        cancelText: 'Abbrechen',
        focus: 'cancel',
        onConfirm: () => {
          void resetRoleEditorConfig();
        },
        logOnConfirm: { type: 'warning', label: 'Rollenkonfiguration zurücksetzen bestätigt', detail: 'Zurücksetzen angestoßen.' }
      });
    });
  }

  if (roleEditorReady) {
    ensureRoleEditorStateStructure();
    renderRoleEditorRoles();
    renderRoleEditorJobs();
    renderRoleEditorNight();
    updateRoleEditorStatus();
  }

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
        refreshRoleInputsFromSchema({ preserveExisting: false });
        Object.entries(suggestion).forEach(([roleName, qty]) => {
          const row = findRoleRow(rolesContainerVillage, roleName)
            || findRoleRow(rolesContainerWerwolf, roleName)
            || findRoleRow(rolesContainerSpecial, roleName);
          if (row) {
            setRowQuantity(row, qty);
          }
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
  refreshRoleInputsFromSchema({ preserveExisting: false });

  // Apply suggestion once on load (if players already entered)
  applyRoleSuggestion(
    playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length
  );

  // Save names to backend
  saveNamesBtn.addEventListener("click", async () => {
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
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
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
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

      refreshRoleInputsFromSchema({ preserveExisting: false });

      savedRoles.forEach((role) => {
        if (!role || typeof role.name !== 'string') {
          return;
        }
        const quantity = Number.isFinite(role.quantity) ? role.quantity : 0;
        let row = findRoleRow(rolesContainerVillage, role.name)
          || findRoleRow(rolesContainerWerwolf, role.name)
          || findRoleRow(rolesContainerSpecial, role.name);
        if (!row) {
          if (categorizedRoles.village.includes(role.name)) {
            addRoleRow(role.name, quantity, rolesContainerVillage);
          } else if (categorizedRoles.werwolf.includes(role.name)) {
            addRoleRow(role.name, quantity, rolesContainerWerwolf);
          } else {
            addRoleRow(role.name, quantity, rolesContainerSpecial);
          }
          row = findRoleRow(rolesContainerVillage, role.name)
            || findRoleRow(rolesContainerWerwolf, role.name)
            || findRoleRow(rolesContainerSpecial, role.name);
        }
        if (row) {
          setRowQuantity(row, quantity);
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

      refreshRoleInputsFromSchema({ preserveExisting: false });

      let legacyBodyguardRole = false;
      lastUsed.roles.forEach(role => {
        if (!role || typeof role.name !== 'string') {
          return;
        }
        const qty = Number.isFinite(role.quantity) ? role.quantity : 0;
        const roleName = role.name === 'Bodyguard' ? 'Dorfbewohner' : role.name;
        if (role.name === 'Bodyguard') {
          legacyBodyguardRole = true;
        }
        let row = findRoleRow(rolesContainerVillage, roleName)
          || findRoleRow(rolesContainerWerwolf, roleName)
          || findRoleRow(rolesContainerSpecial, roleName);
        if (!row) {
          if (categorizedRoles.village.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerVillage);
          } else if (categorizedRoles.werwolf.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerWerwolf);
          } else {
            addRoleRow(roleName, qty, rolesContainerSpecial);
          }
          row = findRoleRow(rolesContainerVillage, roleName)
            || findRoleRow(rolesContainerWerwolf, roleName)
            || findRoleRow(rolesContainerSpecial, roleName);
        }
        if (row) {
          setRowQuantity(row, qty);
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
        phaseTimerManager.cancelAll();
        phaseTimerManager.resetHistory();
        resetTimerEventHistory();
        actionLog.length = 0;
        undoStack.length = 0;
        redoStack.length = 0;
        actionSequenceCounter = 0;
        checkpointCounter = 0;
        updateTimelineUI();
        updateUndoHistoryUI();
        lastWinner = null;

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
        hideRevealControls();
        revealGrid.innerHTML = ''; // Clear previous cards
        revealCards = new Array(players.length);
        revealCurrentPlayerHasFlipped = false;
        currentlyFlippedCard = null;

        players.forEach((player, index) => {
          const card = document.createElement('div');
          card.className = 'reveal-card';
          card.dataset.playerIndex = String(index);
          card.style.animationDelay = `${index * 0.05}s`;
          if (deadPlayers.includes(player)) {
            card.classList.add('dead');
          }
          card.onclick = () => {
            if (revealTurnIndex < 0 || revealTurnOrder[revealTurnIndex] !== index) {
              return;
            }
            if (currentlyFlippedCard && currentlyFlippedCard !== card) {
              currentlyFlippedCard.classList.remove('flipped');
            }
            card.classList.toggle('flipped');
            const isFlipped = card.classList.contains('flipped');
            currentlyFlippedCard = isFlipped ? card : null;
            revealCurrentPlayerHasFlipped = isFlipped;
            refreshRevealControls();
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
          revealCards[index] = card;
        });

        const revealOrder = players.map((_, idx) => idx);
        shuffleArray(revealOrder);
        setRevealTurnOrder(revealOrder);

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

    const canonicalRole = typeof role === 'string' ? role : '';
    const fallbackRoleLabel = localization.t('roles.info.unknown') || 'Unbekannte Rolle';
    const normalizedRole = localization.getRoleDisplayName(canonicalRole) || canonicalRole || fallbackRoleLabel;
    const jobListRaw = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const jobDisplayList = jobListRaw
      .map((job) => localization.getJobDisplayName(job) || getJobDisplayName(job))
      .filter(Boolean);
    const titleText = jobDisplayList.length
      ? `${normalizedRole} (${jobDisplayList.join(' + ')})`
      : normalizedRole;

    title.textContent = titleText;

    const baseDescription = localization.getRoleDescription(canonicalRole)
      || roleDescriptions[canonicalRole]
      || roleDescriptions[normalizedRole]
      || localization.t('roles.info.noDescription')
      || 'Keine Beschreibung für diese Rolle verfügbar.';
    const localizedAbilities = localization.getRoleAbilities(canonicalRole);
    const abilities = Array.isArray(localizedAbilities) && localizedAbilities.length > 0
      ? localizedAbilities
      : getRoleAbilities(canonicalRole);

    const descriptionHtml = `<p>${escapeHtml(baseDescription)}</p>`;

    const abilityTitle = localization.t('roles.info.abilitiesTitle') || 'Fähigkeiten';
    const abilityHtml = Array.isArray(abilities) && abilities.length > 0
      ? `<div><span class="role-info-section-title">${escapeHtml(abilityTitle)}</span><ul class="role-info-abilities">${abilities
          .map((ability) => `<li>${escapeHtml(ability)}</li>`)
          .join('')}</ul></div>`
      : '';

    const jobHtmlEntries = jobListRaw
      .map((job) => {
        const label = localization.getJobDisplayName(job) || getJobDisplayName(job);
        if (!label) {
          return '';
        }
        const modifier = getJobClassModifier(job);
        const badgeClass = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
        const badgeHtml = `<span class="${badgeClass}">${escapeHtml(label)}</span>`;
        const description = localization.getJobDescription(job) || jobDescriptions[job];
        const descriptionHtml = description ? `<span class="job-description-text">${escapeHtml(description)}</span>` : '';
        return `<span class="job-description">${badgeHtml}${descriptionHtml}</span>`;
      })
      .filter(Boolean)
      .join('');

    const jobsTitle = localization.t('roles.info.jobsTitle') || 'Jobs';
    const jobsHtml = jobHtmlEntries
      ? `<div><span class="role-info-section-title">${escapeHtml(jobsTitle)}</span><div class="role-info-jobs">${jobHtmlEntries}</div></div>`
      : '';

    desc.innerHTML = `${descriptionHtml}${abilityHtml}${jobsHtml}`;

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

  function hideRevealControls() {
    revealCards.forEach((card) => {
      if (card) {
        card.classList.remove('reveal-disabled', 'active');
      }
    });
    revealTurnOrder = [];
    revealTurnIndex = -1;
    revealCards = [];
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;
    if (revealControlsEl) {
      revealControlsEl.style.display = 'none';
    }
    if (currentRevealPlayerEl) {
      currentRevealPlayerEl.textContent = '';
    }
    if (revealNextBtn) {
      revealNextBtn.disabled = true;
      revealNextBtn.style.display = '';
    }
  }

  function updateRevealCardStates() {
    const hasActive = revealTurnIndex >= 0 && revealTurnIndex < revealTurnOrder.length;
    revealCards.forEach((card, index) => {
      if (!card) {
        return;
      }
      const isCurrent = hasActive && revealTurnOrder[revealTurnIndex] === index;
      if (card.classList.contains('dead')) {
        card.classList.remove('reveal-disabled');
      } else {
        card.classList.toggle('reveal-disabled', !isCurrent);
      }
      card.classList.toggle('active', isCurrent);
    });
  }

  function refreshRevealControls() {
    if (!revealControlsEl) {
      return;
    }
    if (revealTurnIndex < 0 || revealTurnIndex >= revealTurnOrder.length) {
      hideRevealControls();
      return;
    }

    revealControlsEl.style.display = 'flex';
    const currentPlayerIndex = revealTurnOrder[revealTurnIndex];
    const playerName = players[currentPlayerIndex] || '';
    const isLast = revealTurnIndex === revealTurnOrder.length - 1;

    if (currentRevealPlayerEl) {
      if (!playerName) {
        currentRevealPlayerEl.textContent = 'Aktueller Spieler unbekannt';
      } else if (isLast) {
        currentRevealPlayerEl.textContent = `Letzter Spieler: ${playerName} – danach den Laptop an den Erzähler geben`;
      } else {
        currentRevealPlayerEl.textContent = `Aktueller Spieler: ${playerName}`;
      }
    }

    if (revealNextBtn) {
      if (isLast) {
        revealNextBtn.style.display = 'none';
        revealNextBtn.disabled = true;
      } else {
        revealNextBtn.style.display = '';
        revealNextBtn.disabled = !revealCurrentPlayerHasFlipped;
      }
    }

    updateRevealCardStates();
  }

  function setRevealTurnOrder(order) {
    if (!Array.isArray(order) || order.length === 0) {
      hideRevealControls();
      return;
    }

    revealTurnOrder = order.slice();
    revealTurnIndex = 0;
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;
    refreshRevealControls();
  }

  function advanceRevealTurn() {
    if (revealTurnIndex < 0 || revealTurnIndex >= revealTurnOrder.length - 1) {
      return;
    }

    if (currentlyFlippedCard) {
      currentlyFlippedCard.classList.remove('flipped');
      currentlyFlippedCard = null;
    }

    revealTurnIndex += 1;
    revealCurrentPlayerHasFlipped = false;
    refreshRevealControls();
  }

  if (revealNextBtn) {
    revealNextBtn.addEventListener('click', () => {
      advanceRevealTurn();
    });
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
    hideRevealControls();
    showRolesOverviewBtn.style.display = 'none';
    firstNightShieldUsed = false;
    syncJobChanceInputs();
    renderNarratorDashboard();
  });

  function serializeActionEntry(entry) {
    const createdAt = getActionEntryDate(entry);
    return {
      id: entry.id,
      sequence: entry.sequence,
      type: entry.type,
      label: entry.label,
      detail: entry.detail,
      timestamp: createdAt.getTime(),
      iso: createdAt.toISOString(),
      phase: entry.phase,
      step: entry.step || null,
      metadata: entry.metadata || {}
    };
  }

  function serializeCheckpointEntry(checkpoint) {
    const timestamp = typeof checkpoint.timestamp === 'number'
      ? checkpoint.timestamp
      : Date.now();
    return {
      id: checkpoint.id,
      label: checkpoint.label,
      timestamp,
      iso: new Date(timestamp).toISOString(),
      actionSequence: typeof checkpoint.actionSequence === 'number' ? checkpoint.actionSequence : null,
      state: checkpoint.state
    };
  }

  function buildSessionTimeline() {
    const actions = actionLog
      .slice()
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      .map(serializeActionEntry);

    const checkpoints = gameCheckpoints
      .slice()
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map(serializeCheckpointEntry);

    const timers = phaseTimerManager.history().map(event => {
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
      return {
        id: event.id,
        sequence: event.sequence,
        kind: event.kind,
        timestamp,
        iso: new Date(timestamp).toISOString(),
        metadata: event.metadata || {}
      };
    });

    return { actions, checkpoints, timers };
  }

  function renderAnalytics(data) {
    if (!analyticsSummaryEl) {
      return;
    }

    const summary = data?.summary || {};
    const playerAnalytics = data?.players || {};
    const sessionCount = Number.isFinite(summary.sessionCount) ? summary.sessionCount : Number(summary.sessions) || 0;
    const averageLengthMs = Number.isFinite(summary.averageGameLengthMs)
      ? summary.averageGameLengthMs
      : Number(summary.average_game_length_ms);
    const averageActions = Number.isFinite(summary.averageActionCount)
      ? summary.averageActionCount
      : Number(summary.average_action_count);
    const averagePlayers = Number.isFinite(summary.averagePlayerCount)
      ? summary.averagePlayerCount
      : Number(summary.average_player_count);
    const trackedSessions = Number.isFinite(playerAnalytics.trackedSessions)
      ? playerAnalytics.trackedSessions
      : Number(playerAnalytics.sessionCount);
    const distinctPlayers = Number.isFinite(playerAnalytics.totalCount)
      ? playerAnalytics.totalCount
      : Number(playerAnalytics.distinctPlayers);
    const meta = data?.meta || {};
    const averageNights = Number.isFinite(meta.averageNightCount)
      ? meta.averageNightCount
      : Number(meta.average_night_count);
    const averageDays = Number.isFinite(meta.averageDayCount)
      ? meta.averageDayCount
      : Number(meta.average_day_count);

    const formatLocaleNumber = (value, { fractionDigits = 0 } = {}) => {
      if (!Number.isFinite(value)) {
        return '–';
      }
      return value.toLocaleString('de-DE', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      });
    };

    const formatDuration = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) {
        return '–';
      }
      const totalSeconds = Math.round(ms / 1000);
      if (totalSeconds < 60) {
        return `${totalSeconds}s`;
      }
      const totalMinutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (minutes === 0) {
          return `${hours}h`;
        }
        return `${hours}h ${minutes}m`;
      }
      if (seconds === 0) {
        return `${totalMinutes}m`;
      }
      return `${totalMinutes}m ${seconds}s`;
    };

    const summaryParts = [`Spiele: ${formatLocaleNumber(sessionCount)}`];
    if (Number.isFinite(distinctPlayers)) {
      summaryParts.push(`Spieler:innen: ${formatLocaleNumber(distinctPlayers)}`);
    }
    summaryParts.push(`Stand: ${new Date().toLocaleString('de-DE')}`);
    analyticsSummaryEl.textContent = summaryParts.join(' • ');

    if (analyticsMetricSessionsEl) {
      analyticsMetricSessionsEl.textContent = formatLocaleNumber(sessionCount);
    }
    if (analyticsMetricTrackedEl) {
      analyticsMetricTrackedEl.textContent = Number.isFinite(trackedSessions)
        ? formatLocaleNumber(trackedSessions)
        : '0';
    }
    if (analyticsMetricPlayersEl) {
      analyticsMetricPlayersEl.textContent = Number.isFinite(distinctPlayers)
        ? formatLocaleNumber(distinctPlayers)
        : '0';
    }
    if (analyticsMetricAveragePlayersEl) {
      analyticsMetricAveragePlayersEl.textContent = Number.isFinite(averagePlayers)
        ? formatLocaleNumber(averagePlayers, { fractionDigits: 1 })
        : '–';
    }
    if (analyticsMetricAverageActionsEl) {
      analyticsMetricAverageActionsEl.textContent = Number.isFinite(averageActions)
        ? formatLocaleNumber(averageActions, { fractionDigits: 1 })
        : '–';
    }
    if (analyticsMetricDurationEl) {
      analyticsMetricDurationEl.textContent = formatDuration(averageLengthMs);
    }

    if (analyticsWinratesEl) {
      analyticsWinratesEl.innerHTML = '';
      const winRates = Array.isArray(data?.winRates) ? data.winRates : [];
      if (winRates.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'empty';
        emptyItem.textContent = 'Noch keine Siege ausgewertet.';
        analyticsWinratesEl.appendChild(emptyItem);
      } else {
        winRates.forEach(entry => {
          const item = document.createElement('li');
          const winnerName = entry.winner || 'Unbekannt';
          const rateValue = Number.isFinite(entry.rate) ? entry.rate : Number(entry.percentage) / 100;
          const countValueRaw = Number.isFinite(entry.count) ? entry.count : Number(entry.total) || 0;
          const countValue = Number.isFinite(countValueRaw) ? countValueRaw : 0;
          const headerRow = document.createElement('div');
          headerRow.className = 'analytics-winrate-row';
          const winnerEl = document.createElement('strong');
          winnerEl.textContent = winnerName;
          headerRow.appendChild(winnerEl);

          const detailSpan = document.createElement('span');
          detailSpan.className = 'analytics-winrate-value';
          detailSpan.textContent = `${formatPercentage(rateValue, { defaultText: '–', fractionDigits: 0 })} (${countValue.toLocaleString('de-DE')})`;
          headerRow.appendChild(detailSpan);
          item.appendChild(headerRow);

          const progress = document.createElement('div');
          progress.className = 'analytics-progress';
          const progressFill = document.createElement('div');
          progressFill.className = 'analytics-progress-fill';
          if (Number.isFinite(rateValue)) {
            progressFill.style.width = `${Math.max(0, Math.min(100, rateValue * 100))}%`;
          }
          progress.appendChild(progressFill);
          item.appendChild(progress);

          analyticsWinratesEl.appendChild(item);
        });
      }
    }

    if (analyticsMetaEl) {
      const metaParts = [];
      if (Number.isFinite(averageNights)) {
        metaParts.push(`Ø Nächte: ${averageNights.toFixed(1)}`);
      }
      if (Number.isFinite(averageDays)) {
        metaParts.push(`Ø Tage: ${averageDays.toFixed(1)}`);
      }
      if (Number.isFinite(trackedSessions) && trackedSessions > 0) {
        metaParts.push(`Analysierte Sessions: ${trackedSessions.toLocaleString('de-DE')}`);
      }
      if (Number.isFinite(distinctPlayers) && distinctPlayers > 0) {
        metaParts.push(`Spieler:innen: ${distinctPlayers.toLocaleString('de-DE')}`);
      }
      if (metaParts.length === 0) {
        analyticsMetaEl.innerHTML = '<p class="analytics-meta-empty">Noch keine Metadaten vorhanden.</p>';
      } else {
        analyticsMetaEl.innerHTML = metaParts
          .map(part => `<span class="analytics-meta-chip">${escapeHtml(part)}</span>`)
          .join('');
      }
    }

    if (analyticsHighlightsEl) {
      analyticsHighlightsEl.innerHTML = '';
      const formatNumber = (value) => (Number.isFinite(value) ? value.toLocaleString('de-DE') : null);
      const stats = Array.isArray(playerAnalytics.stats) ? playerAnalytics.stats : [];
      const globalRoleUsage = stats.reduce((acc, stat) => {
        const roles = Array.isArray(stat.topRoles) ? stat.topRoles : [];
        roles.forEach(roleEntry => {
          const roleName = roleEntry?.role;
          const count = Number(roleEntry?.count);
          if (!roleName || !Number.isFinite(count)) {
            return;
          }
          acc.set(roleName, (acc.get(roleName) || 0) + count);
        });
        return acc;
      }, new Map());
      const globalRoleHighlights = Array.from(globalRoleUsage.entries())
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const highlightConfigs = [
        {
          key: 'topWinners',
          title: 'Top Sieger:innen',
          description: 'Meiste Siege insgesamt',
          icon: '🏆',
          items: Array.isArray(playerAnalytics.topWinners) ? playerAnalytics.topWinners : [],
          format(entry) {
            const wins = formatNumber(entry.wins);
            const games = formatNumber(entry.games);
            const parts = [];
            if (wins !== null) {
              parts.push(`${wins} ${entry.wins === 1 ? 'Sieg' : 'Siege'}`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const winRateText = formatPercentage(entry.winRate, { defaultText: '–', fractionDigits: 0 });
            if (winRateText !== '–') {
              parts.push(winRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'mostDeaths',
          title: 'Dramatischstes Ende',
          description: 'Wer stirbt am häufigsten?',
          icon: '💀',
          items: Array.isArray(playerAnalytics.mostDeaths) ? playerAnalytics.mostDeaths : [],
          format(entry) {
            const deaths = formatNumber(entry.deaths);
            const games = formatNumber(entry.games);
            const parts = [];
            if (deaths !== null) {
              parts.push(`${deaths} ${entry.deaths === 1 ? 'Tod' : 'Tode'}`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const deathRateText = formatPercentage(entry.deathRate, { defaultText: '–', fractionDigits: 0 });
            if (deathRateText !== '–') {
              parts.push(deathRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'bestSurvivors',
          title: 'Überlebenskünstler:innen',
          description: 'Beste Überlebensquote ab 2 Spielen',
          icon: '🛡️',
          items: Array.isArray(playerAnalytics.bestSurvivors) ? playerAnalytics.bestSurvivors : [],
          format(entry) {
            const survivals = formatNumber(entry.survivals);
            const games = formatNumber(entry.games);
            const parts = [];
            if (survivals !== null) {
              parts.push(`${survivals}× überlebt`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const survivalRateText = formatPercentage(entry.survivalRate, { defaultText: '–', fractionDigits: 0 });
            if (survivalRateText !== '–') {
              parts.push(survivalRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'favoriteRoles',
          title: 'Beliebteste Rollen',
          description: 'Rollen mit den meisten Einsätzen insgesamt',
          icon: '🎭',
          items: globalRoleHighlights,
          format(entry) {
            const count = formatNumber(entry.count);
            if (count !== null) {
              return `${count} Einsätze`;
            }
            return 'Keine Daten';
          },
          getName(entry) {
            return entry.role || 'Unbekannt';
          }
        }
      ];

      highlightConfigs.forEach(config => {
        const card = document.createElement('article');
        card.className = 'analytics-card';
        const titleEl = document.createElement('h6');
        const iconEl = document.createElement('span');
        iconEl.className = 'analytics-card-icon';
        iconEl.textContent = config.icon || '⭐';
        titleEl.appendChild(iconEl);
        titleEl.appendChild(document.createTextNode(config.title));
        card.appendChild(titleEl);
        if (config.description) {
          const descEl = document.createElement('p');
          descEl.textContent = config.description;
          card.appendChild(descEl);
        }
        const items = Array.isArray(config.items) ? config.items : [];
        if (items.length === 0) {
          const emptyState = document.createElement('p');
          emptyState.className = 'analytics-empty-state';
          emptyState.textContent = 'Noch keine Daten vorhanden.';
          card.appendChild(emptyState);
        } else {
          const list = document.createElement('ul');
          items.slice(0, 5).forEach(entry => {
            const item = document.createElement('li');
            const nameEl = document.createElement('strong');
            const entryName = typeof config.getName === 'function'
              ? config.getName(entry)
              : entry.name || entry.player || entry.role || 'Unbekannt';
            nameEl.textContent = entryName;
            item.appendChild(nameEl);
            const detailText = config.format(entry);
            if (detailText) {
              const detailEl = document.createElement('span');
              detailEl.textContent = detailText;
              item.appendChild(detailEl);
            }
            list.appendChild(item);
          });
          card.appendChild(list);
        }
        analyticsHighlightsEl.appendChild(card);
      });
    }

    if (analyticsPlayerTableBody) {
      analyticsPlayerTableBody.innerHTML = '';
      const stats = Array.isArray(playerAnalytics.stats) ? playerAnalytics.stats : [];
      const formatCount = (value) => (Number.isFinite(value) ? value.toLocaleString('de-DE') : '–');
      if (stats.length === 0) {
        const row = document.createElement('tr');
        row.className = 'empty';
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.textContent = 'Noch keine Spielerstatistiken verfügbar.';
        row.appendChild(cell);
        analyticsPlayerTableBody.appendChild(row);
      } else {
        stats.forEach(stat => {
          const row = document.createElement('tr');

          const nameCell = document.createElement('td');
          nameCell.textContent = stat.name || 'Unbekannt';
          row.appendChild(nameCell);

          const gamesCell = document.createElement('td');
          gamesCell.textContent = formatCount(stat.games);
          row.appendChild(gamesCell);

          const winsCell = document.createElement('td');
          winsCell.textContent = formatCount(stat.wins);
          row.appendChild(winsCell);

          const winRateCell = document.createElement('td');
          winRateCell.textContent = formatPercentage(stat.winRate, { defaultText: '–', fractionDigits: 0 });
          row.appendChild(winRateCell);

          const deathsCell = document.createElement('td');
          deathsCell.textContent = formatCount(stat.deaths);
          row.appendChild(deathsCell);

          const survivalCell = document.createElement('td');
          survivalCell.textContent = formatPercentage(stat.survivalRate, { defaultText: '–', fractionDigits: 0 });
          row.appendChild(survivalCell);

          const favoriteCell = document.createElement('td');
          const favoriteRole = stat.favoriteRole && typeof stat.favoriteRole.role === 'string'
            ? stat.favoriteRole
            : null;
          if (favoriteRole) {
            const label = document.createElement('div');
            const countText = Number.isFinite(favoriteRole.count)
              ? ` (${favoriteRole.count.toLocaleString('de-DE')}×)`
              : '';
            label.textContent = `${favoriteRole.role}${countText}`;
            favoriteCell.appendChild(label);
          } else {
            favoriteCell.textContent = '–';
          }

          const roleChips = Array.isArray(stat.topRoles) ? stat.topRoles.slice(0, 3) : [];
          if (roleChips.length > 0) {
            const roleList = document.createElement('div');
            roleList.className = 'analytics-role-list';
            roleChips.forEach(roleEntry => {
              if (!roleEntry || typeof roleEntry.role !== 'string') {
                return;
              }
              const chip = document.createElement('span');
              chip.className = 'analytics-role-chip';
              const countText = Number.isFinite(roleEntry.count)
                ? ` ${roleEntry.count.toLocaleString('de-DE')}×`
                : '';
              chip.textContent = `${roleEntry.role}${countText}`;
              roleList.appendChild(chip);
            });
            favoriteCell.appendChild(roleList);
          }
          row.appendChild(favoriteCell);

          const lastPlayedCell = document.createElement('td');
          if (Number.isFinite(stat.lastPlayedAt) && stat.lastPlayedAt > 0) {
            const lastPlayedDate = new Date(stat.lastPlayedAt);
            lastPlayedCell.innerHTML = `<span class="analytics-last-played">${escapeHtml(lastPlayedDate.toLocaleDateString('de-DE', { dateStyle: 'medium' }))}</span>`;
          } else {
            lastPlayedCell.textContent = '–';
          }
          row.appendChild(lastPlayedCell);

          analyticsPlayerTableBody.appendChild(row);
        });
      }
    }
  }

  async function loadAnalytics(options = {}) {
    const { showLoading = true } = options;
    if (!analyticsSummaryEl) {
      return null;
    }

    if (showLoading) {
      analyticsSummaryEl.textContent = 'Lade Statistiken…';
    }
    if (analyticsWinratesEl) {
      analyticsWinratesEl.innerHTML = '';
    }
    if (analyticsMetaEl) {
      analyticsMetaEl.innerHTML = '';
    }

    try {
      setAnalyticsLoadingState(true, { showLoadingText: showLoading });
      const data = await apiClient.analytics.get();
      renderAnalytics(data);
      return data;
    } catch (error) {
      analyticsSummaryEl.textContent = 'Statistiken konnten nicht geladen werden.';
      console.error('Analytics konnten nicht geladen werden.', error);
      return null;
    } finally {
      setAnalyticsLoadingState(false, { showLoadingText: showLoading });
    }
  }

  // Session Management
  async function saveSession() {
    if (!canEditActiveLobby) {
      throw new Error(READ_ONLY_HINT);
    }
    const roleCounts = rolesAssigned.reduce((acc, role) => {
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});

    const timeline = buildSessionTimeline();
    let gameDurationMs = null;
    if (timeline.actions.length > 1) {
      const first = timeline.actions[0];
      const last = timeline.actions[timeline.actions.length - 1];
      const duration = last.timestamp - first.timestamp;
      if (Number.isFinite(duration) && duration >= 0) {
        gameDurationMs = duration;
      }
    }

    const sessionMetadata = {
      playerCount: players.length,
      dayCount,
      nightCount: nightCounter,
      actionCount: timeline.actions.length,
      checkpointCount: timeline.checkpoints.length,
      gameDurationMs,
      winner: lastWinner ? { ...lastWinner } : null,
      savedAt: Date.now()
    };

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
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      roleSchema: getRoleSchemaSnapshot(),
      roleSchemaSource,
      timeline,
      metadata: sessionMetadata
    };

    await apiClient.sessions.create(session);
    await loadSessions();
    await loadAnalytics({ showLoading: false });
    return session;
  }

  async function loadSessions() {
    sessionsList.innerHTML = '';
    if (!latestLobbySnapshot) {
      sessionsList.innerHTML = '<li>Keine Lobby ausgewählt.</li>';
      updateReplaySessionOptions([]);
      return [];
    }
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
      updateReplaySessionOptions([]);
      return [];
    }

    sessionsList.innerHTML = '';
    const canManageSessions = canEditActiveLobby;

    sessions.forEach(session => {
      const li = document.createElement('li');
      const date = new Date(session.timestamp).toLocaleString('de-DE');
      const playerNames = session.players.join(', ');

      li.innerHTML = `
        <div class="session-date">${date}</div>
        <div class="session-players">${playerNames}</div>
        ${canManageSessions ? `<button class="delete-session-btn" data-timestamp="${session.timestamp}">&times;</button>` : ''}
      `;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-session-btn')) return;
        applySession(session);
        sessionsSidebar.classList.remove('show');
        document.body.classList.remove('sidebar-open');
      });

      sessionsList.appendChild(li);
    });

    updateReplaySessionOptions(sessions);

    if (canManageSessions) {
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
    }

    return sessions;
  }

  function resetReplayUI() {
    replayTimeline = null;
    replayPointer = -1;
    if (replayScrubber) {
      replayScrubber.min = 0;
      replayScrubber.max = 0;
      replayScrubber.value = 0;
      replayScrubber.disabled = true;
    }
    if (replayActionLabel) {
      replayActionLabel.textContent = '–';
    }
    if (replayApplyBtn) {
      replayApplyBtn.disabled = true;
    }
    if (replayActionList) {
      replayActionList.innerHTML = '';
    }
  }

  function updateReplaySessionOptions(sessions = []) {
    if (!replaySessionSelect) {
      return;
    }

    const previousValue = replaySessionSelect.value;
    replaySessionSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Session auswählen…';
    placeholder.disabled = true;
    replaySessionSelect.appendChild(placeholder);

    let hasSelection = false;
    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.timestamp;
      option.textContent = new Date(session.timestamp).toLocaleString('de-DE');
      if (String(session.timestamp) === previousValue) {
        option.selected = true;
        hasSelection = true;
      }
      replaySessionSelect.appendChild(option);
    });

    placeholder.selected = !hasSelection;
    if (!hasSelection) {
      resetReplayUI();
    }
  }

  function renderReplayActions() {
    if (!replayActionList) {
      return;
    }

    replayActionList.innerHTML = '';

    if (!replayTimeline || !Array.isArray(replayTimeline.actions) || replayTimeline.actions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Keine Aktionen gespeichert.';
      replayActionList.appendChild(empty);
      if (replayScrubber) {
        replayScrubber.disabled = true;
        replayScrubber.value = 0;
        replayScrubber.max = 0;
      }
      if (replayApplyBtn) {
        replayApplyBtn.disabled = true;
      }
      if (replayActionLabel) {
        replayActionLabel.textContent = '–';
      }
      return;
    }

    replayTimeline.actions.forEach((action, index) => {
      const item = document.createElement('li');
      item.className = 'replay-entry';
      const time = action.iso ? new Date(action.iso) : new Date(action.timestamp);
      const timeText = Number.isNaN(time.getTime())
        ? ''
        : time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      item.innerHTML = `
        <div class="replay-entry-header">
          <span class="replay-entry-type">${timelineLabelMap[action.type] || 'Info'}</span>
          <span class="replay-entry-time">${timeText}</span>
        </div>
        <div class="replay-entry-label">${action.label || 'Aktion'}</div>
        ${action.detail ? `<div class="replay-entry-detail">${action.detail}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        setReplayPointer(index);
      });
      replayActionList.appendChild(item);
    });

    if (replayScrubber) {
      replayScrubber.disabled = false;
      replayScrubber.min = 0;
      replayScrubber.max = replayTimeline.actions.length - 1;
      replayScrubber.value = 0;
    }

    setReplayPointer(0);
  }

  function setReplayPointer(index) {
    if (!replayTimeline || !Array.isArray(replayTimeline.actions) || replayTimeline.actions.length === 0) {
      replayPointer = -1;
      if (replayApplyBtn) {
        replayApplyBtn.disabled = true;
      }
      return;
    }

    const boundedIndex = Math.min(Math.max(index, 0), replayTimeline.actions.length - 1);
    replayPointer = boundedIndex;
    const action = replayTimeline.actions[boundedIndex];

    if (replayScrubber) {
      replayScrubber.value = String(boundedIndex);
    }
    if (replayActionLabel) {
      replayActionLabel.textContent = action.label || 'Aktion';
    }
    if (replayApplyBtn) {
      replayApplyBtn.disabled = false;
    }
    if (replayActionList) {
      Array.from(replayActionList.children).forEach((item, idx) => {
        item.classList.toggle('active', idx === boundedIndex);
      });
    }
  }

  function findCheckpointForSequence(sequence) {
    if (!replayTimeline || !Array.isArray(replayTimeline.checkpoints) || replayTimeline.checkpoints.length === 0) {
      return null;
    }
    let candidate = null;
    replayTimeline.checkpoints.forEach(checkpoint => {
      const seq = typeof checkpoint.actionSequence === 'number' ? checkpoint.actionSequence : null;
      if (seq === null) {
        return;
      }
      if (seq <= sequence) {
        if (!candidate || seq >= (candidate.actionSequence ?? -Infinity)) {
          candidate = checkpoint;
        }
      }
    });

    if (!candidate) {
      candidate = replayTimeline.checkpoints[0];
    }
    return candidate;
  }

  async function loadReplayTimeline(timestamp) {
    if (!replaySessionSelect) {
      return null;
    }

    resetReplayUI();
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    isLoadingReplay = true;
    try {
      if (replayActionLabel) {
        replayActionLabel.textContent = 'Lade…';
      }
      const timeline = await apiClient.sessions.timeline(timestamp);
      if (!timeline) {
        if (replayActionLabel) {
          replayActionLabel.textContent = 'Keine Timeline gefunden';
        }
        replayTimeline = null;
        return null;
      }
      replayTimeline = {
        timestamp,
        actions: Array.isArray(timeline.actions) ? timeline.actions : [],
        checkpoints: Array.isArray(timeline.checkpoints) ? timeline.checkpoints : [],
        timers: Array.isArray(timeline.timers) ? timeline.timers : []
      };
      renderReplayActions();
      return replayTimeline;
    } catch (error) {
      console.error('Timeline konnte nicht geladen werden.', error);
      if (replayActionLabel) {
        replayActionLabel.textContent = 'Fehler beim Laden';
      }
      return null;
    } finally {
      isLoadingReplay = false;
    }
  }

  function applyReplaySelection() {
    if (!replayTimeline || replayPointer < 0 || !Array.isArray(replayTimeline.actions)) {
      return;
    }
    const action = replayTimeline.actions[replayPointer];
    const sequence = typeof action.sequence === 'number' ? action.sequence : null;
    const checkpoint = sequence !== null ? findCheckpointForSequence(sequence) : null;
    if (!checkpoint || !checkpoint.state) {
      showInfoMessage({
        title: 'Kein Snapshot vorhanden',
        text: 'Für diese Aktion liegt kein vollständiger Snapshot vor.',
        confirmText: 'Okay'
      });
      return;
    }

    phaseTimerManager.cancelAll();
    phaseTimerManager.resetHistory();
    isRestoringCheckpoint = true;
    try {
      applyStateSnapshot(checkpoint.state);
    } finally {
      isRestoringCheckpoint = false;
    }

    const actionTime = action.iso ? new Date(action.iso) : new Date(action.timestamp);
    const detailParts = [];
    if (!Number.isNaN(actionTime.getTime())) {
      detailParts.push(actionTime.toLocaleString('de-DE'));
    }
    if (checkpoint.label) {
      detailParts.push(`Snapshot: ${checkpoint.label}`);
    }

    logAction({
      type: 'replay',
      label: `Replay geladen – ${action.label || 'Aktion'}`,
      detail: detailParts.join(' | '),
      metadata: {
        source: 'replay',
        sessionTimestamp: replayTimeline.timestamp,
        actionId: action.id,
        checkpointId: checkpoint.id
      }
    });
  }

  async function deleteSession(timestamp) {
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
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

  if (replaySessionSelect) {
    replaySessionSelect.addEventListener('change', async (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        resetReplayUI();
        return;
      }
      await loadReplayTimeline(value);
    });
  }

  if (replayScrubber) {
    replayScrubber.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        return;
      }
      setReplayPointer(value);
    });
  }

  if (replayApplyBtn) {
    replayApplyBtn.addEventListener('click', () => {
      applyReplaySelection();
    });
  }

  function applySession(session) {
    phaseTimerManager.resetHistory();
    resetTimerEventHistory();
    actionLog.length = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    actionSequenceCounter = 0;
    checkpointCounter = 0;
    updateTimelineUI();
    updateUndoHistoryUI();
    const sessionWinner = session?.metadata?.winner;
    lastWinner = sessionWinner ? { ...sessionWinner } : null;

    if (session.roleSchema) {
      roleSchemaSource = session.roleSchemaSource || 'custom';
      applyRoleSchema(session.roleSchema);
      refreshRoleInputsFromSchema({ preserveExisting: false });
    } else if (session.roleSchemaSource) {
      roleSchemaSource = session.roleSchemaSource;
      updateRoleEditorStatus();
    }

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

    const timelineData = session.timeline || null;

    phaseTimerManager.cancelAll();
    gameCheckpoints.length = 0;

    if (timelineData && Array.isArray(timelineData.checkpoints) && timelineData.checkpoints.length > 0) {
      const sortedCheckpoints = timelineData.checkpoints
        .slice()
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      sortedCheckpoints.forEach((cp, index) => {
        if (!cp.state) {
          return;
        }
        const timestamp = typeof cp.timestamp === 'number'
          ? cp.timestamp
          : (typeof cp.iso === 'string' ? Date.parse(cp.iso) : Date.now());
        const sequence = typeof cp.actionSequence === 'number' ? cp.actionSequence : index;
        checkpointCounter = Math.max(checkpointCounter, sequence);
        gameCheckpoints.push({
          id: cp.id || `checkpoint-${timestamp}-${sequence || index + 1}`,
          label: cp.label || 'Snapshot',
          timestamp,
          actionSequence: sequence,
          state: cp.state
        });
      });
      if (gameCheckpoints.length === 0) {
        captureGameCheckpoint('Session geladen');
      }
    } else {
      captureGameCheckpoint('Session geladen');
    }

    if (timelineData && Array.isArray(timelineData.actions) && timelineData.actions.length > 0) {
      const restoredActions = timelineData.actions
        .slice()
        .map(action => {
          const createdAt = action.iso ? new Date(action.iso) : new Date(action.timestamp);
          const sequence = typeof action.sequence === 'number' ? action.sequence : 0;
          return {
            id: action.id || `action-${createdAt.getTime()}-${sequence}`,
            sequence,
            type: action.type || 'info',
            label: action.label || '',
            detail: action.detail || '',
            createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
            phase: action.phase || 'setup',
            step: action.step || null,
            metadata: action.metadata || {}
          };
        })
        .sort((a, b) => (b.sequence || 0) - (a.sequence || 0));
      restoredActions.forEach(entry => {
        actionLog.push(entry);
        actionSequenceCounter = Math.max(actionSequenceCounter, entry.sequence || 0);
      });
    }

    if (timelineData && Array.isArray(timelineData.timers) && timelineData.timers.length > 0) {
      resetTimerEventHistory();
      timelineData.timers
        .slice()
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
        .forEach(event => {
          const timestamp = typeof event.timestamp === 'number'
            ? event.timestamp
            : (typeof event.iso === 'string' ? Date.parse(event.iso) : Date.now());
          const sequence = typeof event.sequence === 'number' ? event.sequence : timerEventCounter + 1;
          timerEventCounter = Math.max(timerEventCounter, sequence);
          timerEventHistory.push({
            id: event.id || `timer-${timestamp}-${sequence}`,
            sequence,
            kind: event.kind || 'custom',
            timestamp,
            metadata: event.metadata || {}
          });
        });
    }

    updateTimelineUI();
    updateUndoHistoryUI();

    playersTextarea.value = session.players.join('\n');

    const roleCounts = {};
    session.roles.forEach(r => {
        const name = r.name === 'Bodyguard' ? 'Dorfbewohner' : r.name;
        roleCounts[name] = (roleCounts[name] || 0) + r.quantity;
    });

    refreshRoleInputsFromSchema({ preserveExisting: false });
    Object.entries(roleCounts).forEach(([roleName, qty]) => {
      let row = findRoleRow(rolesContainerVillage, roleName)
        || findRoleRow(rolesContainerWerwolf, roleName)
        || findRoleRow(rolesContainerSpecial, roleName);
      if (!row) {
        if (categorizedRoles.village.includes(roleName)) {
          addRoleRow(roleName, qty, rolesContainerVillage);
        } else if (categorizedRoles.werwolf.includes(roleName)) {
          addRoleRow(roleName, qty, rolesContainerWerwolf);
        } else {
          addRoleRow(roleName, qty, rolesContainerSpecial);
        }
        row = findRoleRow(rolesContainerVillage, roleName)
          || findRoleRow(rolesContainerWerwolf, roleName)
          || findRoleRow(rolesContainerSpecial, roleName);
      }
      if (row) {
        setRowQuantity(row, qty);
      }
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
    hideRevealControls();
    revealGrid.innerHTML = ''; // Clear previous cards
    revealCards = new Array(players.length);
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;

    players.forEach((player, index) => {
      const card = document.createElement('div');
      card.className = 'reveal-card';
      card.dataset.playerIndex = String(index);
      card.style.animationDelay = `${index * 0.05}s`;
      if (deadPlayers.includes(player)) {
        card.classList.add('dead');
      }
      card.onclick = () => {
        if (revealTurnIndex < 0 || revealTurnOrder[revealTurnIndex] !== index) {
          return;
        }
        if (currentlyFlippedCard && currentlyFlippedCard !== card) {
          currentlyFlippedCard.classList.remove('flipped');
        }
        card.classList.toggle('flipped');
        const isFlipped = card.classList.contains('flipped');
        currentlyFlippedCard = isFlipped ? card : null;
        revealCurrentPlayerHasFlipped = isFlipped;
        refreshRevealControls();
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
      revealCards[index] = card;
    });

    const revealOrder = players.map((_, idx) => idx);
    shuffleArray(revealOrder);
    setRevealTurnOrder(revealOrder);


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

  await loadSessions();
  await loadAnalytics();

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

  function formatPercentage(value, { defaultText = '–', fractionDigits = 0 } = {}) {
    if (!Number.isFinite(value)) {
      return defaultText;
    }
    const percentage = value * 100;
    if (!Number.isFinite(percentage)) {
      return defaultText;
    }
    return `${percentage.toFixed(fractionDigits)}%`;
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
      eventEngineState: getEventEngineSnapshot(),
      roleSchema: getRoleSchemaSnapshot(),
      roleSchemaSource
    };
  }

  function captureGameCheckpoint(label) {
    if (isRestoringCheckpoint) return;
    const timestamp = Date.now();
    checkpointCounter += 1;
    const snapshot = {
      id: `checkpoint-${timestamp}-${checkpointCounter}`,
      label,
      timestamp,
      actionSequence: actionSequenceCounter,
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

    if (snapshot.roleSchema) {
      roleSchemaSource = snapshot.roleSchemaSource || roleSchemaSource || 'custom';
      applyRoleSchema(snapshot.roleSchema);
      refreshRoleInputsFromSchema({ preserveExisting: false });
    } else if (snapshot.roleSchemaSource) {
      roleSchemaSource = snapshot.roleSchemaSource;
      updateRoleEditorStatus();
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

  const ACTION_LOG_LIMIT = 500;
  const actionLog = [];
  const undoStack = [];
  const redoStack = [];
  let actionSequenceCounter = 0;

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

  function getActionEntryDate(entry) {
    if (entry.createdAt instanceof Date) {
      return entry.createdAt;
    }
    if (typeof entry.timestamp === 'number') {
      const date = new Date(entry.timestamp);
      if (!Number.isNaN(date.getTime())) {
        entry.createdAt = date;
        return date;
      }
    }
    if (typeof entry.iso === 'string') {
      const parsed = new Date(entry.iso);
      if (!Number.isNaN(parsed.getTime())) {
        entry.createdAt = parsed;
        return parsed;
      }
    }
    const fallback = new Date();
    entry.createdAt = fallback;
    return fallback;
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
      const createdAt = getActionEntryDate(entry);
      timeEl.dateTime = createdAt.toISOString();
      timeEl.textContent = formatTimestamp(createdAt);
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

  function logAction({ type = 'info', label, detail = '', metadata = {}, logKey = null, params = {} }) {
    const createdAt = new Date();
    actionSequenceCounter += 1;
    let resolvedLabel = label;
    let resolvedDetail = detail;

    if (logKey) {
      const templateLabel = localization.formatGameplayString('logs', logKey, 'label', params);
      if (templateLabel) {
        resolvedLabel = templateLabel;
      } else if (!resolvedLabel) {
        const template = localization.getLogTemplate(logKey);
        if (template?.label) {
          resolvedLabel = template.label;
        }
      }
      const templateDetail = localization.formatGameplayString('logs', logKey, 'detail', params);
      if (templateDetail) {
        resolvedDetail = templateDetail;
      } else if (!resolvedDetail) {
        const template = localization.getLogTemplate(logKey);
        if (template?.detail) {
          resolvedDetail = template.detail;
        }
      }
    }

    const entry = {
      id: `action-${createdAt.getTime()}-${actionSequenceCounter}`,
      sequence: actionSequenceCounter,
      type,
      label: resolvedLabel,
      detail: resolvedDetail,
      createdAt,
      phase: nightMode ? 'night' : (dayMode ? 'day' : 'setup'),
      step: nightMode ? nightSteps[nightIndex] || null : null,
      metadata: {
        ...metadata,
        dayCount,
        nightCounter,
        mayor,
        playerCount: players.length
      }
    };
    actionLog.unshift(entry);
    if (actionLog.length > ACTION_LOG_LIMIT) {
      actionLog.pop();
    }
    updateTimelineUI();
    renderNarratorDashboard();
    return entry;
  }

  function recordAction({ type = 'admin', label, detail = '', undo, redo, logKey = null, params = {} }) {
    logAction({ type, label, detail, logKey, params });
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
        const prompt = escapeHtml(nightTexts['Werwolf'] || 'Werwölfe wachen auf.');
        nightTextEl.innerHTML = `${prompt}<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.`;
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
          eventEngineState: getEventEngineSnapshot(),
          timeline: buildSessionTimeline(),
          ambience: ambienceManager.getSnapshot(),
          roleSchema: getRoleSchemaSnapshot(),
          roleSchemaSource
        };
      },
      setState(partial = {}) {
        let recalcJobs = false;
        let phoenixStateChanged = false;
        if (partial.roleSchema) {
          roleSchemaSource = partial.roleSchemaSource || roleSchemaSource || 'custom';
          applyRoleSchema(partial.roleSchema);
          refreshRoleInputsFromSchema({ preserveExisting: false });
          recalcJobs = true;
        } else if (partial.roleSchemaSource) {
          roleSchemaSource = partial.roleSchemaSource;
          updateRoleEditorStatus();
        }
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
      getAmbienceState() {
        return ambienceManager.getSnapshot();
      },
      setManualAmbience(config = {}) {
        if (config && Object.prototype.hasOwnProperty.call(config, 'playlist')) {
          ambienceManager.setManualPlaylist(config.playlist);
        }
        if (config && Object.prototype.hasOwnProperty.call(config, 'lighting')) {
          ambienceManager.setManualLighting(config.lighting);
        }
      },
      setPhaseAmbience: ambienceManager.setPhaseAmbience,
      previewNightStep(role) {
        if (role) {
          ambienceManager.setNightStep(role);
        } else {
          ambienceManager.clearNightStep();
        }
      },
      triggerAmbienceEvent(key, active = true) {
        ambienceManager.setEventAmbience(key, !!active);
      },
      playAmbienceStinger(id) {
        ambienceManager.triggerStinger(id);
      },
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
      setRoleSchema(schema, source = 'custom') {
        if (!schema || typeof schema !== 'object') {
          return;
        }
        roleSchemaSource = source || 'custom';
        applyRoleSchema(schema);
        refreshRoleInputsFromSchema({ preserveExisting: false });
        renderNarratorDashboard();
      },
      getRoleSchema() {
        return getRoleSchemaSnapshot();
      },
      generateNightSequence(context = {}) {
        return generateNightSteps(context);
      },
      getNightPrompt(stepId) {
        if (!stepId) {
          return '';
        }
        return nightTexts[stepId] || '';
      },
      showRoleInfo(roleName, options) {
        showRoleInfo(roleName, options);
      },
      getActionLog() {
        return actionLog.slice();
      },
      getTimerEvents() {
        return timerEventHistory.slice();
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
