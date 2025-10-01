const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runMigrations = require('./migrate');
const { query } = require('./db');

const localizedAssetsRoot = path.join(__dirname, '..', 'assets', 'localized');
const localeCatalogRoot = path.join(__dirname, '..', 'locales');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParserMiddleware);
app.use(loadUserFromSession);
app.use('/locales', express.static(localeCatalogRoot));

app.get('/assets/localized/:locale/:asset', async (req, res) => {
  const locale = normalizeLocaleInput(req.params.locale);
  if (!locale) {
    return res.status(404).json({ error: 'Locale nicht unterstützt.' });
  }
  const assetName = typeof req.params.asset === 'string' ? req.params.asset : '';
  if (!assetName || assetName.includes('..') || assetName.includes('/')) {
    return res.status(400).json({ error: 'Ungültiger Dateiname.' });
  }

  const candidates = [locale, 'de'];
  for (const candidate of candidates) {
    const filePath = path.join(localizedAssetsRoot, candidate, assetName);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return res.sendFile(filePath);
    } catch (error) {
      // try fallback
    }
  }

  return res.status(404).json({ error: 'Asset nicht gefunden.' });
});

const SESSION_COOKIE_NAME = 'werwolf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const isProduction = process.env.NODE_ENV === 'production';
const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
};

const ROLE_SCHEMA_KEY = 'werwolfRoleSchema';
const defaultRoleSchemaPath = path.join(__dirname, '..', 'data', 'roles.json');
let defaultRoleSchemaCache = null;

const THEME_SELECTION_KEY = 'theme';
const defaultThemePresetPath = path.join(__dirname, '..', 'data', 'themes.json');
let defaultThemePresetCache = null;
const SSE_KEEPALIVE_INTERVAL_MS = 25000;
const MAX_THEME_UPLOAD_BYTES = 1024 * 1024 * 1.5;
const SESSION_MIGRATION_MESSAGE = 'Sitzungen sind derzeit nicht verfügbar. Bitte führe die Datenbankmigrationen aus.';
const SESSION_PERMISSION_MESSAGE =
  'Sitzungen sind aufgrund fehlender Datenbankberechtigungen deaktiviert. Bitte passe die Rolle oder Verbindungsdaten an.';

const sseClientsByLobby = new Map();
const EMBEDDED_THEME_PRESETS = Object.freeze({
  version: 1,
  presets: [
    {
      id: 'evergreen-hollow',
      name: 'Immergrüne Lichtung',
      description: 'Sattes Waldgrün mit mystischem Nebel und warmem Glasglanz.',
      preview: {
        accent: '#22c55e',
        background: 'https://images.unsplash.com/photo-1691268079349-1e22a841a6de?q=80&w=1920&auto=format&fit=crop'
      },
      variants: {
        light: {
          label: 'Tag',
          variables: {
            '--bg-fallback': '#132019',
            '--bg-image': 'url("https://images.unsplash.com/photo-1691268079349-1e22a841a6de?q=80&w=2069&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D")',
            '--ambient-overlay': 'radial-gradient(120% 120% at 80% 20%, rgba(102, 153, 123, 0.18) 0%, rgba(102, 153, 123, 0) 70%)',
            '--bg-overlay': 'linear-gradient(210deg, rgba(20, 32, 25, 0.76) 0%, rgba(10, 18, 13, 0.72) 55%, rgba(5, 10, 7, 0.78) 100%)',
            '--container-bg': 'rgba(243, 248, 244, 0.72)',
            '--container-bg-strong': 'rgba(230, 239, 233, 0.82)',
            '--text-color': 'rgba(23, 37, 30, 0.95)',
            '--text-light': 'rgba(73, 97, 84, 0.82)',
            '--border-color': 'rgba(120, 153, 133, 0.36)',
            '--border-strong': 'rgba(120, 153, 133, 0.55)',
            '--button-bg': 'rgba(34, 197, 94, 0.88)',
            '--button-hover': 'rgba(22, 163, 74, 0.92)',
            '--button-secondary-bg': 'rgba(220, 235, 225, 0.7)',
            '--button-secondary-hover': 'rgba(201, 225, 208, 0.75)',
            '--button-danger-bg': 'rgba(239, 68, 68, 0.9)',
            '--button-danger-hover': 'rgba(220, 38, 38, 0.95)',
            '--button-danger-text': '#ffffff',
            '--badge-readonly-bg': 'rgba(226, 232, 240, 0.7)',
            '--badge-readonly-text': 'rgba(30, 41, 59, 0.82)',
            '--result-bg': 'rgba(233, 241, 236, 0.67)',
            '--role-color': 'rgba(26, 42, 34, 0.95)',
            '--special-role-color': 'rgba(27, 120, 86, 0.85)',
            '--job-bodyguard-bg': 'rgba(32, 120, 92, 0.85)',
            '--job-bodyguard-text': 'rgba(236, 253, 245, 0.98)',
            '--job-doctor-bg': 'rgba(231, 175, 78, 0.88)',
            '--job-doctor-text': 'rgba(45, 33, 0, 0.85)',
            '--input-bg': 'rgba(244, 249, 245, 0.74)',
            '--input-border': 'rgba(120, 153, 133, 0.45)',
            '--shadow-color': 'rgba(10, 24, 16, 0.2)',
            '--glass-blur-sm': '14px',
            '--glass-blur-lg': '30px',
            '--glass-shadow-soft': '0 22px 54px rgba(20, 32, 25, 0.15)',
            '--glass-shadow-strong': '0 48px 96px rgba(10, 18, 13, 0.18)',
            '--theme-toggle-bg': 'rgba(236, 246, 238, 0.7)',
            '--theme-toggle-border': 'rgba(120, 153, 133, 0.38)',
            '--theme-toggle-hover': 'rgba(224, 238, 229, 0.88)',
            '--theme-toggle-shadow': '0 18px 32px rgba(12, 28, 18, 0.2)',
            '--theme-toggle-fallback': 'rgba(214, 227, 218, 0.9)',
            '--glow-color': 'rgba(146, 200, 152, 0.24)',
            '--lighting-wash-color': 'rgba(233, 249, 238, 0.32)',
            '--lighting-wash-opacity': '0',
            '--lighting-vignette-color': 'rgba(12, 24, 18, 0.75)',
            '--lighting-vignette-opacity': '0',
            '--lighting-spotlight-color': 'rgba(255, 255, 245, 0.3)',
            '--lighting-spotlight-opacity': '0',
            '--lighting-spotlight-scale': '1',
            '--lighting-master-opacity': '0',
            '--particles-opacity': '0',
            '--particles-color': 'rgba(255, 255, 255, 0.4)',
            '--particles-size': '220px',
            '--particles-blur': '70px',
            '--ambient-transition': '0.85s ease',
            '--glass-panel-bg': 'rgba(245, 249, 246, 0.64)',
            '--glass-panel-strong-bg': 'rgba(230, 239, 234, 0.74)',
            '--glass-panel-border': 'rgba(143, 176, 155, 0.4)',
            '--glass-panel-highlight': 'rgba(255, 255, 255, 0.82)',
            '--glass-panel-specular': 'rgba(95, 168, 121, 0.18)',
            '--glass-panel-shadow': '0 24px 60px rgba(16, 28, 22, 0.15), 0 12px 28px rgba(52, 168, 83, 0.12)',
            '--glass-panel-hover-shadow': '0 34px 88px rgba(16, 28, 22, 0.18), 0 18px 40px rgba(52, 168, 83, 0.16)',
            '--glass-panel-fallback': 'rgba(238, 245, 240, 0.94)',
            '--card-surface-bg': 'rgba(17, 25, 40, 0.32)',
            '--card-surface-strong-bg': 'rgba(17, 25, 40, 0.42)',
            '--card-surface-border': 'rgba(255, 255, 255, 0.125)',
            '--card-surface-shadow': '0 32px 72px rgba(10, 24, 16, 0.26)',
            '--card-surface-hover-shadow': '0 44px 96px rgba(10, 24, 16, 0.32)',
            '--card-surface-fallback': 'rgba(230, 239, 234, 0.92)',
            '--glass-button-bg-start': 'rgba(34, 197, 94, 0.95)',
            '--glass-button-bg-end': 'rgba(16, 185, 129, 0.85)',
            '--glass-button-hover-start': 'rgba(22, 163, 74, 0.98)',
            '--glass-button-hover-end': 'rgba(5, 150, 105, 0.92)',
            '--glass-button-border': 'rgba(224, 255, 239, 0.58)',
            '--glass-button-shadow': '0 20px 36px rgba(22, 163, 74, 0.28), 0 12px 24px rgba(15, 35, 22, 0.2)',
            '--glass-button-hover-shadow': '0 26px 44px rgba(22, 163, 74, 0.32), 0 14px 28px rgba(15, 35, 22, 0.22)',
            '--glass-secondary-bg-start': 'rgba(238, 245, 240, 0.74)',
            '--glass-secondary-bg-end': 'rgba(214, 227, 218, 0.68)',
            '--glass-secondary-hover-start': 'rgba(228, 239, 232, 0.82)',
            '--glass-secondary-hover-end': 'rgba(210, 225, 214, 0.74)',
            '--glass-secondary-border': 'rgba(143, 176, 155, 0.45)',
            '--glass-secondary-shadow': '0 14px 32px rgba(120, 153, 133, 0.22), 0 10px 22px rgba(16, 28, 22, 0.15)',
            '--glass-secondary-hover-shadow': '0 20px 40px rgba(120, 153, 133, 0.26), 0 12px 26px rgba(16, 28, 22, 0.18)',
            '--glass-focus-ring': 'rgba(34, 197, 94, 0.52)',
            '--glass-sheen-angle': '135deg'
          }
        },
        dark: {
          label: 'Nacht',
          variables: {
            '--bg-fallback': '#070f09',
            '--bg-image': 'url("https://images.unsplash.com/photo-1691268079349-1e22a841a6de?q=80&w=2069&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D")',
            '--ambient-overlay': 'radial-gradient(120% 120% at 20% 20%, rgba(74, 222, 128, 0.16) 0%, rgba(74, 222, 128, 0) 70%)',
            '--bg-overlay': 'linear-gradient(210deg, rgba(5, 12, 8, 0.82) 0%, rgba(4, 11, 7, 0.82) 55%, rgba(1, 4, 2, 0.86) 100%)',
            '--container-bg': 'rgba(13, 24, 17, 0.74)',
            '--container-bg-strong': 'rgba(18, 32, 23, 0.78)',
            '--text-color': 'rgba(220, 235, 225, 0.96)',
            '--text-light': 'rgba(158, 175, 165, 0.78)',
            '--border-color': 'rgba(62, 95, 74, 0.44)',
            '--border-strong': 'rgba(94, 135, 109, 0.6)',
            '--button-bg': 'rgba(22, 163, 74, 0.88)',
            '--button-hover': 'rgba(21, 128, 61, 0.9)',
            '--button-secondary-bg': 'rgba(24, 38, 30, 0.72)',
            '--button-secondary-hover': 'rgba(34, 51, 39, 0.78)',
            '--button-danger-bg': 'rgba(239, 68, 68, 0.82)',
            '--button-danger-hover': 'rgba(252, 165, 165, 0.88)',
            '--button-danger-text': '#ffffff',
            '--badge-readonly-bg': 'rgba(55, 65, 81, 0.72)',
            '--badge-readonly-text': 'rgba(248, 250, 252, 0.9)',
            '--result-bg': 'rgba(20, 34, 26, 0.67)',
            '--role-color': 'rgba(222, 236, 227, 0.95)',
            '--special-role-color': 'rgba(74, 222, 128, 0.85)',
            '--job-bodyguard-bg': 'rgba(16, 115, 78, 0.82)',
            '--job-bodyguard-text': 'rgba(227, 252, 239, 0.96)',
            '--job-doctor-bg': 'rgba(210, 161, 60, 0.82)',
            '--job-doctor-text': 'rgba(31, 20, 0, 0.86)',
            '--input-bg': 'rgba(24, 38, 30, 0.74)',
            '--input-border': 'rgba(62, 95, 74, 0.5)',
            '--shadow-color': 'rgba(4, 10, 7, 0.6)',
            '--glass-blur-sm': '16px',
            '--glass-blur-lg': '34px',
            '--glass-shadow-soft': '0 24px 54px rgba(3, 8, 6, 0.48)',
            '--glass-shadow-strong': '0 56px 104px rgba(3, 8, 6, 0.6)',
            '--theme-toggle-bg': 'rgba(19, 32, 24, 0.58)',
            '--theme-toggle-border': 'rgba(62, 95, 74, 0.48)',
            '--theme-toggle-hover': 'rgba(28, 45, 34, 0.72)',
            '--theme-toggle-shadow': '0 20px 36px rgba(3, 8, 6, 0.6)',
            '--theme-toggle-fallback': 'rgba(61, 76, 65, 0.85)',
            '--glow-color': 'rgba(74, 222, 128, 0.28)',
            '--lighting-wash-color': 'rgba(45, 72, 56, 0.48)',
            '--lighting-wash-opacity': '0',
            '--lighting-vignette-color': 'rgba(2, 6, 4, 0.85)',
            '--lighting-vignette-opacity': '0',
            '--lighting-spotlight-color': 'rgba(255, 204, 158, 0.32)',
            '--lighting-spotlight-opacity': '0',
            '--lighting-spotlight-scale': '1.1',
            '--lighting-master-opacity': '0',
            '--particles-opacity': '0',
            '--particles-color': 'rgba(255, 206, 170, 0.42)',
            '--particles-size': '260px',
            '--particles-blur': '90px',
            '--ambient-transition': '0.95s ease',
            '--glass-panel-bg': 'rgba(16, 28, 22, 0.74)',
            '--glass-panel-strong-bg': 'rgba(21, 36, 28, 0.78)',
            '--glass-panel-border': 'rgba(62, 95, 74, 0.52)',
            '--glass-panel-highlight': 'rgba(158, 175, 165, 0.3)',
            '--glass-panel-specular': 'rgba(74, 222, 128, 0.26)',
            '--glass-panel-shadow': '0 28px 64px rgba(3, 8, 6, 0.58), 0 16px 36px rgba(34, 197, 94, 0.18)',
            '--glass-panel-hover-shadow': '0 36px 88px rgba(3, 8, 6, 0.64), 0 20px 44px rgba(34, 197, 94, 0.22)',
            '--glass-panel-fallback': 'rgba(21, 36, 28, 0.85)',
            '--glass-button-bg-start': 'rgba(34, 197, 94, 0.92)',
            '--glass-button-bg-end': 'rgba(16, 185, 129, 0.88)',
            '--glass-button-hover-start': 'rgba(22, 163, 74, 0.98)',
            '--glass-button-hover-end': 'rgba(5, 150, 105, 0.92)',
            '--glass-button-border': 'rgba(125, 211, 161, 0.4)',
            '--glass-button-shadow': '0 22px 42px rgba(34, 197, 94, 0.35), 0 16px 32px rgba(3, 8, 6, 0.55)',
            '--glass-button-hover-shadow': '0 28px 52px rgba(34, 197, 94, 0.4), 0 20px 40px rgba(3, 8, 6, 0.6)',
            '--glass-secondary-bg-start': 'rgba(28, 45, 34, 0.78)',
            '--glass-secondary-bg-end': 'rgba(19, 32, 24, 0.72)',
            '--glass-secondary-hover-start': 'rgba(38, 56, 44, 0.86)',
            '--glass-secondary-hover-end': 'rgba(25, 40, 30, 0.78)',
            '--glass-secondary-border': 'rgba(62, 95, 74, 0.55)',
            '--glass-secondary-shadow': '0 16px 36px rgba(4, 10, 7, 0.58), 0 10px 24px rgba(34, 197, 94, 0.18)',
            '--glass-secondary-hover-shadow': '0 22px 44px rgba(4, 10, 7, 0.62), 0 12px 28px rgba(34, 197, 94, 0.22)',
            '--glass-focus-ring': 'rgba(34, 197, 94, 0.6)',
            '--glass-sheen-angle': '135deg'
          }
        }
      }
    }
  ]
});

