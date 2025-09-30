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

