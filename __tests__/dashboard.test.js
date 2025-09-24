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
});
