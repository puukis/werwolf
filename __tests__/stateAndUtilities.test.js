// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);

function bootstrap({ savedTheme, matchMediaDark = false } = {}) {
  jest.resetModules();
  jest.clearAllTimers();

  document.body.innerHTML = bodyMatch
    ? bodyMatch[1].replace(/<script[^>]*src="script\.js"[^>]*><\/script>/i, '')
    : '';
  document.head.innerHTML = headMatch ? headMatch[1] : '';

  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);

  localStorage.clear();
  if (typeof savedTheme === 'string') {
    localStorage.setItem('theme', savedTheme);
  }

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

  require('../script.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));

  const testApi = window.__WERWOLF_TEST__;
  if (!testApi) {
    throw new Error('Test API not available');
  }

  testApi.setState({ peaceDays: 0 });

  return {
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

  test('setState converts legacy Bodyguard roles into jobs and updates trackers', () => {
    const { testApi } = bootstrap();

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

  test('explicit bodyguardPlayers reassignment replaces the current holder', () => {
    const { testApi } = bootstrap();

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

  test('jobConfig updates clamp bodyguard chance and persist to storage', () => {
    const { testApi } = bootstrap();
    const slider = document.getElementById('bodyguard-job-chance');
    const display = document.getElementById('bodyguard-job-chance-display');

    testApi.setState({ jobConfig: { bodyguardChance: 1.5 } });
    let state = testApi.getState();
    expect(state.jobConfig.bodyguardChance).toBeCloseTo(1, 5);
    expect(slider.value).toBe('100');
    expect(display.textContent).toBe('100%');
    expect(JSON.parse(localStorage.getItem('werwolfJobConfig')).bodyguardChance).toBe(1);

    testApi.setState({ jobConfig: { bodyguardChance: -0.3 } });
    state = testApi.getState();
    expect(state.jobConfig.bodyguardChance).toBeCloseTo(0, 5);
    expect(slider.value).toBe('0');
    expect(display.textContent).toBe('0%');
    expect(JSON.parse(localStorage.getItem('werwolfJobConfig')).bodyguardChance).toBe(0);
  });

  test('reset-witch macro refreshes potions and records an action', () => {
    const { testApi } = bootstrap();

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

  test('reset-witch macro logs a no-op when both potions are available', () => {
    const { testApi } = bootstrap();

    const executed = testApi.runMacro('reset-witch');

    expect(executed).toBe(false);
    const logEntry = testApi.getActionLog()[0];
    expect(logEntry.label).toBe('Makro: Hexentränke auffrischen');
    expect(logEntry.detail).toContain('bereits über beide Tränke');
  });

  test('rewind-night macro revives current victims and clears pending list', () => {
    const { testApi } = bootstrap();

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

  test('running an unknown macro returns false without crashing', () => {
    const { testApi } = bootstrap();

    const beforeLog = testApi.getActionLog().slice();
    const executed = testApi.runMacro('does-not-exist');

    expect(executed).toBe(false);
    expect(testApi.getActionLog()).toEqual(beforeLog);
  });

  test('theme initialization respects stored preference and responds to changes without preference', () => {
    let env = bootstrap({ savedTheme: 'dark', matchMediaDark: false });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    env.triggerThemeChange(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    env = bootstrap({ matchMediaDark: false });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
    localStorage.removeItem('theme');
    env.triggerThemeChange(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});

