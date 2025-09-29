// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

const { createBackendMock } = require('../test-utils/backendMock');

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

  describe('Narrator dashboard integrations', () => {
    let testApi;
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
    delete window.__WERWOLF_TEST_BOOT__;
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

  test('saving a session surfaces the confirmation modal', async () => {
    const modal = document.getElementById('confirmation-modal');
    expect(modal.style.display).not.toBe('flex');

    document.getElementById('save-game-btn').click();
    await flushAsync();

    expect(window.alert).not.toHaveBeenCalled();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('confirm-btn').textContent).toBe('Okay');

    document.getElementById('confirm-btn').click();

    const latest = testApi.getActionLog()[0];
    expect(latest.label).toBe('Session gespeichert');
    expect(latest.type).toBe('info');
  });

  test('saving empty player names logs an error via modal', async () => {
    const playersInput = document.getElementById('players');
    playersInput.value = '';

    document.getElementById('save-names-manually').click();
    await flushAsync();

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
    const storedConfigRaw = backend.getStorage('werwolfJobConfig');
    expect(storedConfigRaw).not.toBeNull();
    const storedConfig = JSON.parse(storedConfigRaw);
    expect(storedConfig.bodyguardChance).toBeCloseTo(0.8, 5);

    testApi.setState({ jobConfig: { bodyguardChance: 0.25 } });
    expect(slider.value).toBe('25');
    expect(display.textContent).toBe('25%');
  });

  test('doctor job chance slider syncs UI, state, and storage', () => {
    const slider = document.getElementById('doctor-job-chance');
    const display = document.getElementById('doctor-job-chance-display');

    expect(slider).toBeTruthy();
    expect(display).toBeTruthy();
    expect(display.textContent).toBe('0%');

    slider.value = '45';
    dispatchEvent(slider, 'input');

    expect(display.textContent).toBe('45%');
    expect(testApi.getState().jobConfig.doctorChance).toBeCloseTo(0.45, 2);

    slider.value = '70';
    dispatchEvent(slider, 'change');

    const storedConfigRaw = backend.getStorage('werwolfJobConfig');
    expect(storedConfigRaw).not.toBeNull();
    const storedConfig = JSON.parse(storedConfigRaw);
    expect(storedConfig.doctorChance).toBeCloseTo(0.7, 5);

    testApi.setState({ jobConfig: { doctorChance: 0.2 } });
    expect(slider.value).toBe('20');
    expect(display.textContent).toBe('20%');
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

  test('test api exposes ambience snapshot and manual setter', () => {
    const state = testApi.getState();
    expect(state.ambience).toEqual(expect.objectContaining({
      activePlaylist: null,
      manualPlaylist: null,
      activeLighting: null,
      manualLighting: null
    }));

    testApi.setManualAmbience({ playlist: 'nightwatch', lighting: 'witch' });
    let snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBe('nightwatch');
    expect(snapshot.manualLighting).toBe('witch');
    expect(snapshot.playlistSource).toBe('manual');
    expect(snapshot.lightingSource).toBe('manual');

    testApi.setManualAmbience({ playlist: null, lighting: null });
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBeNull();
    expect(snapshot.manualLighting).toBeNull();
  });

  test('admin ambience controls toggle manual state', async () => {
    testApi.setManualAmbience({ playlist: null, lighting: null });
    const playlistButtons = Array.from(document.querySelectorAll('#ambience-playlists .ambience-toggle'));
    expect(playlistButtons.length).toBeGreaterThan(1);

    const playlistToggle = playlistButtons.find(btn => btn.dataset.id);
    expect(playlistToggle).toBeDefined();
    playlistToggle.click();
    await flushAsync();

    let snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBe(playlistToggle.dataset.id);
    expect(playlistToggle.getAttribute('aria-pressed')).toBe('true');

    const stopBtn = playlistButtons.find(btn => btn.textContent.includes('Stop'));
    expect(stopBtn).toBeDefined();
    stopBtn.click();

    await flushAsync();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activePlaylist).toBeNull();
    expect(snapshot.playlistSource).toBe('manual');
    expect(stopBtn.getAttribute('aria-pressed')).toBe('true');
    expect(playlistToggle.getAttribute('aria-pressed')).toBe('false');

    stopBtn.click();
    await flushAsync();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualPlaylist).toBeNull();
    expect(stopBtn.getAttribute('aria-pressed')).toBe('false');

    const lightingButtons = Array.from(document.querySelectorAll('#ambience-lighting .ambience-toggle'));
    expect(lightingButtons.length).toBeGreaterThan(1);

    const lightingToggle = lightingButtons.find(btn => btn.dataset.id && btn.dataset.id !== '');
    expect(lightingToggle).toBeDefined();
    lightingToggle.click();

    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBe(lightingToggle.dataset.id);
    expect(lightingToggle.getAttribute('aria-pressed')).toBe('true');

    const neutralBtn = lightingButtons.find(btn => btn.textContent.includes('Neutral'));
    expect(neutralBtn).toBeDefined();
    neutralBtn.click();

    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBe(neutralBtn.dataset.id);
    expect(snapshot.activeLighting).toBeNull();
    expect(snapshot.lightingSource).toBe('manual');
    expect(neutralBtn.getAttribute('aria-pressed')).toBe('true');
    expect(lightingToggle.getAttribute('aria-pressed')).toBe('false');

    neutralBtn.click();
    snapshot = testApi.getAmbienceState();
    expect(snapshot.manualLighting).toBeNull();
    expect(neutralBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('night step ambience temporarily overrides blood moon event', () => {
    testApi.setManualAmbience({ playlist: null, lighting: null });
    testApi.triggerAmbienceEvent('blood-moon', true);

    let snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('blood-moon');
    expect(snapshot.lightingSource).toBe('event');

    testApi.previewNightStep('Seer');
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('seer');
    expect(snapshot.lightingSource).toBe('step');

    testApi.previewNightStep(null);
    snapshot = testApi.getAmbienceState();
    expect(snapshot.activeLighting).toBe('blood-moon');
    expect(snapshot.lightingSource).toBe('event');

    testApi.triggerAmbienceEvent('blood-moon', false);
    snapshot = testApi.getAmbienceState();
    expect(snapshot.lightingSource === 'event').toBe(false);
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
