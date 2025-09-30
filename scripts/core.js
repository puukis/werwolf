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