const LOBBY_HEADER = 'x-werwolf-lobby';
const LOBBY_JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SUPPORTED_LOCALES = new Set(['de', 'en']);

let ensureUserLocaleColumnPromise = null;
let userLocaleColumnEnsured = false;
let hasLoggedSessionPermissionWarning = false;
let hasLoggedSessionTableMissingWarning = false;
let sessionsDisabledDueToPermissions = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizeLocaleInput(value) {
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
  const base = trimmed.split('-')[0];
  if (base && SUPPORTED_LOCALES.has(base)) {
    return base;
  }
  return null;
}

async function ensureUserLocaleColumnExists() {
  if (userLocaleColumnEnsured) {
    return;
  }

  if (!ensureUserLocaleColumnPromise) {
    ensureUserLocaleColumnPromise = (async () => {
      try {
        const columnCheck = await query(
          `SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'locale'
            LIMIT 1`
        );
        if (columnCheck.rowCount > 0) {
          userLocaleColumnEnsured = true;
          return;
        }
      } catch (error) {
        if (error?.code === '42P01') {
          // Tabelle "users" existiert noch nicht – Migrationen laufen vermutlich noch.
          return;
        }
        if (error?.code === '42501') {
          console.warn(
            'Berechtigung reicht nicht aus, um die Locale-Spalte zu prüfen. Bitte Migrationen mit ausreichenden Rechten ausführen.'
          );
          userLocaleColumnEnsured = true;
          return;
        }
        console.error('Locale-Spalte konnte nicht geprüft werden:', error);
        return;
      }

      try {
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT');
        userLocaleColumnEnsured = true;
      } catch (error) {
        if (error?.code === '42P01') {
          // Tabelle "users" existiert noch nicht – Migrationen laufen vermutlich noch.
          return;
        }
        if (error?.code === '42501') {
          console.warn(
            'Locale-Spalte konnte nicht automatisch hinzugefügt werden (fehlende Berechtigung). Bitte Migrationen mit ausreichenden Rechten ausführen.'
          );
          userLocaleColumnEnsured = true;
          return;
        }
        console.error('Locale-Spalte konnte nicht geprüft werden:', error);
      }
    })()
      .catch(() => {
        // Fehler wurden bereits geloggt.
      })
      .finally(() => {
        ensureUserLocaleColumnPromise = null;
      });
  }

  try {
    await ensureUserLocaleColumnPromise;
  } catch (error) {
    // Fehler wurden bereits geloggt – Anfrage darf dennoch weiterlaufen.
  }
}

function logSessionTableMissingWarning() {
  if (hasLoggedSessionTableMissingWarning) {
    return;
  }
  console.warn('Sitzungstabelle ist noch nicht vorhanden. Bitte führe die Migrationen aus, um Sitzungen zu aktivieren.');
  hasLoggedSessionTableMissingWarning = true;
}

function logSessionPermissionWarning() {
  if (hasLoggedSessionPermissionWarning) {
    return;
  }
  console.warn('Es fehlen Berechtigungen für den Zugriff auf Sitzungstabellen. Sitzungsfunktionen sind deaktiviert.');
  hasLoggedSessionPermissionWarning = true;
}

function disableSessionsDueToPermissions() {
  if (sessionsDisabledDueToPermissions) {
    return;
  }
  sessionsDisabledDueToPermissions = true;
  logSessionPermissionWarning();
}

function convertSessionStorageError(error) {
  if (error?.code === '42P01' || error?.code === '42703') {
    logSessionTableMissingWarning();
    return new HttpError(503, SESSION_MIGRATION_MESSAGE);
  }
  if (error?.code === '42501') {
    disableSessionsDueToPermissions();
    return new HttpError(503, SESSION_PERMISSION_MESSAGE);
  }
  return null;
}

async function runSessionStorageQuery(operation) {
  if (sessionsDisabledDueToPermissions) {
    throw new HttpError(503, SESSION_PERMISSION_MESSAGE);
  }
  try {
    return await operation();
  } catch (error) {
    const converted = convertSessionStorageError(error);
    if (converted) {
      throw converted;
    }
    throw error;
  }
}

function handleApiError(res, error, fallbackMessage) {
  if (error instanceof HttpError || typeof error?.status === 'number') {
    const status = error.status || 500;
    const message = error.message || fallbackMessage || 'Unbekannter Fehler.';
    if (status >= 500) {
      console.error(message, error);
    }
    return res.status(status).json({ error: message });
  }
  if (fallbackMessage) {
    console.error(fallbackMessage, error);
  } else {
    console.error('API-Fehler', error);
  }
  return res.status(500).json({ error: fallbackMessage || 'Unbekannter Fehler.' });
}

function getSseClientsForLobby(lobbyId) {
  if (!sseClientsByLobby.has(lobbyId)) {
    sseClientsByLobby.set(lobbyId, new Set());
  }
  return sseClientsByLobby.get(lobbyId);
}

function cleanupSseClient(client) {
  if (!client) {
    return;
  }
  if (client.keepAlive) {
    clearInterval(client.keepAlive);
  }
  const clients = sseClientsByLobby.get(client.lobbyId);
  if (clients) {
    clients.delete(client);
    if (clients.size === 0) {
      sseClientsByLobby.delete(client.lobbyId);
    }
  }
}

function registerSseClient(lobbyId, res) {
  const clientId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const client = {
    id: clientId,
    lobbyId,
    res,
    keepAlive: null,
  };
  client.keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (error) {
      cleanupSseClient(client);
    }
  }, SSE_KEEPALIVE_INTERVAL_MS);
  res.on('close', () => cleanupSseClient(client));
  res.on('error', () => cleanupSseClient(client));
  getSseClientsForLobby(lobbyId).add(client);
  return client;
}

function sendSseEvent(client, eventName, payload) {
  if (!client || !client.res || client.res.writableEnded) {
    cleanupSseClient(client);
    return;
  }
  try {
    client.res.write(`event: ${eventName}\n`);
    const data = payload === undefined ? {} : payload;
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    cleanupSseClient(client);
  }
}

function broadcastSseEvent(lobbyId, eventName, payload) {
  const clients = sseClientsByLobby.get(lobbyId);
  if (!clients || clients.size === 0) {
    return;
  }
  for (const client of [...clients]) {
    sendSseEvent(client, eventName, payload);
  }
}

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseHexColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(HEX_COLOR_REGEX);
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

