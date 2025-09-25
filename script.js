/* Rollen Geber – Client-side JS */

// Theme handling
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Initialize theme from localStorage or system preference
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme) {
    setTheme(savedTheme);
  } else if (prefersDark) {
    setTheme('dark');
  } else {
    setTheme('light');
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("players").value = "";
  // Initialize theme
  initTheme();

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
    saveGameBtn.addEventListener('click', () => {
      saveSession();
      const detail = players.length
        ? `${players.length} Spielende gespeichert.`
        : 'Leerer Spielstand gespeichert.';
      showInfoMessage({
        title: 'Spiel gespeichert',
        text: 'Der aktuelle Spielstand wurde gesichert.',
        confirmText: 'Okay',
        log: { type: 'info', label: 'Session gespeichert', detail }
      });
    });
  }
  
  // Theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
    });
  }
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('theme')) { // Only if user hasn't set a preference
      setTheme(e.matches ? 'dark' : 'light');
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
  const revealDeadRolesCheckbox = document.getElementById('reveal-dead-roles');
  const bloodMoonChanceInput = document.getElementById('blood-moon-chance');
  const bloodMoonChanceDisplay = document.getElementById('blood-moon-chance-display');
  const phoenixPulseChanceInput = document.getElementById('phoenix-pulse-chance');
  const phoenixPulseChanceDisplay = document.getElementById('phoenix-pulse-chance-display');
  const bodyguardJobChanceInput = document.getElementById('bodyguard-job-chance');
  const bodyguardJobChanceDisplay = document.getElementById('bodyguard-job-chance-display');
  const JOB_CONFIG_STORAGE_KEY = 'werwolfJobConfig';
  const BLOOD_MOON_CONFIG_STORAGE_KEY = 'werwolfBloodMoonConfig';
  const DEFAULT_PHOENIX_PULSE_CHANCE = 0.05;
  const PHOENIX_PULSE_CONFIG_STORAGE_KEY = 'werwolfPhoenixPulseConfig';
  const defaultJobConfig = { bodyguardChance: 0 };
  const defaultBloodMoonConfig = { baseChance: 0.2 };
  const defaultPhoenixPulseConfig = { chance: DEFAULT_PHOENIX_PULSE_CHANCE };
  let jobConfig = loadJobConfig();
  let bloodMoonConfig = loadBloodMoonConfig();
  let phoenixPulseConfig = loadPhoenixPulseConfig();

  function loadJobConfig() {
    try {
      const raw = localStorage.getItem(JOB_CONFIG_STORAGE_KEY);
      if (!raw) {
        return { ...defaultJobConfig };
      }
      const parsed = JSON.parse(raw);
      const rawChance = typeof parsed.bodyguardChance === 'number'
        ? parsed.bodyguardChance
        : defaultJobConfig.bodyguardChance;
      const normalized = Number.isFinite(rawChance)
        ? Math.min(Math.max(rawChance, 0), 1)
        : defaultJobConfig.bodyguardChance;
      return { bodyguardChance: normalized };
    } catch (error) {
      return { ...defaultJobConfig };
    }
  }

  function saveJobConfig() {
    try {
      const payload = {
        bodyguardChance: Math.min(Math.max(jobConfig.bodyguardChance || 0, 0), 1)
      };
      localStorage.setItem(JOB_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadBloodMoonConfig() {
    try {
      const raw = localStorage.getItem(BLOOD_MOON_CONFIG_STORAGE_KEY);
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
      localStorage.setItem(BLOOD_MOON_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadPhoenixPulseConfig() {
    try {
      const raw = localStorage.getItem(PHOENIX_PULSE_CONFIG_STORAGE_KEY);
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
      localStorage.setItem(PHOENIX_PULSE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
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

  updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: false });

  if (bodyguardJobChanceInput) {
    bodyguardJobChanceInput.addEventListener('input', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: false });
    });
    bodyguardJobChanceInput.addEventListener('change', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: true });
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
  loadSessions();

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

  // Load events enabled state
  const savedEventsEnabled = localStorage.getItem('eventsEnabled');
  if (savedEventsEnabled !== null) {
    eventsEnabledCheckbox.checked = savedEventsEnabled === 'true';
  }

  // Save events enabled state
  eventsEnabledCheckbox.addEventListener('change', () => {
    localStorage.setItem('eventsEnabled', eventsEnabledCheckbox.checked);
  });

  // Load reveal dead roles state
  const savedRevealDeadRoles = localStorage.getItem('revealDeadRoles');
  if (savedRevealDeadRoles !== null) {
    revealDeadRolesCheckbox.checked = savedRevealDeadRoles === 'true';
  }

  // Save reveal dead roles state
  revealDeadRolesCheckbox.addEventListener('change', () => {
    localStorage.setItem('revealDeadRoles', revealDeadRolesCheckbox.checked);
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

  function formatRoleWithJobs(role, jobs) {
    if (!role) {
      return Array.isArray(jobs) && jobs.length ? jobs.join(' & ') : '';
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return role;
    }
    return `${role} & ${jobs.join(' & ')}`;
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

  function updateBodyguardPlayers() {
    ensureJobsStructure();
    bodyguardPlayers = players.filter((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Bodyguard');
    });
  }


  let players = [];
  let rolesAssigned = [];
  let jobsAssigned = [];
  let currentIndex = 0;
  let revealed = false;

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
      }
    });

    plusBtn.addEventListener("click", () => {
      let current = parseInt(qtyDisplay.textContent, 10);
      qtyDisplay.textContent = current + 1;
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
    Bodyguard: "Wählt jede Nacht eine Person und schützt sie vor Angriffen der Werwölfe."
  };

  const bodyguardEligibleRoles = new Set([
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

  /* -------------------- Erste Nacht Logik -------------------- */
  const nightSequence = ["Bodyguard", "Henker", "Geschwister", "Amor", "Seer", "Inquisitor", "Werwolf", "Hexe", "Stumme Jule"];
  const nightTexts = {
    Bodyguard: "Der Bodyguard wacht auf. Bitte wähle eine Person zum Beschützen.",
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
        if (!deadPlayers.includes(lynched)) {
          deadPlayers.push(lynched);
          peaceDays = 0;
          handlePlayerDeath(lynched);
        }
        updatePlayerCardVisuals();
        const messageParts = [`<p>${lynched} wurde mit ${maxVotes} Stimmen gehängt.</p>`];
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
      if (role === 'Dorfbewohner') {
        roleNameEl.classList.add('long-text');
      }
      roleNameEl.textContent = role;
      back.innerHTML = `<span class="player-name">${victimName}</span>`;
      back.prepend(roleNameEl);
      
      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation();
        showRoleInfo(role);
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
      bloodMoonActive = false; // Reset blood moon event
      document.body.classList.remove('blood-moon-active');
      nightMode = false;
      nightOverlay.style.display = "none";
      assignBtn.style.display = "inline-block";
      startNightBtn.style.display = "none";
      console.log("Tote Spieler:", deadPlayers);
      console.log("Liebespaare:", lovers);

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
      const victimNames = Array.from(selected).map(btn => btn.textContent).join(' und ');
      showConfirmation("Opfer auswählen?", `Willst du ${victimNames} wirklich fressen?`, () => {
        selected.forEach(victimBtn => {
          const victim = victimBtn.textContent;

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
  });
  
  // Day phase event listeners
  // We'll handle click events through direct onclick assignments
  // to prevent multiple event listeners from stacking up

  function updateBloodMoonOdds() {
    const rawTimer = parseInt(localStorage.getItem('bloodMoonPityTimer') || '0', 10);
    const pityTimer = Number.isFinite(rawTimer) ? Math.max(rawTimer, 0) : 0;
    const bloodMoonChance = getBloodMoonChance(pityTimer);
    const oddsEl = document.getElementById('blood-moon-odds');
    if (oddsEl) {
      oddsEl.textContent = `Blutmond-Chance diese Nacht: ${Math.round(bloodMoonChance * 100)}%`;
    }
  }

  function triggerRandomEvents() {
    phoenixPulsePending = false;
    phoenixPulseJustResolved = false;
    phoenixPulseRevivedPlayers = [];
    setPhoenixPulseCharged(false);
    updatePhoenixPulseStatus();

    // If blood moon was manually triggered by admin, keep it active and skip random check.
    if (bloodMoonActive === true) {
        // Reset pity timer as the blood moon is happening
        localStorage.setItem('bloodMoonPityTimer', 0);
        updateBloodMoonOdds();
        renderNarratorDashboard();
        return;
    }

    // Reset all events
    bloodMoonActive = false;

    if (!eventsEnabledCheckbox.checked) {
      renderNarratorDashboard();
      return;
    }

    let bloodMoonPityTimer = parseInt(localStorage.getItem('bloodMoonPityTimer') || '0', 10);
    if (!Number.isFinite(bloodMoonPityTimer) || bloodMoonPityTimer < 0) {
      bloodMoonPityTimer = 0;
    }
    const bloodMoonChance = getBloodMoonChance(bloodMoonPityTimer);

    if (Math.random() < bloodMoonChance) {
      bloodMoonActive = true;
      bloodMoonPityTimer = 0;
    } else {
      bloodMoonPityTimer++;
    }
    localStorage.setItem('bloodMoonPityTimer', bloodMoonPityTimer);
    updateBloodMoonOdds();

    if (Math.random() < getPhoenixPulseChance()) {
      phoenixPulsePending = true;
      setPhoenixPulseCharged(true);
      updatePhoenixPulseStatus();
      if (resultOutput) {
        resultOutput.innerHTML += '<br><strong>🔥 Phoenix Pulse:</strong> Eine uralte Energie sammelt sich in dieser Nacht.';
      }
      logAction({
        type: 'event',
        label: 'Phoenix Pulse geladen',
        detail: 'Event aktiviert – Nachtopfer werden bei Tagesanbruch wiederbelebt.'
      });
    }
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
    
    const livingRoleSet = new Set(livingPlayerRoles);
    const bodyguardActive = hasActiveBodyguard();

    // Filter night sequence based on available living roles
    nightSteps = nightSequence.filter((r) => {
      if (r === "Bodyguard") {
        return bodyguardActive;
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

  function applyRoleSuggestion(count) {
    const suggestion = roleSuggestions[count] || {};
    rolesContainerVillage.innerHTML = "";
    rolesContainerWerwolf.innerHTML = "";
    rolesContainerSpecial.innerHTML = "";

    categorizedRoles.village.forEach(role => {
        addRoleRow(role, suggestion[role] || 0, rolesContainerVillage);
    });
    categorizedRoles.werwolf.forEach(role => {
        addRoleRow(role, suggestion[role] || 0, rolesContainerWerwolf);
    });
    categorizedRoles.special.forEach(role => {
        addRoleRow(role, suggestion[role] || 0, rolesContainerSpecial);
    });
  }

  playersTextarea.addEventListener("input", () => {
    if (isLoadingLastUsed) return;
    const count = playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length;
    applyRoleSuggestion(count);
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

  // Save names to localStorage
  saveNamesBtn.addEventListener("click", () => {
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
    localStorage.setItem("werwolfSavedNames", JSON.stringify(names));
    showInfoMessage({
      title: 'Namen gespeichert',
      text: 'Alle Spielernamen wurden lokal gesichert.',
      confirmText: 'Okay',
      log: { type: 'info', label: 'Namen gespeichert', detail: `${names.length} Namen abgelegt.` }
    });
  });

  // Load names from localStorage
  loadNamesBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfSavedNames");
    if (!data) {
      showInfoMessage({
        title: 'Keine gespeicherten Namen',
        text: 'Es wurden noch keine Namen gesichert.',
        confirmText: 'Okay',
        log: { type: 'info', label: 'Keine gespeicherten Namen', detail: 'Lokaler Speicher ohne Einträge.' }
      });
      return;
    }
    try {
      const names = JSON.parse(data);
      playersTextarea.value = names.join("\n");
      playersTextarea.dispatchEvent(new Event("input"));
    } catch (e) {
      showInfoMessage({
        title: 'Laden fehlgeschlagen',
        text: 'Fehler beim Laden der Namen.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Fehler beim Laden der Namen', detail: e.message || 'Unbekannter Fehler.' }
      });
    }
  });

  // Save roles to localStorage
  saveRolesBtn.addEventListener("click", () => {
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
    localStorage.setItem("werwolfSavedRoles", JSON.stringify(roleSetup));
    showInfoMessage({
      title: 'Rollen gespeichert',
      text: 'Die aktuelle Rollenverteilung wurde gesichert.',
      confirmText: 'Okay',
      log: { type: 'info', label: 'Rollen gespeichert', detail: `${roleSetup.length} Rolleneinträge gespeichert.` }
    });
  });

  // Load roles from localStorage
  loadRolesBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfSavedRoles");
    if (!data) {
      showInfoMessage({
        title: 'Keine gespeicherten Rollen',
        text: 'Es wurden noch keine Rollen gesichert.',
        confirmText: 'Okay',
        log: { type: 'info', label: 'Keine gespeicherten Rollen', detail: 'Lokaler Speicher ohne Rollendaten.' }
      });
      return;
    }
    try {
      const savedRoles = JSON.parse(data);
      
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

    } catch (e) {
      showInfoMessage({
        title: 'Laden fehlgeschlagen',
        text: 'Fehler beim Laden der Rollen.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Fehler beim Laden der Rollen', detail: e.message || 'Unbekannter Fehler.' }
      });
    }
  });

  loadLastUsedBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfLastUsed");
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

    } catch (e) {
      showInfoMessage({
        title: 'Laden fehlgeschlagen',
        text: 'Fehler beim Laden der zuletzt benutzten Optionen.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Fehler beim Laden der zuletzt benutzten Optionen', detail: e.message || 'Unbekannter Fehler.' }
      });
    } finally {
      isLoadingLastUsed = false;
    }
  });


  addRoleBtn.addEventListener("click", () => addRoleRow("", 1, rolesContainerSpecial));

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
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance }
    };
    localStorage.setItem('werwolfLastUsed', JSON.stringify(lastUsedOptions));

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
        initializeMichaelJacksonAccusations();

        assignBodyguardJobByChance();

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
          if (role === 'Dorfbewohner') {
            roleNameEl.classList.add('long-text');
          }
          roleNameEl.textContent = formatRoleWithJobs(role, jobs);
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
    const jobList = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const titleText = jobList.length
      ? `${normalizedRole} (${jobList.join(' + ')})`
      : normalizedRole;

    title.textContent = titleText;

    const baseDescription = roleDescriptions[normalizedRole] || roleDescriptions[role] || "Keine Beschreibung für diese Rolle verfügbar.";
    const jobTextSnippets = jobList
      .map(job => jobDescriptions[job])
      .filter(Boolean);

    if (jobTextSnippets.length > 0) {
      const jobHtml = jobTextSnippets
        .map(text => `<span class="job-description">${text}</span>`)
        .join('<br>');
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
  });

  // Session Management
  function saveSession() {
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
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance }
    };

    let sessions = JSON.parse(localStorage.getItem('werwolfSessions')) || [];
    sessions.unshift(session); // Add to the beginning
    if (sessions.length > 20) {
      sessions = sessions.slice(0, 20); // Limit to 20 sessions
    }

    localStorage.setItem('werwolfSessions', JSON.stringify(sessions));
    loadSessions();
  }

  function loadSessions() {
    const sessions = JSON.parse(localStorage.getItem('werwolfSessions')) || [];
    sessionsList.innerHTML = '';

    if (sessions.length === 0) {
      sessionsList.innerHTML = '<li>Keine gespeicherten Sessions.</li>';
      return;
    }

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
        const timestamp = e.target.dataset.timestamp;
        deleteSession(timestamp);
      });
    });
  }

  function deleteSession(timestamp) {
    let sessions = JSON.parse(localStorage.getItem('werwolfSessions')) || [];
    sessions = sessions.filter(s => s.timestamp != timestamp);
    localStorage.setItem('werwolfSessions', JSON.stringify(sessions));
    loadSessions();
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

    if (session.jobConfig && typeof session.jobConfig.bodyguardChance === 'number') {
      jobConfig.bodyguardChance = Math.min(Math.max(session.jobConfig.bodyguardChance, 0), 1);
      updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
    }
    deadPlayers = session.deadPlayers || [];
    lovers = session.lovers || [];
    silencedPlayer = session.silencedPlayer || null;
    healRemaining = session.healRemaining !== undefined ? session.healRemaining : 1;
    poisonRemaining = session.poisonRemaining !== undefined ? session.poisonRemaining : 1;
    bloodMoonActive = session.bloodMoonActive || false;
    phoenixPulsePending = !!session.phoenixPulsePending;
    phoenixPulseJustResolved = !!session.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(session.phoenixPulseRevivedPlayers)
      ? session.phoenixPulseRevivedPlayers.slice()
      : [];
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
      if (role === 'Dorfbewohner') {
        roleNameEl.classList.add('long-text');
      }
      roleNameEl.textContent = formatRoleWithJobs(role, jobs);
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
  const rollbackCheckpointBtn = document.getElementById('admin-rollback-checkpoint-btn');

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
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance }
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

  function applyStateSnapshot(snapshot) {
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
    deadPlayers = snapshot.deadPlayers.slice();
    lovers = snapshot.lovers.map(pair => pair.slice());
    silencedPlayer = snapshot.silencedPlayer;
    healRemaining = snapshot.healRemaining;
    poisonRemaining = snapshot.poisonRemaining;
    bloodMoonActive = snapshot.bloodMoonActive;
    phoenixPulsePending = !!snapshot.phoenixPulsePending;
    phoenixPulseJustResolved = !!snapshot.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(snapshot.phoenixPulseRevivedPlayers)
      ? snapshot.phoenixPulseRevivedPlayers.slice()
      : [];
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
          const displayName = formatRoleWithJobs(roleName, Array.isArray(jobs) ? jobs : []);
          roleNameEl.textContent = displayName || '';
          if (roleName === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
            roleNameEl.classList.add('long-text');
          } else {
            roleNameEl.classList.remove('long-text');
          }
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
    const roleOptionValues = [...allRoles, 'Bodyguard'];
    roleOptionValues.forEach(r => {
      const option = document.createElement('option');
      option.value = r;
      option.textContent = r === 'Bodyguard' ? 'Bodyguard (Job)' : r;
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

        const appliedRole = newRole === 'Bodyguard' ? 'Dorfbewohner' : newRole;
        const hasBodyguardJob = previousJobs.includes('Bodyguard');
        const wantsBodyguard = newRole === 'Bodyguard';

        if (appliedRole === previousRole && hasBodyguardJob === wantsBodyguard) {
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
            if (previousJobs.includes('Bodyguard')) {
              assignBodyguardJobToIndex(playerIndex);
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

      bloodMoonActive = true;
      syncBloodMoonUI({ silent: true });
      showConfirmation('Blutmond aktiviert', 'Der Blutmond wurde für die nächste Nacht manuell aktiviert.', () => {}, 'Okay', false);

      recordAction({
        type: 'admin',
        label: 'Blutmond manuell aktiviert',
        detail: 'Gilt für die kommende Nacht.',
        undo: () => {
          bloodMoonActive = wasActive;
          syncBloodMoonUI({ silent: true });
        },
        redo: () => {
          bloodMoonActive = true;
          syncBloodMoonUI({ silent: true });
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
          jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
          jobConfig: { bodyguardChance: jobConfig.bodyguardChance }
        };
      },
      setState(partial = {}) {
        let recalcBodyguards = false;
        let phoenixStateChanged = false;
        if (Array.isArray(partial.players)) {
          players = partial.players.slice();
          recalcBodyguards = true;
        }
        if (Array.isArray(partial.rolesAssigned)) {
          rolesAssigned = partial.rolesAssigned.slice();
          recalcBodyguards = true;
        }
        if (Array.isArray(partial.jobsAssigned)) {
          jobsAssigned = partial.jobsAssigned.map(entry => Array.isArray(entry) ? entry.slice() : []);
          recalcBodyguards = true;
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
          bloodMoonActive = partial.bloodMoonActive;
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

        if (phoenixStateChanged) {
          setPhoenixPulseCharged(phoenixPulsePending);
          updatePhoenixPulseStatus();
        }

        if (recalcBodyguards || Array.isArray(partial.jobsAssigned) || Array.isArray(partial.bodyguardPlayers)) {
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
          updateBodyguardPlayers();
          recalcBodyguards = false;
        } else if (recalcBodyguards) {
          ensureJobsStructure();
          updateBodyguardPlayers();
          recalcBodyguards = false;
        }
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
      phaseTimerManager
    };
  }

  updatePhoenixPulseStatus();
  renderNarratorDashboard();

});
