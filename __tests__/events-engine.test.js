// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

const { createBackendMock } = require('../test-utils/backendMock');

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