function formatRgba(color, alpha = 1) {
  const normalizedAlpha = clamp(alpha, 0, 1);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(normalizedAlpha.toFixed(3))})`;
}

function adjustColor(color, amount) {
  const ratio = clamp(amount, -1, 1);
  const adjustChannel = (channel) => {
    if (ratio >= 0) {
      return Math.round(channel + (255 - channel) * ratio);
    }
    return Math.round(channel + channel * ratio);
  };
  return {
    r: clamp(adjustChannel(color.r), 0, 255),
    g: clamp(adjustChannel(color.g), 0, 255),
    b: clamp(adjustChannel(color.b), 0, 255),
  };
}

function mixColors(color, target, amount) {
  const ratio = clamp(amount, 0, 1);
  return {
    r: Math.round(color.r + (target.r - color.r) * ratio),
    g: Math.round(color.g + (target.g - color.g) * ratio),
    b: Math.round(color.b + (target.b - color.b) * ratio),
  };
}

function srgbChannelToLinear(value) {
  const channel = value / 255;
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color) {
  const r = srgbChannelToLinear(color.r);
  const g = srgbChannelToLinear(color.g);
  const b = srgbChannelToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(colorA, colorB) {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function toCssUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const sanitized = value.replace(/"/g, '\\"');
  return `url("${sanitized}")`;
}

function sanitizeAccentColor(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    return null;
  }
  return `#${trimmed.slice(1).toLowerCase()}`;
}

function sanitizeBackgroundInput(value) {
  if (value === null) {
    return null;
  }
  let type = 'url';
  let source = null;
  if (typeof value === 'string') {
    source = value.trim();
    if (!source) {
      return null;
    }
    if (source.startsWith('data:image/')) {
      type = 'upload';
    }
  } else if (value && typeof value === 'object') {
    type = toTrimmedString(value.type) || 'url';
    if (typeof value.value === 'string') {
      source = value.value.trim();
    } else if (typeof value.url === 'string') {
      source = value.url.trim();
    } else if (typeof value.data === 'string') {
      source = value.data.trim();
    }
  }
  if (!source) {
    return null;
  }
  if (source.startsWith('data:image/')) {
    if (Buffer.byteLength(source, 'utf8') > MAX_THEME_UPLOAD_BYTES) {
      return null;
    }
    return { type: 'upload', value: source };
  }
  const normalized = source.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(normalized)) {
    return null;
  }
  return { type: 'url', value: normalized };
}

function normalizeThemePresetList(data) {
  const version = Number.isFinite(Number(data?.version)) ? Number(data.version) : 1;
  const presets = [];
  if (Array.isArray(data?.presets)) {
    data.presets.forEach((preset, index) => {
      const id = toTrimmedString(preset?.id) || `preset-${index + 1}`;
      const name = toTrimmedString(preset?.name) || 'Theme';
      const description = toTrimmedString(preset?.description) || '';
      const preview = {
        accent: sanitizeAccentColor(preset?.preview?.accent) || '#22c55e',
        background: toTrimmedString(preset?.preview?.background) || '',
      };
      const variants = {};
      if (preset && typeof preset.variants === 'object') {
        Object.entries(preset.variants).forEach(([variantKey, variantValue]) => {
          const key = toTrimmedString(variantKey).toLowerCase();
          if (!key) {
            return;
          }
          const label = toTrimmedString(variantValue?.label) || key;
          const variables = {};
          if (variantValue && typeof variantValue.variables === 'object') {
            Object.entries(variantValue.variables).forEach(([varName, varValue]) => {
              if (typeof varName === 'string' && varName.startsWith('--') && varValue !== undefined && varValue !== null) {
                variables[varName] = String(varValue);
              }
            });
          }
          if (Object.keys(variables).length > 0) {
            variants[key] = { label, variables };
          }
        });
      }
      if (Object.keys(variants).length > 0) {
        presets.push({ id, name, description, preview, variants });
      }
    });
  }
  if (presets.length === 0) {
    if (data !== EMBEDDED_THEME_PRESETS) {
      return normalizeThemePresetList(EMBEDDED_THEME_PRESETS);
    }
    return { version: 1, presets: EMBEDDED_THEME_PRESETS.presets };
  }
  return { version, presets };
}

async function loadThemePresets() {
  if (defaultThemePresetCache) {
    return cloneJson(defaultThemePresetCache);
  }
  try {
    const raw = await fs.promises.readFile(defaultThemePresetPath, 'utf8');
    const parsed = JSON.parse(raw);
    defaultThemePresetCache = normalizeThemePresetList(parsed);
  } catch (error) {
    console.error('Theme-Presets konnten nicht geladen werden:', error);
    defaultThemePresetCache = normalizeThemePresetList(EMBEDDED_THEME_PRESETS);
  }
  return cloneJson(defaultThemePresetCache);
}

function findThemePreset(presets, presetId) {
  return presets.find((preset) => preset.id === presetId) || presets[0];
}

function normalizeThemeSelection(rawInput, presets) {
  const warnings = [];
  const { presets: presetList } = normalizeThemePresetList({ version: 1, presets });
  const availablePresets = presetList.length > 0 ? presetList : EMBEDDED_THEME_PRESETS.presets;
  const defaultPreset = availablePresets[0];
  let presetId = defaultPreset?.id || 'fallback';
  let variant = 'light';
  const custom = {};
  let updatedAt = null;

  if (typeof rawInput === 'string') {
    variant = rawInput === 'dark' ? 'dark' : 'light';
  } else if (rawInput && typeof rawInput === 'object') {
    if (typeof rawInput.presetId === 'string') {
      const trimmed = toTrimmedString(rawInput.presetId);
      if (trimmed) {
        presetId = trimmed;
      }
    }
    if (typeof rawInput.variant === 'string') {
      const trimmed = toTrimmedString(rawInput.variant).toLowerCase();
      if (trimmed) {
        variant = trimmed;
      }
    }
    if (typeof rawInput.updatedAt === 'string') {
      updatedAt = rawInput.updatedAt;
    }
    const customSource = rawInput.custom && typeof rawInput.custom === 'object' ? rawInput.custom : rawInput;
    if (customSource && typeof customSource === 'object') {
      if (Object.prototype.hasOwnProperty.call(customSource, 'accentColor')) {
        const accent = sanitizeAccentColor(customSource.accentColor);
        if (accent) {
          custom.accentColor = accent;
        } else if (customSource.accentColor !== null && customSource.accentColor !== undefined) {
          warnings.push('Akzentfarbe konnte nicht übernommen werden.');
        }
      }
      if (Object.prototype.hasOwnProperty.call(customSource, 'backgroundImage')) {
        const background = sanitizeBackgroundInput(customSource.backgroundImage);
        if (background) {
          custom.backgroundImage = background;
        } else if (customSource.backgroundImage !== null && customSource.backgroundImage !== undefined) {
          warnings.push('Hintergrund konnte nicht übernommen werden.');
        }
      }
    }
  }

  const preset = findThemePreset(availablePresets, presetId);
  const variantKeys = Object.keys(preset?.variants || {});
  if (!variantKeys.includes(variant)) {
    variant = variantKeys.includes('light') ? 'light' : variantKeys[0] || 'light';
  }

  const selection = {
    presetId: preset?.id || presetId,
    variant,
    custom: Object.keys(custom).length > 0 ? custom : {},
  };
  if (updatedAt) {
    selection.updatedAt = updatedAt;
  }

  return { selection, warnings };
}

function mergeThemeSelection(baseSelection, update, presets) {
  const raw = {
    presetId: baseSelection.presetId,
    variant: baseSelection.variant,
    updatedAt: baseSelection.updatedAt,
    custom: { ...baseSelection.custom },
  };
  if (update && typeof update === 'object') {
    if (typeof update.presetId === 'string') {
      raw.presetId = update.presetId;
    }
    if (typeof update.variant === 'string') {
      raw.variant = update.variant;
    }
    const updateCustom = update.custom && typeof update.custom === 'object' ? update.custom : null;
    if (updateCustom) {
      if (Object.prototype.hasOwnProperty.call(updateCustom, 'accentColor')) {
        if (updateCustom.accentColor === null) {
          delete raw.custom.accentColor;
        } else {
          raw.custom.accentColor = updateCustom.accentColor;
        }
      }
      if (Object.prototype.hasOwnProperty.call(updateCustom, 'backgroundImage')) {
        if (updateCustom.backgroundImage === null) {
          delete raw.custom.backgroundImage;
        } else {
          raw.custom.backgroundImage = updateCustom.backgroundImage;
        }
      }
    }
  }
  return normalizeThemeSelection(raw, presets);
}

function buildAccentOverrides(accentRgb, variantKey) {
  const baseAlpha = variantKey === 'dark' ? 0.88 : 0.88;
  const hoverAlpha = variantKey === 'dark' ? 0.9 : 0.92;
  const start = adjustColor(accentRgb, 0.12);
  const strongLight = mixColors(accentRgb, { r: 255, g: 255, b: 255 }, 0.45);
  const hoverStart = adjustColor(accentRgb, -0.08);
  const hoverEnd = adjustColor(accentRgb, -0.2);
  const glowBase = mixColors(accentRgb, { r: 255, g: 255, b: 255 }, 0.35);
  const lightGlowAlpha = variantKey === 'dark' ? 0.28 : 0.24;
  const shadowAlpha = variantKey === 'dark' ? 0.32 : 0.28;
  const hoverShadowAlpha = shadowAlpha + 0.04;
  return {
    '--button-bg': formatRgba(accentRgb, baseAlpha),
    '--button-hover': formatRgba(hoverStart, hoverAlpha),
    '--glass-button-bg-start': formatRgba(start, variantKey === 'dark' ? 0.94 : 0.95),
    '--glass-button-bg-end': formatRgba(accentRgb, variantKey === 'dark' ? 0.88 : 0.85),
    '--glass-button-hover-start': formatRgba(hoverStart, 0.98),
    '--glass-button-hover-end': formatRgba(hoverEnd, 0.92),
    '--glass-button-border': formatRgba(strongLight, variantKey === 'dark' ? 0.45 : 0.58),
    '--glass-button-shadow': `0 20px 36px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Number(shadowAlpha.toFixed(3))}), 0 12px 24px rgba(15, 35, 22, 0.2)` ,
    '--glass-button-hover-shadow': `0 26px 44px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Number(hoverShadowAlpha.toFixed(3))}), 0 14px 28px rgba(15, 35, 22, 0.22)` ,
    '--glass-focus-ring': formatRgba(accentRgb, variantKey === 'dark' ? 0.6 : 0.52),
    '--glow-color': formatRgba(glowBase, lightGlowAlpha),
  };
}

