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
  updateBloodMoonOdds();

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
      alert('Spiel gespeichert!');
    });
  }

  // Load existing sessions on startup
  loadSessions();
  
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

  // Confirmation Modal Elements
  const confirmationModal = document.getElementById('confirmation-modal');
  const confirmationTitle = document.getElementById('confirmation-title');
  const confirmationText = document.getElementById('confirmation-text');
  const confirmBtn = document.getElementById('confirm-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  let onConfirmCallback = null;

  // Show confirmation modal
  function showConfirmation(title, text, onConfirm, confirmText = 'Bestätigen', showCancel = true, modalClass = '') {
    confirmationTitle.textContent = title;
    confirmationText.textContent = text;
    onConfirmCallback = onConfirm;
    confirmBtn.textContent = confirmText;
    cancelBtn.parentElement.style.display = showCancel ? 'block' : 'none';

    confirmationModal.className = 'modal';
    if(modalClass) {
        confirmationModal.classList.add(modalClass);
    }

    confirmationModal.style.display = 'flex';
  }

  // Hide confirmation modal
  function hideConfirmation() {
    confirmationModal.style.display = 'none';
    onConfirmCallback = null;
    confirmBtn.textContent = 'Bestätigen';
    cancelBtn.parentElement.style.display = 'block';
    confirmationModal.className = 'modal';
  }

  // Add event listeners for confirmation modal
  confirmBtn.addEventListener('click', () => {
    if (onConfirmCallback) {
      onConfirmCallback();
    }
    hideConfirmation();
  });

  cancelBtn.addEventListener('click', hideConfirmation);

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
            alert('Bitte einen Spieler zum Mitnehmen auswählen.');
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
                            alert(`${partner} ist aus Liebeskummer gestorben!`);
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
        const previousDays = Array.isArray(previousEntry?.daysAccused)
          ? previousEntry.daysAccused
          : Array.isArray(previousEntry)
            ? previousEntry
            : [];

        const uniqueDays = Array.from(new Set(previousDays.filter(day => typeof day === 'number')));
        const previousSpotlight = typeof previousEntry?.hasSpotlight === 'boolean'
          ? previousEntry.hasSpotlight
          : typeof previousEntry?.spotlightActive === 'boolean'
            ? previousEntry.spotlightActive
            : false;

        synced[player] = {
          daysAccused: uniqueDays,
          hasSpotlight: previousSpotlight || uniqueDays.length > 0
        };
      }
    });

    michaelJacksonAccusations = synced;
  }


  let players = [];
  let rolesAssigned = [];
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
    "Michael Jackson": "Dorfbewohner-Sonderrolle: Stirbt sofort, wenn er an zwei unterschiedlichen Tagen beschuldigt wird."
  };

  /* -------------------- Erste Nacht Logik -------------------- */
  const nightSequence = ["Henker", "Geschwister", "Amor", "Seer", "Inquisitor", "Werwolf", "Hexe", "Stumme Jule"];
  const nightTexts = {
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
  
  // DOM elements for day phase
  const dayOverlay = document.getElementById('day-overlay');
  const dayText = document.getElementById('day-text');
  const dayChoices = document.getElementById('day-choices');
  let dayLynchBtn = document.getElementById('day-lynch-btn');
  let daySkipBtn = document.getElementById('day-skip-btn');

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
                setTimeout(() => alert(`Eine Nachricht vom Geist von ${playerName}:\n\n${message}`), 1000);
                geist.messageSent = true;
            }
            geistModal.style.display = 'none';
        };
    }
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

  function renderDayChoices() {
    dayChoices.innerHTML = '';
    const livingPlayers = players.filter(p => !deadPlayers.includes(p));

    livingPlayers.forEach(player => {
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
  
  function calculateVoteResults() {
    const inputs = dayChoices.querySelectorAll('.vote-input');
    const voteCount = {};

    inputs.forEach(input => {
      const player = input.dataset.player;
      const count = parseInt(input.value, 10) || 0;
      const michaelEntry = michaelJacksonAccusations[player];
      const finalCount = michaelEntry?.hasSpotlight ? count * 2 : count;
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
    if (playerIndex === -1) {
      return false;
    }

    if (rolesAssigned[playerIndex] !== "Michael Jackson") {
      return false;
    }

    let entry = michaelJacksonAccusations[playerName];
    if (!entry || Array.isArray(entry)) {
      const daysAccused = Array.isArray(entry) ? entry.slice() : [];
      entry = { daysAccused, hasSpotlight: daysAccused.length > 0 };
      michaelJacksonAccusations[playerName] = entry;
    } else {
      entry.daysAccused = Array.isArray(entry.daysAccused) ? entry.daysAccused : [];
      if (typeof entry.hasSpotlight !== 'boolean') {
        entry.hasSpotlight = entry.daysAccused.length > 0;
      }
    }

    const isNewDayAccusation = !entry.daysAccused.includes(dayCount);

    if (isNewDayAccusation) {
      entry.daysAccused.push(dayCount);

      if (!entry.hasSpotlight) {
        entry.hasSpotlight = true;

        const announcement = `<p><strong>${playerName}</strong> steht nun im Rampenlicht! Seine Stimme zählt ab jetzt doppelt.</p>`;
        const existingMessage = dayText.innerHTML || '';
        dayText.innerHTML = existingMessage ? `${existingMessage}${announcement}` : announcement;

        renderDayChoices();
      }
    }

    return entry.daysAccused.length >= 2;
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

    let message = newlyEliminated
      .map(name => `${name} wurde zum zweiten Mal beschuldigt und stirbt als Michael Jackson sofort.`)
      .join('\n\n');

    loverChainDeaths.forEach(({ partner, source }) => {
      message += `\n\n${partner} stirbt, weil sie/er mit ${source} verliebt war.`;
    });

    dayText.textContent = message;
    dayChoices.innerHTML = '';
    dayLynchBtn.style.display = 'none';
    daySkipBtn.textContent = 'Weiter';
    daySkipBtn.onclick = () => {
      if (checkGameOver()) return;
      if (!checkGameOver(true)) {
        setTimeout(() => endDayPhase(), 3000);
      }
    };

    return true;
  }

  function processMichaelJacksonAccusations(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return false;
    }

    const playersToEliminate = candidates.filter(player => registerMichaelJacksonAccusation(player));

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
            dayText.textContent = `${suendenbockPlayer} wurde als Sündenbock geopfert.`;
            
            const continueAfterLynch = () => {
                lovers.forEach(pair => {
                  if (pair.includes(suendenbockPlayer)) {
                    const partner = pair[0] === suendenbockPlayer ? pair[1] : pair[0];
                    if (!deadPlayers.includes(partner)) {
                      deadPlayers.push(partner);
                      dayText.textContent += `\n\n${partner} stirbt, weil sie/er mit ${suendenbockPlayer} verliebt war.`;
                      handlePlayerDeath(partner);
                    }
                  }
                });

                dayChoices.innerHTML = '';
                dayLynchBtn.style.display = 'none';
                daySkipBtn.textContent = 'Weiter';
                daySkipBtn.onclick = () => {
                  if (checkGameOver()) return;
                  if (!checkGameOver(true)) {
                    setTimeout(() => endDayPhase(), 3000);
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
        dayText.textContent = `${lynched} wurde mit ${maxVotes} Stimmen gehängt.`;
        
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
                  dayText.textContent += `\n\n${partner} stirbt, weil sie/er mit ${lynched} verliebt war.`;
                  handlePlayerDeath(partner);
                }
              }
            });
            
            dayChoices.innerHTML = '';
            dayLynchBtn.style.display = 'none';
            daySkipBtn.textContent = 'Weiter';
            daySkipBtn.onclick = () => {
              if (checkGameOver()) return;
              if (!checkGameOver(true)) {
                setTimeout(() => endDayPhase(), 3000);
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
      dayText.textContent = 'Kein Spieler wurde mit ausreichend Stimmen verurteilt.';
      peaceDays++;
      dayChoices.innerHTML = '';
      dayLynchBtn.style.display = 'none';
      daySkipBtn.textContent = 'Weiter';
      daySkipBtn.onclick = () => {
        if (!checkGameOver(true)) {
          setTimeout(() => endDayPhase(), 3000);
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
        alert('Bitte wählt einen Bürgermeister.');
        return;
      }
      const newMayor = selected.textContent;
      showConfirmation("Bürgermeister wählen?", `Willst du ${newMayor} wirklich zum Bürgermeister wählen?`, () => {
        mayor = newMayor;
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
    
    let nightReport = '';
    if (!revealDeadRolesCheckbox.checked) {
        nightReport = currentNightVictims.length > 0
            ? `<p>In der Nacht wurden folgende Spieler getötet: <strong>${currentNightVictims.join(', ')}</strong>.</p>`
            : '<p>Es gab keine Todesfälle in der Nacht.</p>';
    }

    let silencedMessage = '';
    if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
      silencedMessage = `<p>🤫 ${silencedPlayer} wurde zum Schweigen gebracht und darf nicht reden oder abstimmen.</p>`;
    } else {
      silencedPlayer = null;
    }

    dayText.innerHTML = `
      ${nightReport}
      ${silencedMessage}
      <p>Diskutiert und stimmt ab, wer heute gehängt werden soll.</p>
      ${mayor ? `<div class="mayor-indicator">Bürgermeister: ${mayor}</div>` : ''}
    `;
    
    dayLynchBtn.textContent = 'Hängen';
    dayLynchBtn.style.display = 'block';
    daySkipBtn.textContent = 'Überspringen';
    daySkipBtn.style.display = 'block';
    
    dayLynchBtn.onclick = executeLynching;
    daySkipBtn.onclick = () => {
      dayText.textContent = 'Die Dorfbewohner konnten sich nicht einigen. Niemand wurde gehängt.';
      peaceDays++;
      dayChoices.innerHTML = '';
      dayLynchBtn.style.display = 'none';
      daySkipBtn.textContent = 'Weiter';
      daySkipBtn.onclick = endDayPhase;
    };
    
    renderDayChoices();
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

  function startDayPhase() {
    dayMode = true;
    dayCount++;
    
    if (currentNightVictims.length === 0) {
        peaceDays++;
    } else {
        peaceDays = 0;
    }

    if (checkGameOver()) return;

    document.querySelector('.container').classList.add('hidden');
    
    showGraveyardModal();
  }
  
  function endDayPhase() {
    dayMode = false;
    dayOverlay.classList.remove('show');
    document.querySelector('.container').classList.remove('hidden');
    
    // Reset for next night
    currentNightVictims = [];
    
    // Start the next night phase after a short delay
    setTimeout(() => {
      startNightBtn.click();
    }, 1000);
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
      
      // Start the day phase
      setTimeout(() => {
        startDayPhase();
      }, 1000);
    }
  }

  function advanceNight() {
    const role = nightSteps[nightIndex];
    
    // No skipping of roles during the night phase
    // All roles get their turn in the night they were killed
    // Only check for dead players at the start of the night phase
    
    // Handle selections before moving on
    if (role === "Hexe") {
      if (!selectedWitchAction) {
        // Witch skipped actions, so just proceed
        moveToNextNightStep();
        return;
      } else if (selectedWitchAction === "heal") {
        const victim = nightChoices.querySelector(".player-btn.selected");
        if (!victim) {
          alert("Bitte ein Opfer zum Heilen auswählen.");
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
          alert("Bitte ein Ziel zum Töten auswählen.");
          return;
        }
        const name = target.textContent;
        showConfirmation("Gifttrank einsetzen?", `Willst du ${name} wirklich vergiften? Dieser Trank kann nur einmal pro Spiel verwendet werden.`, () => {
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
        alert("Bitte genau zwei Liebende auswählen.");
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
        alert("Bitte eine Person zum Ansehen auswählen.");
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
        alert("Bitte ein Opfer auswählen.");
        return;
      }
      const victimNames = Array.from(selected).map(btn => btn.textContent).join(' und ');
      showConfirmation("Opfer auswählen?", `Willst du ${victimNames} wirklich fressen?`, () => {
        selected.forEach(victimBtn => {
          const victim = victimBtn.textContent;
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
        moveToNextNightStep();
      });
      return; // Wait for confirmation
    } else if (role === "Stumme Jule") {
        const selected = nightChoices.querySelector(".player-btn.selected");
        if (!selected) {
            alert("Bitte eine Person zum Schweigen auswählen.");
            return;
        }
        const name = selected.textContent;
        showConfirmation("Spieler stumm schalten?", `Willst du ${name} wirklich für den nächsten Tag stumm schalten?`, () => {
            silencedPlayer = name;
            moveToNextNightStep();
        });
        return; // Wait for confirmation
    } else if (role === "Inquisitor") {
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        alert("Bitte eine Person zum Befragen auswählen.");
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
    const bloodMoonPityTimer = parseInt(localStorage.getItem('bloodMoonPityTimer') || '0');
    const bloodMoonChance = Math.min(0.2 + bloodMoonPityTimer * 0.1, 1);
    const oddsEl = document.getElementById('blood-moon-odds');
    if (oddsEl) {
      oddsEl.textContent = `Blutmond-Chance diese Nacht: ${Math.round(bloodMoonChance * 100)}%`;
    }
  }

  function triggerRandomEvents() {
    // If blood moon was manually triggered by admin, keep it active and skip random check.
    if (bloodMoonActive === true) {
        // Reset pity timer as the blood moon is happening
        localStorage.setItem('bloodMoonPityTimer', 0);
        updateBloodMoonOdds();
        return;
    }

    // Reset all events
    bloodMoonActive = false;

    if (!eventsEnabledCheckbox.checked) {
      return;
    }

    let bloodMoonPityTimer = parseInt(localStorage.getItem('bloodMoonPityTimer') || '0');
    const bloodMoonChance = Math.min(0.2 + bloodMoonPityTimer * 0.1, 1);

    if (Math.random() < bloodMoonChance) {
      bloodMoonActive = true;
      bloodMoonPityTimer = 0;
    } else {
      bloodMoonPityTimer++;
    }
    localStorage.setItem('bloodMoonPityTimer', bloodMoonPityTimer);
    updateBloodMoonOdds();
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
    
    const uniqueLivingRoles = Array.from(new Set(livingPlayerRoles));
    
    // Filter night sequence based on available living roles
    nightSteps = nightSequence.filter((r) => {
      if (r === "Amor" || r === "Geschwister" || r === "Henker") {
        return uniqueLivingRoles.includes(r) && dayCount === 0;
      }
      return uniqueLivingRoles.includes(r);
    });

    if (nightSteps.length === 0) {
      resultOutput.innerHTML = "Keine Nachtaktionen nötig.";
      startNightBtn.style.display = "none";
      return;
    }

    // Reset state for new night
    currentNightVictims = [];
    nightMode = true;
    nightIndex = 0;
    
    // Trigger random events
    triggerRandomEvents();

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
      alert("Keine Namen zum Speichern.");
      return;
    }
    localStorage.setItem("werwolfSavedNames", JSON.stringify(names));
    alert("Namen gespeichert!");
  });

  // Load names from localStorage
  loadNamesBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfSavedNames");
    if (!data) {
      alert("Keine gespeicherten Namen gefunden.");
      return;
    }
    try {
      const names = JSON.parse(data);
      playersTextarea.value = names.join("\n");
      playersTextarea.dispatchEvent(new Event("input"));
    } catch (e) {
      alert("Fehler beim Laden der Namen.");
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
      alert("Keine Rollen zum Speichern.");
      return;
    }
    localStorage.setItem("werwolfSavedRoles", JSON.stringify(roleSetup));
    alert("Rollen gespeichert!");
  });

  // Load roles from localStorage
  loadRolesBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfSavedRoles");
    if (!data) {
      alert("Keine gespeicherten Rollen gefunden.");
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
      alert("Fehler beim Laden der Rollen.");
    }
  });

  loadLastUsedBtn.addEventListener("click", () => {
    const data = localStorage.getItem("werwolfLastUsed");
    if (!data) {
      alert("Keine zuletzt benutzten Optionen gefunden.");
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

      lastUsed.roles.forEach(role => {
        const qty = role.quantity || 0;
        if (categorizedRoles.village.includes(role.name)) {
            addRoleRow(role.name, qty, rolesContainerVillage);
        } else if (categorizedRoles.werwolf.includes(role.name)) {
            addRoleRow(role.name, qty, rolesContainerWerwolf);
        } else { // Special or custom roles
            addRoleRow(role.name, qty, rolesContainerSpecial);
        }
      });

    } catch (e) {
      alert("Fehler beim Laden der zuletzt benutzten Optionen.");
    } finally {
      isLoadingLastUsed = false;
    }
  });


  addRoleBtn.addEventListener("click", () => addRoleRow("", 1, rolesContainerSpecial));

  assignBtn.addEventListener("click", () => {
    // Get players
    const playersRaw = document.getElementById("players").value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean);

    if (playersRaw.length === 0) {
      alert("Bitte mindestens einen Spielernamen eingeben.");
      assignBtn.style.display = "inline-block"; // Show the button again
      return;
    }

    // Build roles array respecting quantities
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

    // Auto-save the setup
    const lastUsedOptions = {
      players: playersRaw,
      roles: roleSetup,
    };
    localStorage.setItem('werwolfLastUsed', JSON.stringify(lastUsedOptions));

    roles = roles.filter(Boolean);

    if (roles.length === 0) {
      alert("Bitte mindestens eine Rolle und Menge > 0 eingeben.");
      assignBtn.style.display = "inline-block"; // Show the button again
      return;
    }

    // Check role count vs player count
    if (roles.length < playersRaw.length) {
      if (
        !confirm(
          "Es gibt weniger Rollen als Spieler. Einige Spieler bekommen 'Dorfbewohner'. Fortfahren?"
        )
      ) {
        assignBtn.style.display = "inline-block"; // Show the button again
        return;
      }
      // Fill remaining with default role
      while (roles.length < playersRaw.length) {
        roles.push("Dorfbewohner");
      }
    } else if (roles.length > playersRaw.length) {
      if (
        !confirm(
          "Es gibt mehr Rollen als Spieler. Überschüssige Rollen werden ignoriert. Fortfahren?"
        )
      ) {
        assignBtn.style.display = "inline-block"; // Show the button again
        return;
      }
      roles = roles.slice(0, playersRaw.length);
    }

    // Shuffle roles
    shuffleArray(roles);

    // Map roles to players
    players = playersRaw;
    rolesAssigned = roles;
    currentIndex = 0;

    // Reset and set up special roles
    henker = null;
    geschwister = [];
    geist.player = null;
    geist.messageSent = false;
    peaceDays = 0;
    jagerShotUsed = false;
    jagerDiedLastNight = null;
    initializeMichaelJacksonAccusations();

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
      const roleNameEl = document.createElement('span');
      roleNameEl.className = 'role-name';
      if (role === 'Dorfbewohner') {
        roleNameEl.classList.add('long-text');
      }
      roleNameEl.textContent = role;
      back.innerHTML = `<span class="player-name">${player}</span>`;
      back.prepend(roleNameEl);
      
      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent card from flipping back
        showRoleInfo(role);
      };
      back.appendChild(infoBtn);

      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);
      revealGrid.appendChild(card);
    });

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
  }

  function showRoleInfo(role) {
    const modal = document.getElementById('role-info-modal');
    const title = document.getElementById('role-info-title');
    const desc = document.getElementById('role-info-desc');

    title.textContent = role;
    desc.textContent = roleDescriptions[role] || "Keine Beschreibung für diese Rolle verfügbar.";

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
      dayCount: dayCount,
      mayor: mayor,
      nightMode: nightMode,
      dayMode: dayMode,
      nightSteps: nightSteps,
      nightIndex: nightIndex,
      michaelJacksonAccusations: Object.entries(michaelJacksonAccusations).reduce((acc, [player, data]) => {
        const days = Array.isArray(data?.daysAccused) ? data.daysAccused : [];
        const hasSpotlight = typeof data?.hasSpotlight === 'boolean' ? data.hasSpotlight : days.length > 0;
        acc[player] = { daysAccused: days, hasSpotlight };
        return acc;
      }, {})
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
    players = session.players;
    rolesAssigned = session.rolesAssigned;
    deadPlayers = session.deadPlayers || [];
    lovers = session.lovers || [];
    silencedPlayer = session.silencedPlayer || null;
    healRemaining = session.healRemaining !== undefined ? session.healRemaining : 1;
    poisonRemaining = session.poisonRemaining !== undefined ? session.poisonRemaining : 1;
    bloodMoonActive = session.bloodMoonActive || false;
    dayCount = session.dayCount || 0;
    mayor = session.mayor || null;
    nightMode = session.nightMode || false;
    dayMode = session.dayMode || false;
    nightSteps = session.nightSteps || [];
    nightIndex = session.nightIndex || 0;
    initializeMichaelJacksonAccusations(session.michaelJacksonAccusations || {});

    playersTextarea.value = session.players.join('\n');

    const roleCounts = {};
    session.roles.forEach(r => {
        roleCounts[r.name] = r.quantity;
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
      const roleNameEl = document.createElement('span');
      roleNameEl.className = 'role-name';
      if (role === 'Dorfbewohner') {
        roleNameEl.classList.add('long-text');
      }
      roleNameEl.textContent = role;
      back.innerHTML = `<span class="player-name">${player}</span>`;
      back.prepend(roleNameEl);
      
      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent card from flipping back
        showRoleInfo(role);
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

  const actionLog = [];
  const undoStack = [];
  const redoStack = [];

  const timelineLabelMap = {
    admin: 'Admin',
    macro: 'Makro',
    undo: 'Undo',
    redo: 'Redo',
    info: 'Info',
    error: 'Fehler'
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
  }

  function recordAction({ type = 'admin', label, detail = '', undo, redo }) {
    logAction({ type, label, detail });
    if (typeof undo === 'function' && typeof redo === 'function') {
      undoStack.push({ label, detail, undo, redo });
      redoStack.length = 0;
      updateUndoHistoryUI();
    }
  }

  function updateRevealCardRoleText(playerName, roleName) {
    const revealGrid = document.getElementById('reveal-grid');
    if (!revealGrid) return;
    const cards = revealGrid.querySelectorAll('.reveal-card');
    cards.forEach(card => {
      const playerNameOnCard = card.querySelector('.player-name');
      if (playerNameOnCard && playerNameOnCard.textContent === playerName) {
        const backOfCard = card.querySelector('.reveal-card-back');
        const roleNameEl = backOfCard ? backOfCard.querySelector('.role-name') : null;
        if (roleNameEl) {
          roleNameEl.textContent = roleName || '';
          if (roleName === 'Dorfbewohner') {
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
    allRoles.forEach(r => {
      const option = document.createElement('option');
      option.value = r;
      option.textContent = r;
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
        alert('Bitte einen Spieler und eine Rolle auswählen.');
        return;
      }

      showConfirmation('Rolle ändern?', `Willst du die Rolle von ${playerToChange} zu ${newRole} ändern?`, () => {
        const playerIndex = players.indexOf(playerToChange);
        if (playerIndex === -1) {
          logAction({ type: 'error', label: 'Rollenänderung nicht möglich', detail: `${playerToChange} wurde nicht gefunden.` });
          return;
        }

        const previousRole = rolesAssigned[playerIndex];
        if (previousRole === newRole) {
          logAction({ type: 'info', label: 'Keine Rollenänderung notwendig', detail: `${playerToChange} besitzt bereits die Rolle ${newRole}.` });
          showConfirmation('Keine Änderung', `${playerToChange} hat bereits die Rolle ${newRole}.`, () => {}, 'Okay', false);
          return;
        }

        rolesAssigned[playerIndex] = newRole;
        updateRevealCardRoleText(playerToChange, newRole);
        initializeMichaelJacksonAccusations();

        recordAction({
          type: 'admin',
          label: `Rollenwechsel: ${playerToChange}`,
          detail: `${previousRole || 'Unbekannt'} → ${newRole}`,
          undo: () => {
            rolesAssigned[playerIndex] = previousRole;
            updateRevealCardRoleText(playerToChange, previousRole || '');
          },
          redo: () => {
            rolesAssigned[playerIndex] = newRole;
            updateRevealCardRoleText(playerToChange, newRole);
          }
        });

        showConfirmation('Rolle geändert', `Die Rolle von ${playerToChange} wurde zu ${newRole} geändert.`, () => {}, 'Okay', false);
      });
    });
  }

  if (adminRevivePlayerBtn) {
    adminRevivePlayerBtn.addEventListener('click', () => {
      const playerToRevive = adminRevivePlayerSelect ? adminRevivePlayerSelect.value : '';
      if (!playerToRevive) {
        alert('Bitte einen Spieler auswählen.');
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
        alert('Bitte einen Spieler auswählen.');
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

        loverAlerts.forEach(message => alert(message));

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
        item.textContent = `${player}: ${rolesAssigned[index]}`;
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

    rolesOverviewContent.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'single-role-display';
    p.textContent = `${selectedPlayer}: ${role}`;
    if (deadPlayers.includes(selectedPlayer)) {
        p.classList.add('dead');
    }
    rolesOverviewContent.appendChild(p);
  });

  rolesOverviewShowAllBtn.addEventListener('click', displayAllRolesInOverview);


});
