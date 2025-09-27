// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

describe('Narrator dashboard integrations', () => {
  let testApi;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllTimers();
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);

    document.body.innerHTML = bodyMatch ? bodyMatch[1].replace(/<script[^>]*src="script\.js"[^>]*><\/script>/i, '') : '';
    document.head.innerHTML = headMatch ? headMatch[1] : '';

    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.matchMedia = window.matchMedia || jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));

    require('../script.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    testApi = window.__WERWOLF_TEST__;
    if (!testApi) {
      throw new Error('Test API not available');
    }

    localStorage.clear();

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

  test('saving a session surfaces the confirmation modal', () => {
    const modal = document.getElementById('confirmation-modal');
    expect(modal.style.display).not.toBe('flex');

    document.getElementById('save-game-btn').click();

    expect(window.alert).not.toHaveBeenCalled();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('confirm-btn').textContent).toBe('Okay');

    document.getElementById('confirm-btn').click();

    const latest = testApi.getActionLog()[0];
    expect(latest.label).toBe('Session gespeichert');
    expect(latest.type).toBe('info');
  });

  test('saving empty player names logs an error via modal', () => {
    const playersInput = document.getElementById('players');
    playersInput.value = '';

    document.getElementById('save-names-manually').click();

    const modal = document.getElementById('confirmation-modal');
    expect(window.alert).not.toHaveBeenCalled();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('confirmation-title').textContent).toBe('Speichern nicht möglich');

    document.getElementById('confirm-btn').click();

    const latest = testApi.getActionLog()[0];
    expect(latest.type).toBe('error');
    expect(latest.label).toBe('Speichern der Namen fehlgeschlagen');
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
    const storedConfigRaw = localStorage.getItem('werwolfJobConfig');
    expect(storedConfigRaw).not.toBeNull();
    const storedConfig = JSON.parse(storedConfigRaw);
    expect(storedConfig.bodyguardChance).toBeCloseTo(0.8, 5);

    testApi.setState({ jobConfig: { bodyguardChance: 0.25 } });
    expect(slider.value).toBe('25');
    expect(display.textContent).toBe('25%');
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