function resolveThemeSelection(selection, presets) {
  const preset = findThemePreset(presets, selection.presetId) || presets[0];
  const warnings = [];
  const resolved = {};
  const accentHex = selection.custom?.accentColor;
  let accentRgb = null;
  if (accentHex) {
    const parsed = parseHexColor(accentHex);
    if (parsed) {
      const contrast = contrastRatio(parsed, { r: 255, g: 255, b: 255 });
      if (contrast >= 4.5) {
        accentRgb = parsed;
      } else {
        warnings.push('Akzentfarbe wurde zurückgesetzt, da der Kontrast zu gering war.');
      }
    }
  }
  const backgroundOverride = selection.custom?.backgroundImage || null;

  Object.entries(preset.variants).forEach(([variantKey, variantConfig]) => {
    const variables = { ...variantConfig.variables };
    const assets = {
      backgroundImage: null,
      presetBackgroundImage: variantConfig.variables['--bg-image'] || null,
    };
    if (accentRgb) {
      Object.assign(variables, buildAccentOverrides(accentRgb, variantKey));
    }
    if (backgroundOverride && backgroundOverride.value) {
      const cssUrl = toCssUrl(backgroundOverride.value);
      if (cssUrl) {
        variables['--bg-image'] = cssUrl;
        assets.backgroundImage = {
          type: backgroundOverride.type || 'custom',
          source: backgroundOverride.value,
        };
      }
    }
    resolved[variantKey] = { variables, assets };
  });

  if (!resolved[selection.variant]) {
    const fallbackVariant = Object.keys(resolved)[0];
    selection.variant = fallbackVariant || selection.variant;
  }

  return { preset, resolved, warnings };
}

async function getThemeState(context) {
  const presets = await loadThemePresets();
  const stored = await getSetting(context, THEME_SELECTION_KEY);
  const { selection, warnings: normalizeWarnings } = normalizeThemeSelection(stored, presets.presets);
  const { preset, resolved, warnings: resolveWarnings } = resolveThemeSelection(selection, presets.presets);
  return {
    presetsVersion: presets.version,
    preset: preset ? { id: preset.id, name: preset.name, description: preset.description, preview: preset.preview } : null,
    selection,
    resolved,
    warnings: [...normalizeWarnings, ...resolveWarnings],
  };
}

async function saveThemeSelection(context, selection) {
  const payload = { ...selection, updatedAt: new Date().toISOString() };
  await setSetting(context, THEME_SELECTION_KEY, payload);
  return payload;
}

async function applyThemeUpdate(context, update) {
  const presets = await loadThemePresets();
  const stored = await getSetting(context, THEME_SELECTION_KEY);
  const { selection: baseSelection } = normalizeThemeSelection(stored, presets.presets);
  const { selection, warnings: mergeWarnings } = mergeThemeSelection(baseSelection, update, presets.presets);
  const persisted = await saveThemeSelection(context, selection);
  const { preset, resolved, warnings: resolveWarnings } = resolveThemeSelection(persisted, presets.presets);
  return {
    presetsVersion: presets.version,
    preset: preset ? { id: preset.id, name: preset.name, description: preset.description, preview: preset.preview } : null,
    selection: persisted,
    resolved,
    warnings: [...mergeWarnings, ...resolveWarnings],
  };
}

function generateJoinCode(length = 8) {
  if (length <= 0) {
    length = 8;
  }
  const randomBytes = crypto.randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    const value = randomBytes[index];
    code += LOBBY_JOIN_CODE_ALPHABET[value % LOBBY_JOIN_CODE_ALPHABET.length];
  }
  return code;
}

function formatLobbyRow(row, { includeJoinCode = false } = {}) {
  if (!row) {
    return null;
  }
  const lobby = {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    isPersonal: row.is_personal,
    role: row.role,
    isOwner: row.role === 'owner',
    isAdmin: row.role === 'owner' || row.role === 'admin',
  };
  if (includeJoinCode && typeof row.join_code === 'string') {
    lobby.joinCode = row.join_code;
  }
  if (row.created_at) {
    lobby.createdAt = row.created_at;
  }
  if (row.updated_at) {
    lobby.updatedAt = row.updated_at;
  }
  return lobby;
}

async function ensureLobbyMembership(ownerId, lobbyId) {
  const result = await query(
    `SELECT l.id, l.name, l.owner_id, l.join_code, l.is_personal, l.created_at, l.updated_at, m.role
       FROM lobby_members m
       JOIN lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = $1 AND l.id = $2
      LIMIT 1`,
    [ownerId, lobbyId]
  );
  if (result.rowCount === 0) {
    return null;
  }
  const includeJoinCode = result.rows[0].owner_id === ownerId || result.rows[0].role === 'admin';
  return formatLobbyRow(result.rows[0], { includeJoinCode });
}

async function createLobbyRecord(ownerId, name, { isPersonal = false } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new HttpError(400, 'Name der Lobby fehlt.');
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const insertResult = await query(
        `INSERT INTO lobbies (owner_id, name, join_code, is_personal)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, owner_id, join_code, is_personal, created_at, updated_at`,
        [ownerId, trimmed, joinCode, isPersonal]
      );

      const lobby = insertResult.rows[0];

      await query(
        `INSERT INTO lobby_members (lobby_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (lobby_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        [lobby.id, ownerId]
      );

      return formatLobbyRow({ ...lobby, role: 'owner' }, { includeJoinCode: true });
    } catch (error) {
      if (error?.code === '23505') {
        // join code conflict – retry with a new code
        continue;
      }
      throw error;
    }
  }

  throw new HttpError(500, 'Lobby konnte nicht erstellt werden.');
}

async function ensurePersonalLobby(ownerId) {
  const result = await query(
    `SELECT l.id, l.name, l.owner_id, l.join_code, l.is_personal, l.created_at, l.updated_at, m.role
       FROM lobby_members m
       JOIN lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = $1 AND l.is_personal = TRUE
      LIMIT 1`,
    [ownerId]
  );

  if (result.rowCount > 0) {
    return formatLobbyRow(result.rows[0], { includeJoinCode: true });
  }

  return createLobbyRecord(ownerId, 'Eigene Sammlung', { isPersonal: true });
}

async function listUserLobbies(ownerId) {
  await ensurePersonalLobby(ownerId);
  const result = await query(
    `SELECT l.id, l.name, l.owner_id, l.join_code, l.is_personal, l.created_at, l.updated_at, m.role
       FROM lobby_members m
       JOIN lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = $1
      ORDER BY l.is_personal DESC, LOWER(l.name) ASC`,
    [ownerId]
  );
  return result.rows.map((row) => {
    const includeJoinCode = row.owner_id === ownerId || row.role === 'admin';
    return formatLobbyRow(row, { includeJoinCode });
  });
}

function hasLobbyWriteAccess(lobby) {
  if (!lobby) {
    return false;
  }
  if (lobby.isPersonal) {
    return true;
  }
  return lobby.role === 'owner' || lobby.role === 'admin';
}

async function joinLobbyByCode(userId, joinCodeRaw) {
  const joinCode = typeof joinCodeRaw === 'string' ? joinCodeRaw.replace(/\s+/g, '').toUpperCase() : '';
  if (!joinCode || joinCode.length < 4) {
    throw new HttpError(400, 'Bitte gib einen gültigen Beitrittscode ein.');
  }

  const lobbyResult = await query(
    `SELECT id, owner_id, name, join_code, is_personal, created_at, updated_at
       FROM lobbies
      WHERE UPPER(join_code) = $1
      LIMIT 1`,
    [joinCode]
  );

  if (lobbyResult.rowCount === 0) {
    throw new HttpError(404, 'Keine Lobby mit diesem Code gefunden.');
  }

  const lobby = lobbyResult.rows[0];
  if (lobby.is_personal && lobby.owner_id !== userId) {
    throw new HttpError(403, 'Private Lobbys können nicht beigetreten werden.');
  }

  const membershipResult = await query(
    `INSERT INTO lobby_members (lobby_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (lobby_id, user_id)
     DO UPDATE SET updated_at = NOW()
     RETURNING role`,
    [lobby.id, userId]
  );

  return formatLobbyRow({ ...lobby, role: membershipResult.rows[0].role }, { includeJoinCode: false });
}

async function updateLobbyName(userId, lobbyId, name) {
  const membership = await ensureLobbyMembership(userId, lobbyId);
  if (!membership) {
    throw new HttpError(404, 'Lobby wurde nicht gefunden.');
  }
  if (!membership.isOwner && !membership.isPersonal) {
    throw new HttpError(403, 'Nur Besitzer:innen dürfen den Namen ändern.');
  }

  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new HttpError(400, 'Bitte gib einen gültigen Namen ein.');
  }

  await query('UPDATE lobbies SET name = $1, updated_at = NOW() WHERE id = $2', [trimmed, lobbyId]);
  return ensureLobbyMembership(userId, lobbyId);
}

async function rotateLobbyJoinCode(userId, lobbyId) {
  const membership = await ensureLobbyMembership(userId, lobbyId);
  if (!membership) {
    throw new HttpError(404, 'Lobby wurde nicht gefunden.');
  }
  if (!membership.isOwner) {
    throw new HttpError(403, 'Nur Besitzer:innen können den Beitrittscode erneuern.');
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      await query('UPDATE lobbies SET join_code = $1, updated_at = NOW() WHERE id = $2', [joinCode, lobbyId]);
      return ensureLobbyMembership(userId, lobbyId);
    } catch (error) {
      if (error?.code === '23505') {
        continue;
      }
      throw error;
    }
  }

  throw new HttpError(500, 'Der Beitrittscode konnte nicht erneuert werden.');
}

async function listLobbyMembers(userId, lobbyId) {
  const membership = await ensureLobbyMembership(userId, lobbyId);
  if (!membership) {
    throw new HttpError(404, 'Lobby wurde nicht gefunden.');
  }
  if (!hasLobbyWriteAccess(membership)) {
    throw new HttpError(403, 'Keine Berechtigung, Mitglieder zu verwalten.');
  }

  const result = await query(
    `SELECT m.user_id, m.role, u.display_name, u.email
       FROM lobby_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.lobby_id = $1
      ORDER BY m.role DESC, LOWER(u.display_name) ASC`,
    [lobbyId]
  );
  return {
    lobby: membership,
    members: result.rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      displayName: row.display_name,
      email: row.email,
      isOwner: row.role === 'owner',
      isAdmin: row.role === 'owner' || row.role === 'admin',
    })),
  };
}

async function updateLobbyMemberRole(requestorId, lobbyId, memberId, nextRole) {
  const normalizedRole = typeof nextRole === 'string' ? nextRole.trim().toLowerCase() : '';
  const allowedRoles = new Set(['admin', 'member']);
  if (!allowedRoles.has(normalizedRole)) {
    throw new HttpError(400, 'Ungültige Rolle.');
  }

  const membership = await ensureLobbyMembership(requestorId, lobbyId);
  if (!membership || !membership.isOwner) {
    throw new HttpError(403, 'Nur Besitzer:innen können Rollen vergeben.');
  }
  if (requestorId === memberId) {
    throw new HttpError(400, 'Die eigene Rolle kann nicht angepasst werden.');
  }

  const target = await query(
    `SELECT role FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
    [lobbyId, memberId]
  );
  if (target.rowCount === 0) {
    throw new HttpError(404, 'Mitglied wurde nicht gefunden.');
  }
  if (target.rows[0].role === 'owner') {
    throw new HttpError(400, 'Die Besitzer:in-Rolle kann nicht verändert werden.');
  }

  await query(
    `UPDATE lobby_members SET role = $1, updated_at = NOW()
      WHERE lobby_id = $2 AND user_id = $3`,
    [normalizedRole, lobbyId, memberId]
  );

  return listLobbyMembers(requestorId, lobbyId);
}

async function removeLobbyMember(requestorId, lobbyId, memberId) {
  const membership = await ensureLobbyMembership(requestorId, lobbyId);
  if (!membership) {
    throw new HttpError(404, 'Lobby wurde nicht gefunden.');
  }

  if (memberId === requestorId) {
    const personalCheck = membership.isPersonal;
    if (personalCheck) {
      throw new HttpError(400, 'Die persönliche Lobby kann nicht verlassen werden.');
    }
    await query('DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2', [lobbyId, memberId]);
    return;
  }

  if (!membership.isOwner) {
    throw new HttpError(403, 'Nur Besitzer:innen können andere entfernen.');
  }

  const target = await query(
    `SELECT role, user_id FROM lobby_members WHERE lobby_id = $1 AND user_id = $2`,
    [lobbyId, memberId]
  );

  if (target.rowCount === 0) {
    throw new HttpError(404, 'Mitglied wurde nicht gefunden.');
  }
  if (target.rows[0].role === 'owner') {
    throw new HttpError(400, 'Die Besitzer:in kann nicht entfernt werden.');
  }

  await query('DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2', [lobbyId, memberId]);
}

async function deleteLobby(requestorId, lobbyId) {
  const membership = await ensureLobbyMembership(requestorId, lobbyId);
  if (!membership) {
    throw new HttpError(404, 'Lobby wurde nicht gefunden.');
  }
  if (!membership.isOwner) {
    throw new HttpError(403, 'Nur Besitzer:innen können die Lobby löschen.');
  }
  if (membership.isPersonal) {
    throw new HttpError(400, 'Die persönliche Lobby kann nicht gelöscht werden.');
  }

  await query('DELETE FROM lobbies WHERE id = $1', [lobbyId]);
  return listUserLobbies(requestorId);
}

async function resolveLobbyContext(req, { requireWriteAccess = false } = {}) {
  const userId = req.user?.id;
  if (!userId) {
    throw new HttpError(401, 'Bitte melde dich an.');
  }

  const rawHeader = req.headers?.[LOBBY_HEADER] || req.headers?.[LOBBY_HEADER.toUpperCase()] || '';
  const rawQueryLobby = typeof req.query?.lobby === 'string' ? req.query.lobby : '';
  const lobbySelector = rawHeader || rawQueryLobby;
  let lobby;

  if (lobbySelector && lobbySelector.toLowerCase() !== 'personal') {
    const parsed = Number(lobbySelector);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpError(400, 'Ungültige Lobby-Auswahl.');
    }
    lobby = await ensureLobbyMembership(userId, parsed);
    if (!lobby) {
      throw new HttpError(404, 'Lobby wurde nicht gefunden oder Zugriff verweigert.');
    }
  } else {
    lobby = await ensurePersonalLobby(userId);
  }

  if (requireWriteAccess && !hasLobbyWriteAccess(lobby)) {
    throw new HttpError(403, 'Keine Schreibrechte für diese Lobby.');
  }

  return {
    ownerId: userId,
    lobbyId: lobby.id,
    lobby,
  };
}

function parseCookies(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return {};
  }

  return headerValue
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reduce((acc, part) => {
      const separator = part.indexOf('=');
      if (separator === -1) {
        return acc;
      }

      const key = decodeURIComponent(part.slice(0, separator).trim());
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (key.length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function cookieParserMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers?.cookie || '');
  next();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.indexOf(':') === -1) {
    return false;
  }
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) {
    return false;
  }
  const derivedKey = await scryptAsync(password, salt);
  const storedKey = Buffer.from(key, 'hex');
  if (storedKey.length !== derivedKey.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedKey, derivedKey);
}

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeDisplayName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) {
    return null;
  }
  return normalized;
}

function formatUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    locale: row.locale || null,
  };
}

async function cleanupExpiredSessions() {
  if (sessionsDisabledDueToPermissions) {
    return;
  }
  try {
    await query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  } catch (error) {
    const converted = convertSessionStorageError(error);
    if (converted) {
      throw converted;
    }
    throw error;
  }
}

async function createSession(userId) {
  await cleanupExpiredSessions();
  if (sessionsDisabledDueToPermissions) {
    throw new HttpError(
      503,
      'Sitzungen sind aufgrund fehlender Datenbankberechtigungen deaktiviert. Bitte passe die Rolle oder Verbindungsdaten an.'
    );
  }
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    try {
      await query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, userId, expiresAt]
      );
      return { token, expiresAt };
    } catch (error) {
      if (error?.code === '23505') {
        continue;
      }
      const converted = convertSessionStorageError(error);
      if (converted) {
        throw converted;
      }
      throw error;
    }
  }

  throw new Error('Sitzung konnte nicht gespeichert werden.');
}

async function destroySessionByToken(token) {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  if (sessionsDisabledDueToPermissions) {
    return;
  }
  try {
    await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
  } catch (error) {
    const converted = convertSessionStorageError(error);
    if (converted) {
      return;
    }
    throw error;
  }
}

async function loadSession(token) {
  if (!token) {
    return null;
  }
  await ensureUserLocaleColumnExists();
  const tokenHash = hashToken(token);
  let result;
  try {
    result = await query(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.display_name, u.is_admin, u.locale
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [tokenHash]
    );
  } catch (error) {
    const converted = convertSessionStorageError(error);
    if (converted) {
      return null;
    }
    throw error;
  }

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }

  return {
    tokenHash: row.token_hash,
    expiresAt,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      isAdmin: row.is_admin,
      locale: row.locale || null,
    },
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions, expires: expiresAt });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...baseCookieOptions });
}

let hasLoggedSessionLoadError = false;

async function loadUserFromSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  req.user = null;

  if (!token) {
    return next();
  }

  try {
    const session = await loadSession(token);
    if (!session) {
      clearSessionCookie(res);
      return next();
    }

    req.user = session.user;
    req.sessionTokenHash = session.tokenHash;
    return next();
  } catch (error) {
    if (!hasLoggedSessionLoadError) {
      console.error('Sitzung konnte nicht geladen werden:', error);
      hasLoggedSessionLoadError = true;
    }
    return next();
  }
}

function requireAuthForApi(req, res, next) {
  if (req.path?.startsWith('/auth')) {
    return next();
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Bitte melde dich an.' });
  }
  return next();
}

async function getSetting(context, key) {
  if (!context || !Number.isInteger(context.lobbyId)) {
    throw new HttpError(400, 'Ungültiger Kontext für gespeicherte Werte.');
  }
  const result = await query(
    `SELECT value FROM kv_store WHERE lobby_id = $1 AND key = $2 LIMIT 1`,
    [context.lobbyId, key]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0].value;
}

async function setSetting(context, key, value) {
  if (!context || !Number.isInteger(context.lobbyId) || !Number.isInteger(context.ownerId)) {
    throw new HttpError(400, 'Ungültiger Kontext für gespeicherte Werte.');
  }
  const serializedValue = JSON.stringify(value ?? null);
  const updated = await query(
    `UPDATE kv_store
        SET value = $4, updated_at = NOW(), owner_id = $1
      WHERE lobby_id = $2 AND key = $3`,
    [context.ownerId, context.lobbyId, key, serializedValue]
  );
  if (updated.rowCount > 0) {
    return;
  }
  await query(
    `INSERT INTO kv_store (owner_id, lobby_id, key, value, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [context.ownerId, context.lobbyId, key, serializedValue]
  );
}

async function removeSetting(context, key) {
  if (!context || !Number.isInteger(context.lobbyId)) {
    throw new HttpError(400, 'Ungültiger Kontext für gespeicherte Werte.');
  }
  await query('DELETE FROM kv_store WHERE lobby_id = $1 AND key = $2', [context.lobbyId, key]);
}

function cloneJson(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function uniqueStrings(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  list.forEach((entry) => {
    const trimmed = toTrimmedString(entry);
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
}

function normalizeRoleSchema(input) {
  const data = input && typeof input === 'object' ? cloneJson(input) : {};

  const rawCategories = Array.isArray(data.categories) ? data.categories : [];
  const categories = [];
  const categorySeen = new Set();
  rawCategories.forEach((cat) => {
    const id = toTrimmedString(cat?.id || cat?.name || cat);
    if (!id) {
      return;
    }
    const key = id.toLowerCase();
    if (categorySeen.has(key)) {
      return;
    }
    categorySeen.add(key);
    const label = toTrimmedString(cat?.label) || id;
    categories.push({ id, label });
  });

  if (categories.length === 0) {
    categories.push({ id: 'village', label: 'Dorfbewohner' });
    categories.push({ id: 'werwolf', label: 'Werwölfe' });
    categories.push({ id: 'special', label: 'Sonderrollen' });
  }

  const defaultCategory = categories[0]?.id || 'special';
  const validCategoryIds = new Set(categories.map((cat) => cat.id));

  const rawRoles = Array.isArray(data.roles) ? data.roles : [];
  const roles = [];
  const roleSeen = new Set();
  rawRoles.forEach((role) => {
    const name = toTrimmedString(role?.name || role);
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (roleSeen.has(key)) {
      return;
    }
    roleSeen.add(key);
    const category = validCategoryIds.has(role?.category) ? role.category : defaultCategory;
    const description = toTrimmedString(role?.description);
    const abilities = uniqueStrings(role?.abilities);
    roles.push({ name, category, description, abilities });
  });

  const roleNames = roles.map((role) => role.name);
  const roleNameSet = new Set(roleNames.map((name) => name.toLowerCase()));

  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
  const jobs = [];
  const jobSeen = new Set();
  rawJobs.forEach((job) => {
    const name = toTrimmedString(job?.name || job);
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (jobSeen.has(key)) {
      return;
    }
    jobSeen.add(key);
    const description = toTrimmedString(job?.description);
    const eligibleRoles = uniqueStrings(job?.eligibleRoles).filter((roleName) =>
      roleNameSet.has(roleName.toLowerCase())
    );
    jobs.push({ name, description, eligibleRoles });
  });

  const allowedStepConditions = new Set(['firstNightOnly', 'requiresDoctorTargets']);

  const rawNightSequence = data?.night && typeof data.night === 'object'
    ? Array.isArray(data.night.sequence) ? data.night.sequence : []
    : [];
  const nightSequence = rawNightSequence.map((step) => {
    const id = toTrimmedString(step?.id || step?.name || step);
    const prompt = toTrimmedString(step?.prompt) || (id ? `${id} ist an der Reihe.` : 'Nachtaktion');
    const requires = step && typeof step === 'object' ? step.requires : null;
    const requiredRoles = uniqueStrings(requires?.roles).filter((roleName) =>
      roleNameSet.has(roleName.toLowerCase())
    );
    const requiredJobs = uniqueStrings(requires?.jobs);
    const phase = toTrimmedString(step?.phase) || 'night';
    const conditions = {};
    if (step && typeof step.conditions === 'object') {
      allowedStepConditions.forEach((key) => {
        if (typeof step.conditions[key] === 'boolean') {
          conditions[key] = step.conditions[key];
        }
      });
    }
    return {
      id: id || `step-${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      requires: {
        roles: requiredRoles,
        jobs: requiredJobs,
      },
      phase,
      conditions,
    };
  });

  const version = Number.isFinite(Number(data.version)) ? Number(data.version) : 1;

  return {
    version,
    categories,
    roles,
    jobs,
    night: {
      sequence: nightSequence,
    },
  };
}

async function loadDefaultRoleSchema() {
  if (defaultRoleSchemaCache) {
    return cloneJson(defaultRoleSchemaCache);
  }
  try {
    const raw = await fs.promises.readFile(defaultRoleSchemaPath, 'utf8');
    const parsed = JSON.parse(raw);
    defaultRoleSchemaCache = normalizeRoleSchema(parsed);
    return cloneJson(defaultRoleSchemaCache);
  } catch (error) {
    console.error('Standard-Rollenschema konnte nicht geladen werden:', error);
    defaultRoleSchemaCache = normalizeRoleSchema({});
    return cloneJson(defaultRoleSchemaCache);
  }
}

async function getStoredRoleSchema(context) {
  const value = await getSetting(context, ROLE_SCHEMA_KEY);
  if (!value) {
    return null;
  }
  return normalizeRoleSchema(value);
}

async function getEffectiveRoleSchema(context) {
  const stored = await getStoredRoleSchema(context);
  if (stored) {
    return { config: stored, source: 'custom' };
  }
  const fallback = await loadDefaultRoleSchema();
  return { config: fallback, source: 'default' };
}

async function saveRoleSchema(context, schema) {
  const normalized = normalizeRoleSchema(schema);
  normalized.updatedAt = new Date().toISOString();
  await setSetting(context, ROLE_SCHEMA_KEY, normalized);
  return cloneJson(normalized);
}

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  return res.json({ user: { ...req.user } });
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await destroySessionByToken(token);
    }
    clearSessionCookie(res);
    return res.status(204).end();
  } catch (error) {
    return handleApiError(res, error, 'Abmelden fehlgeschlagen.');
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist ungültig.' });
    }

    await ensureUserLocaleColumnExists();
    const result = await query(
      `SELECT id, email, display_name, is_admin, password_hash, locale
         FROM users
        WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
      [normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist falsch.' });
    }

    const userRow = result.rows[0];
    const passwordValid = await verifyPassword(password, userRow.password_hash);
    if (!passwordValid) {
      return res.status(400).json({ error: 'E-Mail oder Passwort ist falsch.' });
    }

    await ensurePersonalLobby(userRow.id);

    const { token, expiresAt } = await createSession(userRow.id);
    setSessionCookie(res, token, expiresAt);

    return res.json({ user: formatUser(userRow) });
  } catch (error) {
    return handleApiError(res, error, 'Anmeldung fehlgeschlagen.');
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName, adminCode, adminKey } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const providedAdminCode = (() => {
      if (typeof adminCode === 'string' && adminCode.trim().length > 0) {
        return adminCode.trim();
      }
      if (typeof adminKey === 'string' && adminKey.trim().length > 0) {
        return adminKey.trim();
      }
      return '';
    })();

    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' });
    }
    if (!normalizedDisplayName) {
      return res.status(400).json({ error: 'Der Anzeigename muss mindestens zwei Zeichen enthalten.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
    }

    await ensureUserLocaleColumnExists();
    const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [normalizedEmail]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
    }

    const adminCountResult = await query('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE');
    const hasAdmin = Number(adminCountResult.rows[0].count || 0) > 0;
    const expectedAdminCode = (process.env.WERWOLF_ADMIN_CODE || '0427').trim();
    let isAdmin = false;

    if (!hasAdmin) {
      isAdmin = true;
    } else if (providedAdminCode && expectedAdminCode && providedAdminCode === expectedAdminCode) {
      isAdmin = true;
    } else if (providedAdminCode && (!expectedAdminCode || providedAdminCode !== expectedAdminCode)) {
      return res.status(403).json({ error: 'Der angegebene Admin-Code ist ungültig.' });
    }

    const passwordHash = await hashPassword(password);
    const insertResult = await query(
      `INSERT INTO users (email, password_hash, display_name, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, is_admin, locale`,
      [normalizedEmail, passwordHash, normalizedDisplayName, isAdmin]
    );

    const userRow = insertResult.rows[0];
    await ensurePersonalLobby(userRow.id);

    const { token, expiresAt } = await createSession(userRow.id);
    setSessionCookie(res, token, expiresAt);

    return res.status(201).json({ user: formatUser(userRow) });
  } catch (error) {
    return handleApiError(res, error, 'Registrierung fehlgeschlagen.');
  }
});

app.use('/api', requireAuthForApi);

app.get('/api/locale', (req, res) => {
  const preference = typeof req.user?.locale === 'string' ? req.user.locale : null;
  const effective = normalizeLocaleInput(preference) || 'de';
  res.json({
    locale: preference,
    effective,
    fallback: 'de',
    supported: Array.from(SUPPORTED_LOCALES),
  });
});

app.put('/api/locale', async (req, res) => {
  const preference = typeof req.body?.preference === 'string'
    ? req.body.preference
    : (typeof req.body?.locale === 'string' ? req.body.locale : req.body?.preference);

  const trimmedPreference = typeof preference === 'string' ? preference.trim().toLowerCase() : null;
  const normalized = normalizeLocaleInput(preference);

  if (trimmedPreference && trimmedPreference !== 'system' && !normalized) {
    return res.status(400).json({ error: 'Diese Sprache wird nicht unterstützt.' });
  }

  const storeValue = (!trimmedPreference || trimmedPreference === 'system') ? null : normalized;

  try {
    await ensureUserLocaleColumnExists();
    await query('UPDATE users SET locale = $1 WHERE id = $2', [storeValue, req.user.id]);
    req.user.locale = storeValue;
    const effective = normalizeLocaleInput(storeValue) || 'de';
    res.json({ locale: storeValue, effective, fallback: 'de' });
  } catch (error) {
    handleApiError(res, error, 'Sprache konnte nicht gespeichert werden.');
  }
});

app.get('/api/lobbies', async (req, res) => {
  try {
    const lobbies = await listUserLobbies(req.user.id);
    res.json({ lobbies });
  } catch (error) {
    handleApiError(res, error, 'Lobbys konnten nicht geladen werden.');
  }
});

app.post('/api/lobbies', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const lobby = await createLobbyRecord(req.user.id, name || 'Neue Lobby', { isPersonal: false });
    const lobbies = await listUserLobbies(req.user.id);
    res.status(201).json({ lobby, lobbies });
  } catch (error) {
    handleApiError(res, error, 'Lobby konnte nicht erstellt werden.');
  }
});

app.post('/api/lobbies/join', async (req, res) => {
  try {
    const code = req.body?.code || req.body?.joinCode || req.body?.token;
    const lobby = await joinLobbyByCode(req.user.id, code);
    const lobbies = await listUserLobbies(req.user.id);
    res.json({ lobby, lobbies });
  } catch (error) {
    handleApiError(res, error, 'Lobby konnte nicht beigetreten werden.');
  }
});

function parseLobbyId(param) {
  const lobbyId = Number(param);
  if (!Number.isInteger(lobbyId) || lobbyId <= 0) {
    throw new HttpError(400, 'Ungültige Lobby-ID.');
  }
  return lobbyId;
}

app.patch('/api/lobbies/:lobbyId', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    let lobby = null;
    if (typeof req.body?.name === 'string') {
      lobby = await updateLobbyName(req.user.id, lobbyId, req.body.name);
    }
    if (req.body?.rotateJoinCode) {
      lobby = await rotateLobbyJoinCode(req.user.id, lobbyId);
    }
    if (!lobby) {
      lobby = await ensureLobbyMembership(req.user.id, lobbyId);
      if (!lobby) {
        throw new HttpError(404, 'Lobby wurde nicht gefunden.');
      }
    }
    res.json({ lobby });
  } catch (error) {
    handleApiError(res, error, 'Lobby konnte nicht aktualisiert werden.');
  }
});

app.post('/api/lobbies/:lobbyId/rotate-code', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    const lobby = await rotateLobbyJoinCode(req.user.id, lobbyId);
    res.json({ lobby });
  } catch (error) {
    handleApiError(res, error, 'Beitrittscode konnte nicht erneuert werden.');
  }
});

app.delete('/api/lobbies/:lobbyId', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    const membership = await ensureLobbyMembership(req.user.id, lobbyId);
    if (!membership) {
      throw new HttpError(404, 'Lobby wurde nicht gefunden.');
    }
    const deleteRequested = req.body?.delete === true || req.query?.delete === 'true';
    if (membership.isOwner && !membership.isPersonal && deleteRequested) {
      const lobbies = await deleteLobby(req.user.id, lobbyId);
      res.json({ lobbies });
      return;
    }

    await removeLobbyMember(req.user.id, lobbyId, req.user.id);
    const lobbies = await listUserLobbies(req.user.id);
    res.json({ lobbies });
  } catch (error) {
    handleApiError(res, error, 'Lobby konnte nicht verlassen werden.');
  }
});

app.get('/api/lobbies/:lobbyId/members', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    const result = await listLobbyMembers(req.user.id, lobbyId);
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Mitglieder konnten nicht geladen werden.');
  }
});

app.patch('/api/lobbies/:lobbyId/members/:memberId', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    const memberId = Number(req.params.memberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      throw new HttpError(400, 'Ungültige Benutzer-ID.');
    }
    const result = await updateLobbyMemberRole(req.user.id, lobbyId, memberId, req.body?.role);
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Mitglied konnte nicht aktualisiert werden.');
  }
});

app.delete('/api/lobbies/:lobbyId/members/:memberId', async (req, res) => {
  try {
    const lobbyId = parseLobbyId(req.params.lobbyId);
    const memberId = Number(req.params.memberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      throw new HttpError(400, 'Ungültige Benutzer-ID.');
    }
    await removeLobbyMember(req.user.id, lobbyId, memberId);
    if (memberId === req.user.id) {
      const lobbies = await listUserLobbies(req.user.id);
      res.json({ lobbies });
    } else {
      const result = await listLobbyMembers(req.user.id, lobbyId);
      res.json(result);
    }
  } catch (error) {
    handleApiError(res, error, 'Mitglied konnte nicht entfernt werden.');
  }
});

app.get('/api/themes', async (req, res) => {
  try {
    const presets = await loadThemePresets();
    res.json(presets);
  } catch (error) {
    handleApiError(res, error, 'Theme-Presets konnten nicht geladen werden.');
  }
});

app.get('/api/theme', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const state = await getThemeState(context);
    res.json(state);
  } catch (error) {
    handleApiError(res, error, 'Theme konnte nicht geladen werden.');
  }
});

app.put('/api/theme', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    let update = req.body?.selection ?? req.body?.theme ?? req.body;
    if (typeof update === 'string') {
      update = { variant: update };
    }
    const state = await applyThemeUpdate(context, update || {});
    res.json(state);
    broadcastSseEvent(context.lobbyId, 'theme', state);
  } catch (error) {
    handleApiError(res, error, 'Theme konnte nicht gespeichert werden.');
  }
});

app.get('/api/realtime', async (req, res) => {
  let client = null;
  try {
    const context = await resolveLobbyContext(req);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    client = registerSseClient(context.lobbyId, res);
    sendSseEvent(client, 'connected', { lobbyId: context.lobbyId });
    const state = await getThemeState(context);
    sendSseEvent(client, 'theme', state);
  } catch (error) {
    if (!res.headersSent) {
      handleApiError(res, error, 'Echtzeitkanal konnte nicht geöffnet werden.');
    } else {
      try {
        sendSseEvent(client || { res, lobbyId: null }, 'error', { error: error?.message || 'Verbindung getrennt.' });
      } catch (sendError) {
        // ignore secondary errors
      }
      res.end();
    }
  }
});

app.get('/api/saved-names', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const value = await getSetting(context, 'werwolfSavedNames');
    res.json({ names: Array.isArray(value) ? value : [] });
  } catch (error) {
    handleApiError(res, error, 'Gespeicherte Namen konnten nicht geladen werden.');
  }
});

app.put('/api/saved-names', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const names = Array.isArray(req.body?.names)
      ? req.body.names.filter((name) => typeof name === 'string' && name.trim().length > 0)
      : [];
    await setSetting(context, 'werwolfSavedNames', names);
    res.json({ names });
  } catch (error) {
    handleApiError(res, error, 'Gespeicherte Namen konnten nicht abgelegt werden.');
  }
});

app.get('/api/role-presets', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const value = await getSetting(context, 'werwolfSavedRoles');
    res.json({ roles: Array.isArray(value) ? value : [] });
  } catch (error) {
    handleApiError(res, error, 'Gespeicherte Rollen konnten nicht geladen werden.');
  }
});

app.put('/api/role-presets', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const roles = Array.isArray(req.body?.roles)
      ? req.body.roles
          .filter((role) => role && typeof role.name === 'string' && role.name.trim().length > 0)
          .map((role) => ({
            name: role.name.trim(),
            quantity: Number.isFinite(role.quantity) ? Math.max(0, Math.round(role.quantity)) : 0,
          }))
      : [];
    await setSetting(context, 'werwolfSavedRoles', roles);
    res.json({ roles });
  } catch (error) {
    handleApiError(res, error, 'Gespeicherte Rollen konnten nicht abgelegt werden.');
  }
});

app.get('/api/roles-config', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const { config, source } = await getEffectiveRoleSchema(context);
    res.json({ config, source });
  } catch (error) {
    handleApiError(res, error, 'Rollenkonfiguration konnte nicht geladen werden.');
  }
});

async function handleRolesConfigUpdate(req, res, context, { statusOnCreate = 200 } = {}) {
  try {
    const payload = req.body && typeof req.body === 'object'
      ? (req.body.config ?? req.body)
      : null;
    if (!payload || typeof payload !== 'object') {
      throw new HttpError(400, 'Ungültige Rollenkonfiguration.');
    }
    const saved = await saveRoleSchema(context, payload);
    res.status(statusOnCreate).json({ config: saved, source: 'custom' });
  } catch (error) {
    handleApiError(res, error, 'Rollenkonfiguration konnte nicht gespeichert werden.');
  }
  return null;
}

app.post('/api/roles-config', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    await handleRolesConfigUpdate(req, res, context, { statusOnCreate: 201 });
  } catch (error) {
    handleApiError(res, error, 'Rollenkonfiguration konnte nicht gespeichert werden.');
  }
});

app.put('/api/roles-config', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    await handleRolesConfigUpdate(req, res, context, { statusOnCreate: 200 });
  } catch (error) {
    handleApiError(res, error, 'Rollenkonfiguration konnte nicht gespeichert werden.');
  }
});

app.delete('/api/roles-config', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    await removeSetting(context, ROLE_SCHEMA_KEY);
    res.status(204).end();
  } catch (error) {
    handleApiError(res, error, 'Rollenkonfiguration konnte nicht zurückgesetzt werden.');
  }
});

app.get('/api/storage/:key', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const key = req.params.key;
    const value = await getSetting(context, key);
    res.json({ key, value: value ?? null });
  } catch (error) {
    handleApiError(res, error, 'Persistenter Wert konnte nicht geladen werden.');
  }
});

app.put('/api/storage/:key', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const key = req.params.key;
    const { value = null } = req.body || {};
    await setSetting(context, key, value);
    res.json({ key, value });
  } catch (error) {
    handleApiError(res, error, 'Persistenter Wert konnte nicht gespeichert werden.');
  }
});

app.delete('/api/storage/:key', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const key = req.params.key;
    await removeSetting(context, key);
    res.status(204).end();
  } catch (error) {
    handleApiError(res, error, 'Persistenter Wert konnte nicht entfernt werden.');
  }
});

async function listSessions(context) {
  const result = await runSessionStorageQuery(() =>
    query(
      `SELECT timestamp, data
         FROM sessions
        WHERE lobby_id = $1
        ORDER BY timestamp DESC
        LIMIT 20`,
      [context.lobbyId]
    )
  );
  return result.rows.map((row) => ({ ...row.data, timestamp: Number(row.timestamp) }));
}

async function upsertSession(context, session) {
  await runSessionStorageQuery(() =>
    query(
      `INSERT INTO sessions (timestamp, data, created_at, owner_id, lobby_id)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (lobby_id, timestamp)
       DO UPDATE SET data = EXCLUDED.data, owner_id = EXCLUDED.owner_id, updated_at = NOW()`,
      [session.timestamp, session, context.ownerId, context.lobbyId]
    )
  );

  await pruneSessionStorage(context, 20);
}

async function upsertSessionTimeline(context, session) {
  if (!session?.timeline || typeof session.timeline !== 'object') {
    return;
  }

  await runSessionStorageQuery(() =>
    query(
      `INSERT INTO session_timelines (session_timestamp, timeline, created_at, owner_id, lobby_id)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (lobby_id, session_timestamp)
       DO UPDATE SET timeline = EXCLUDED.timeline, owner_id = EXCLUDED.owner_id, updated_at = NOW()`,
      [session.timestamp, session.timeline, context.ownerId, context.lobbyId]
    )
  );
}

async function upsertSessionMetrics(context, session) {
  const metadata = session?.metadata || {};
  const timeline = session?.timeline || {};
  const actions = Array.isArray(timeline.actions) ? timeline.actions : [];
  const checkpoints = Array.isArray(timeline.checkpoints) ? timeline.checkpoints : [];
  const winnerTitle = typeof metadata?.winner?.title === 'string' ? metadata.winner.title : (typeof metadata?.winner?.message === 'string' ? metadata.winner.message : null);
  const playerCount = Number.isFinite(metadata.playerCount) ? metadata.playerCount : Array.isArray(session.players) ? session.players.length : null;
  const actionCount = Number.isFinite(metadata.actionCount) ? metadata.actionCount : actions.length;
  const checkpointCount = Number.isFinite(metadata.checkpointCount) ? metadata.checkpointCount : checkpoints.length;
  const winningInfo = deriveWinningInfoFromSession(session);
  const winnerFaction = winningInfo.faction || null;
  const winningPlayers = Array.isArray(winningInfo.winners) ? winningInfo.winners : [];

  let gameLengthMs = Number.isFinite(metadata.gameDurationMs) ? metadata.gameDurationMs : null;
  if (!Number.isFinite(gameLengthMs) && actions.length > 1) {
    const first = actions[0]?.timestamp;
    const last = actions[actions.length - 1]?.timestamp;
    const duration = Number(last) - Number(first);
    if (Number.isFinite(duration) && duration >= 0) {
      gameLengthMs = duration;
    }
  }

  await runSessionStorageQuery(() =>
    query(
      `INSERT INTO session_metrics (session_timestamp, winner, winner_faction, winning_players, player_count, action_count, checkpoint_count, game_length_ms, created_at, owner_id, lobby_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
       ON CONFLICT (lobby_id, session_timestamp)
       DO UPDATE SET winner = EXCLUDED.winner,
                     winner_faction = EXCLUDED.winner_faction,
                     winning_players = EXCLUDED.winning_players,
                     player_count = EXCLUDED.player_count,
                     action_count = EXCLUDED.action_count,
                     checkpoint_count = EXCLUDED.checkpoint_count,
                     game_length_ms = EXCLUDED.game_length_ms,
                     owner_id = EXCLUDED.owner_id,
                     updated_at = NOW()`,
      [
        session.timestamp,
        winnerTitle,
        winnerFaction,
        JSON.stringify(winningPlayers),
        playerCount,
        actionCount,
        checkpointCount,
        gameLengthMs,
        context.ownerId,
        context.lobbyId,
      ]
    )
  );
}

async function pruneSessionStorage(context, limit = 20) {
  await runSessionStorageQuery(() =>
    query(
      `DELETE FROM sessions
        WHERE lobby_id = $1
          AND timestamp NOT IN (
          SELECT timestamp FROM sessions WHERE lobby_id = $1 ORDER BY timestamp DESC LIMIT $2
        )`,
      [context.lobbyId, limit]
    )
  );

  await runSessionStorageQuery(() =>
    query(
      `DELETE FROM session_timelines
        WHERE lobby_id = $1
          AND session_timestamp NOT IN (
          SELECT timestamp FROM sessions WHERE lobby_id = $1 ORDER BY timestamp DESC LIMIT $2
        )`,
      [context.lobbyId, limit]
    )
  );

  await runSessionStorageQuery(() =>
    query(
      `DELETE FROM session_metrics
        WHERE lobby_id = $1
          AND session_timestamp NOT IN (
          SELECT timestamp FROM sessions WHERE lobby_id = $1 ORDER BY timestamp DESC LIMIT $2
        )`,
      [context.lobbyId, limit]
    )
  );
}

app.get('/api/sessions', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const sessions = await listSessions(context);
    res.json({ sessions });
  } catch (error) {
    handleApiError(res, error, 'Sessions konnten nicht geladen werden.');
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const session = req.body?.session;
    if (!session || typeof session !== 'object') {
      throw new HttpError(400, 'Ungültige Session.');
    }
    const timestamp = Number(session.timestamp || Date.now());
    const normalized = { ...session, timestamp };
    await upsertSession(context, normalized);
    await upsertSessionTimeline(context, normalized);
    await upsertSessionMetrics(context, normalized);
    const sessions = await listSessions(context);
    res.status(201).json({ session: normalized, sessions });
  } catch (error) {
    handleApiError(res, error, 'Session konnte nicht gespeichert werden.');
  }
});

app.get('/api/sessions/:timestamp/timeline', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new HttpError(400, 'Ungültiger Zeitstempel.');
    }
    const result = await runSessionStorageQuery(() =>
      query(
        `SELECT timeline
           FROM session_timelines
          WHERE lobby_id = $1 AND session_timestamp = $2
          LIMIT 1`,
        [context.lobbyId, timestamp]
      )
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Keine Timeline für diese Session gefunden.' });
    }
    return res.json({ timeline: result.rows[0].timeline });
  } catch (error) {
    handleApiError(res, error, 'Timeline konnte nicht geladen werden.');
  }
});

app.delete('/api/sessions/:timestamp', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req, { requireWriteAccess: true });
    const timestamp = Number(req.params.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new HttpError(400, 'Ungültiger Zeitstempel.');
    }
    await runSessionStorageQuery(() =>
      query('DELETE FROM sessions WHERE lobby_id = $1 AND timestamp = $2', [context.lobbyId, timestamp])
    );
    await runSessionStorageQuery(() =>
      query('DELETE FROM session_timelines WHERE lobby_id = $1 AND session_timestamp = $2', [context.lobbyId, timestamp])
    );
    await runSessionStorageQuery(() =>
      query('DELETE FROM session_metrics WHERE lobby_id = $1 AND session_timestamp = $2', [context.lobbyId, timestamp])
    );
    res.status(204).end();
  } catch (error) {
    handleApiError(res, error, 'Session konnte nicht gelöscht werden.');
  }
});
const VILLAGE_ROLES = new Set([
  'Dorfbewohner',
  'Seer',
  'Jäger',
  'Hexe',
  'Stumme Jule',
  'Inquisitor',
  'Sündenbock',
  'Geschwister',
  'Geist',
  'Michael Jackson',
  'Friedenstifter',
]);

const WERWOLF_ROLES = new Set(['Werwolf', 'Verfluchte']);

function normalizePlayerName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function getTeamForRole(roleName) {
  if (typeof roleName !== 'string') {
    return 'special';
  }
  if (WERWOLF_ROLES.has(roleName)) {
    return 'werwolf';
  }
  if (VILLAGE_ROLES.has(roleName)) {
    return 'village';
  }
  return 'special';
}

function deriveWinningInfoFromSession(session) {
  const winner = session?.metadata?.winner;
  if (!winner || typeof winner.title !== 'string') {
    return { faction: null, winners: [] };
  }

  const normalizedTitle = winner.title.trim().toLowerCase();
  const players = Array.isArray(session?.players) ? session.players : [];
  const roles = Array.isArray(session?.rolesAssigned) ? session.rolesAssigned : [];
  const lovers = Array.isArray(session?.lovers) ? session.lovers : [];
  const winners = new Set();
  let faction = null;

  const addWinner = (name) => {
    const normalized = normalizePlayerName(name);
    if (normalized) {
      winners.add(normalized);
    }
  };

  switch (normalizedTitle) {
    case 'werwölfe gewinnen!':
      faction = 'werwolf';
      players.forEach((playerName, index) => {
        if (getTeamForRole(roles[index]) === 'werwolf') {
          addWinner(playerName);
        }
      });
      break;
    case 'dorfbewohner gewinnen!':
      faction = 'village';
      players.forEach((playerName, index) => {
        if (getTeamForRole(roles[index]) !== 'werwolf') {
          addWinner(playerName);
        }
      });
      break;
    case 'die liebenden gewinnen!':
      faction = 'lovers';
      lovers.forEach((pair) => {
        if (Array.isArray(pair)) {
          pair.forEach(addWinner);
        }
      });
      break;
    case 'der henker gewinnt!':
      faction = 'henker';
      roles.forEach((roleName, index) => {
        if (roleName === 'Henker') {
          addWinner(players[index]);
        }
      });
      if (winners.size === 0 && typeof winner.message === 'string') {
        const match = winner.message.match(/^([^!]+?) hat sein Ziel erreicht/i);
        if (match && match[1]) {
          addWinner(match[1]);
        }
      }
      break;
    case 'der friedenstifter gewinnt!':
      faction = 'friedenstifter';
      roles.forEach((roleName, index) => {
        if (roleName === 'Friedenstifter') {
          addWinner(players[index]);
        }
      });
      break;
    default:
      break;
  }

  return { faction, winners: Array.from(winners) };
}

function mapWinnerFactionToLabel(faction) {
  switch (faction) {
    case 'werwolf':
      return 'Werwölfe gewinnen!';
    case 'village':
      return 'Dorfbewohner gewinnen!';
    case 'lovers':
      return 'Die Liebenden gewinnen!';
    case 'henker':
      return 'Der Henker gewinnt!';
    case 'friedenstifter':
      return 'Der Friedenstifter gewinnt!';
    default:
      return null;
  }
}

function ensurePlayerAggregate(map, name) {
  if (!map.has(name)) {
    map.set(name, {
      name,
      games: 0,
      wins: 0,
      deaths: 0,
      roles: new Map(),
      lastPlayedAt: 0,
    });
  }
  return map.get(name);
}

app.get('/api/analytics', async (req, res) => {
  try {
    const context = await resolveLobbyContext(req);

    const summaryResult = await query(
      `SELECT
         COUNT(*)::int AS session_count,
         AVG(game_length_ms)::bigint AS average_game_length_ms,
         AVG(action_count)::numeric AS average_action_count,
         AVG(player_count)::numeric AS average_player_count
        FROM session_metrics
       WHERE lobby_id = $1`,
      [context.lobbyId]
    );
    const summaryRow = summaryResult.rows[0] || {};

    const winRateResult = await query(
      `SELECT
         winner,
         winner_faction,
         COUNT(*)::int AS count
        FROM session_metrics
       WHERE lobby_id = $1
         AND (COALESCE(winner, '') <> '' OR COALESCE(winner_faction, '') <> '')
       GROUP BY winner, winner_faction
       ORDER BY count DESC`,
      [context.lobbyId]
    );
    const totalWins = winRateResult.rows.reduce((acc, row) => acc + Number(row.count || 0), 0);
    const winRates = winRateResult.rows.map((row) => {
      const winnerLabel = row.winner || mapWinnerFactionToLabel(row.winner_faction);
      return {
        winner: winnerLabel || 'Unbekannt',
        faction: row.winner_faction || null,
        count: row.count,
        rate: totalWins > 0 ? Number(row.count) / totalWins : null,
      };
    });

    const metaResult = await query(
      `SELECT
         AVG((data->'metadata'->>'dayCount')::numeric) AS average_day_count,
         AVG((data->'metadata'->>'nightCount')::numeric) AS average_night_count
        FROM sessions
       WHERE lobby_id = $1 AND data ? 'metadata'`,
      [context.lobbyId]
    );
    const metaRow = metaResult.rows[0] || {};

    const sessionResult = await query(
      `SELECT timestamp, data
         FROM sessions
        WHERE lobby_id = $1
        ORDER BY timestamp DESC`,
      [context.lobbyId]
    );

    const playerAggregates = new Map();

    sessionResult.rows.forEach((row) => {
      const sessionData = row?.data || {};
      const players = Array.isArray(sessionData.players) ? sessionData.players : [];
      if (players.length === 0) {
        return;
      }

      const roles = Array.isArray(sessionData.rolesAssigned) ? sessionData.rolesAssigned : [];
      const deadPlayers = Array.isArray(sessionData.deadPlayers) ? sessionData.deadPlayers : [];
      const deadSet = new Set(deadPlayers
        .map((name) => normalizePlayerName(name))
        .filter(Boolean));
      const winningInfo = deriveWinningInfoFromSession(sessionData);
      const winnerSet = new Set(Array.isArray(winningInfo.winners) ? winningInfo.winners : []);
      const timestamp = Number(sessionData.timestamp);

      players.forEach((playerName, index) => {
        const normalizedName = normalizePlayerName(playerName);
        if (!normalizedName) {
          return;
        }
        const aggregate = ensurePlayerAggregate(playerAggregates, normalizedName);
        aggregate.games += 1;
        if (Number.isFinite(timestamp)) {
          aggregate.lastPlayedAt = Math.max(aggregate.lastPlayedAt || 0, timestamp);
        }

        const roleName = roles[index] || null;
        if (roleName) {
          aggregate.roles.set(roleName, (aggregate.roles.get(roleName) || 0) + 1);
        }

        if (winnerSet.has(normalizedName)) {
          aggregate.wins += 1;
        }

        if (deadSet.has(normalizedName)) {
          aggregate.deaths += 1;
        }
      });
    });

    const stats = Array.from(playerAggregates.values()).map((aggregate) => {
      const survivals = Math.max(0, aggregate.games - aggregate.deaths);
      const winRate = aggregate.games > 0 ? aggregate.wins / aggregate.games : null;
      const survivalRate = aggregate.games > 0 ? survivals / aggregate.games : null;
      const deathRate = aggregate.games > 0 ? aggregate.deaths / aggregate.games : null;
      const roleEntries = Array.from(aggregate.roles.entries())
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => {
          if (b.count === a.count) {
            return a.role.localeCompare(b.role, 'de');
          }
          return b.count - a.count;
        });

      return {
        name: aggregate.name,
        games: aggregate.games,
        wins: aggregate.wins,
        deaths: aggregate.deaths,
        survivals,
        winRate,
        survivalRate,
        deathRate,
        favoriteRole: roleEntries[0] || null,
        topRoles: roleEntries.slice(0, 5),
        lastPlayedAt: aggregate.lastPlayedAt || null,
      };
    });

    const compareByWin = (a, b) => {
      if (b.wins === a.wins) {
        const rateA = Number.isFinite(a.winRate) ? a.winRate : -1;
        const rateB = Number.isFinite(b.winRate) ? b.winRate : -1;
        if (rateB === rateA) {
          if (b.games === a.games) {
            return a.name.localeCompare(b.name, 'de');
          }
          return b.games - a.games;
        }
        return rateB - rateA;
      }
      return b.wins - a.wins;
    };

    const statsSorted = stats
      .slice()
      .sort(compareByWin);

    const topWinners = stats
      .filter((stat) => stat.wins > 0)
      .sort(compareByWin)
      .slice(0, 5)
      .map(({ name, wins, games, winRate }) => ({ name, wins, games, winRate }));

    const mostDeaths = stats
      .filter((stat) => stat.deaths > 0)
      .sort((a, b) => {
        if (b.deaths === a.deaths) {
          const rateA = Number.isFinite(a.deathRate) ? a.deathRate : -1;
          const rateB = Number.isFinite(b.deathRate) ? b.deathRate : -1;
          if (rateB === rateA) {
            if (b.games === a.games) {
              return a.name.localeCompare(b.name, 'de');
            }
            return b.games - a.games;
          }
          return rateB - rateA;
        }
        return b.deaths - a.deaths;
      })
      .slice(0, 5)
      .map(({ name, deaths, games, deathRate }) => ({ name, deaths, games, deathRate }));

    const bestSurvivors = stats
      .filter((stat) => stat.games >= 2)
      .sort((a, b) => {
        const rateA = Number.isFinite(a.survivalRate) ? a.survivalRate : -1;
        const rateB = Number.isFinite(b.survivalRate) ? b.survivalRate : -1;
        if (rateB === rateA) {
          if (b.survivals === a.survivals) {
            if (b.games === a.games) {
              return a.name.localeCompare(b.name, 'de');
            }
            return b.games - a.games;
          }
          return b.survivals - a.survivals;
        }
        return rateB - rateA;
      })
      .slice(0, 5)
      .map(({ name, survivals, games, survivalRate }) => ({ name, survivals, games, survivalRate }));

    res.json({
      summary: {
        sessionCount: Number(summaryRow.session_count || 0),
        averageGameLengthMs: summaryRow.average_game_length_ms !== null ? Number(summaryRow.average_game_length_ms) : null,
        averageActionCount: summaryRow.average_action_count !== null ? Number(summaryRow.average_action_count) : null,
        averagePlayerCount: summaryRow.average_player_count !== null ? Number(summaryRow.average_player_count) : null,
      },
      winRates,
      meta: {
        averageDayCount: metaRow.average_day_count !== null ? Number(metaRow.average_day_count) : null,
        averageNightCount: metaRow.average_night_count !== null ? Number(metaRow.average_night_count) : null,
      },
      players: {
        totalCount: stats.length,
        trackedSessions: sessionResult.rowCount,
        topWinners,
        mostDeaths,
        bestSurvivors,
        stats: statsSorted,
      },
    });
  } catch (error) {
    console.error('Analytics konnten nicht geladen werden:', error);
    res.status(500).json({ error: 'Analytics konnten nicht geladen werden.' });
  }
});

async function start() {
  await runMigrations();
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.log(`Werwolf Backend lauscht auf Port ${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Serverstart fehlgeschlagen:', error);
    process.exit(1);
  });
}

module.exports = app;
