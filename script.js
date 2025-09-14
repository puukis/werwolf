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
  const rolesContainer = document.getElementById("roles-container");
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

  // Win screen elements
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const winMessage = document.getElementById('win-message');
  const winBtn = document.getElementById('win-btn');

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

  let players = [];
  let rolesAssigned = [];
  let currentIndex = 0;
  let revealed = false;

  // Helper to create a role input row
  function addRoleRow(value = "", qty = 1) {
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

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✖";
    removeBtn.className = "remove-role";
    removeBtn.addEventListener("click", () => {
      rolesContainer.removeChild(row);
    });

    row.appendChild(input);
    row.appendChild(qtyControls);
    row.appendChild(removeBtn);
    rolesContainer.appendChild(row);
  }

  // Add default role templates
  const allRoles = [
    "Werwolf",
    "Dorfbewohner",
    "Hexe",
    "Seer",
    "Jäger",
    "Amor",
    "Trickster",
    "Stumme Jule"
  ];

  // Initiale Anzeige: Werwolf und Dorfbewohner mit 1, Rest mit 0
  allRoles.forEach((r) => {
    const qty = 0;
    addRoleRow(r, qty);
  });

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
  };

  /* -------------------- Erste Nacht Logik -------------------- */
  const nightSequence = ["Amor", "Seer", "Werwolf", "Hexe", "Stumme Jule"];
  const nightTexts = {
    Amor: "Amor wacht auf. Bitte wähle zwei Liebende.",
    Seer: "Der Seher wacht auf. Bitte wähle eine Person zum Ansehen.",
    Werwolf: "Werwölfe wachen auf. Sucht euer Opfer.",
    Hexe: "Die Hexe wacht auf. Entscheide Heil- oder Gifttrank.",
    "Stumme Jule": "Stumme Jule wacht auf. Wähle eine Person, die nicht reden darf.",
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

  function renderPlayerChoices(selectLimit = 1, customList = null) {
    nightChoices.innerHTML = "";
    let list = customList || players;
    
    // Check if we're showing a custom list (like currentNightVictims)
    const isCustomList = customList !== null;
    
    // If it's the werewolf phase, show all players but disable werewolves
    const isWerewolfPhase = nightSteps[nightIndex] === "Werwolf";
    
    list.forEach((p, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = p;
      btn.className = "player-btn";
      
      // Check if this player is a werewolf (only during werewolf phase)
      const isWerewolf = isWerewolfPhase && rolesAssigned[players.indexOf(p)] === "Werwolf";
      
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
      voteCount[player] = count;
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
  
  function executeLynching() {
    const { maxVotes, candidates } = calculateVoteResults();

    if (candidates.length === 1) {
      const lynched = candidates[0];
      showConfirmation("Spieler hängen?", `Willst du ${lynched} wirklich hängen?`, () => {
        // Add to dead players if not already there
        if (!deadPlayers.includes(lynched)) {
          deadPlayers.push(lynched);
        }
        updatePlayerCardVisuals();
        
        // Show lynching result
        dayText.textContent = `${lynched} wurde mit ${maxVotes} Stimmen gehängt.`;
        
        // Check for lover chain reaction
        lovers.forEach(pair => {
          if (pair.includes(lynched)) {
            const partner = pair[0] === lynched ? pair[1] : pair[0];
            if (!deadPlayers.includes(partner)) {
              deadPlayers.push(partner);
              dayText.textContent += `

${partner} stirbt, weil sie/er mit ${lynched} verliebt war.`;
            }
          }
        });
        
        // Clear choices and show continue button
        dayChoices.innerHTML = '';
        dayLynchBtn.style.display = 'none';
        daySkipBtn.textContent = 'Weiter';
        daySkipBtn.onclick = () => {
          // Check for game over after lynching
          if (checkGameOver()) {
            return;
          }
          
          // Only proceed to next phase if game isn't over
          if (!checkGameOver(true)) {
            setTimeout(() => endDayPhase(), 3000);
          }
        };
      });
    } else {
      // Handle case where no one was lynched (tie or no votes)
      dayText.textContent = 'Kein Spieler wurde mit ausreichend Stimmen verurteilt.';
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
    const livingPlayers = players.filter(p => !deadPlayers.includes(p));
    const livingWerewolves = livingPlayers.filter(p => {
      const role = rolesAssigned[players.indexOf(p)];
      return role === 'Werwolf' && !deadPlayers.includes(p);
    });
    
    // If lovers are the only ones left, they win
    if (lovers.length > 0) {
      const livingLovers = lovers.flat().filter(p => livingPlayers.includes(p));
      if (livingLovers.length === livingPlayers.length && livingPlayers.length > 0) {
        if (!silent) {
          showWin('Die Liebenden gewinnen!', 'Nur noch das Liebespaar ist am Leben.');
        }
        return true;
      }
    }

    // If no werewolves are left, villagers win
    if (livingWerewolves.length === 0) {
      if (!silent) {
        showWin('Dorfbewohner gewinnen!', 'Alle Werwölfe wurden eliminiert.');
      }
      return true;
    }
    
    // If werewolves equal or outnumber villagers, werewolves win
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
    
    dayText.innerHTML = `
      <p>In der Nacht sind folgende Spieler gestorben: <strong>${currentNightVictims.join(', ') || 'niemand'}</strong>.</p>
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
    
    let nightReport = currentNightVictims.length > 0
      ? `In der Nacht wurden folgende Spieler getötet: <strong>${currentNightVictims.join(', ')}</strong>.`
      : 'Es gab keine Todesfälle in der Nacht.';

    let silencedMessage = '';
    if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
      silencedMessage = `<p>🤫 ${silencedPlayer} wurde zum Schweigen gebracht und darf nicht reden oder abstimmen.</p>`;
    } else {
      silencedPlayer = null;
    }

    dayText.innerHTML = `
      <p>${nightReport}</p>
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
      dayChoices.innerHTML = '';
      dayLynchBtn.style.display = 'none';
      daySkipBtn.textContent = 'Weiter';
      daySkipBtn.onclick = endDayPhase;
    };
    
    renderDayChoices();
  }

  function startDayPhase() {
    dayMode = true;
    dayCount++;
    
    if (checkGameOver()) return;

    document.querySelector('.container').classList.add('hidden');
    dayOverlay.style.display = 'flex';
    dayOverlay.classList.add('show');

    let dayTextContent = `<h2>Tag ${dayCount}</h2>`;
    if (silencedPlayer && !deadPlayers.includes(silencedPlayer)) {
      dayTextContent += `<p>🤫 ${silencedPlayer} wurde zum Schweigen gebracht und darf nicht reden oder abstimmen.</p>`;
    } else {
      silencedPlayer = null;
    }
    dayText.innerHTML = dayTextContent;

    if (dayCount === 1) {
      electMayor();
    } else {
      startNormalDayPhase();
    }
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
          }
          updatePlayerCardVisuals();
          // lover chain effect
          lovers.forEach((pair) => {
            if (pair.includes(name)) {
              const partner = pair[0] === name ? pair[1] : pair[0];
              if (!deadPlayers.includes(partner)) {
                deadPlayers.push(partner);
                currentNightVictims.push(partner);
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
          if (!deadPlayers.includes(victim)) {
            deadPlayers.push(victim);
            currentNightVictims.push(victim);
            console.log("Player killed by werewolves:", victim);
          }
          updatePlayerCardVisuals();
          // lover chain effect
          lovers.forEach((pair) => {
            if (pair.includes(victim)) {
              const partner = pair[0] === victim ? pair[1] : pair[0];
              if (!deadPlayers.includes(partner)) {
                deadPlayers.push(partner);
                currentNightVictims.push(partner);
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
      // Always include all roles except Amor
      if (r !== "Amor") {
        return uniqueLivingRoles.includes(r);
      }
      // Only include Amor on the first night
      return uniqueLivingRoles.includes(r) && dayCount === 0;
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
    rolesContainer.innerHTML = "";
    allRoles.forEach((role) => {
      const qty = suggestion[role] || 0;
      addRoleRow(role, qty);
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

      rolesContainer.innerHTML = "";
      lastUsed.roles.forEach(role => {
        addRoleRow(role.name, role.quantity);
      });

    } catch (e) {
      alert("Fehler beim Laden der zuletzt benutzten Optionen.");
    } finally {
      isLoadingLastUsed = false;
    }
  });


  addRoleBtn.addEventListener("click", () => addRoleRow());

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
    const roleRows = Array.from(rolesContainer.querySelectorAll(".role-row"));
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

    // Save the session
    saveSession();

    // Hide setup and show results
    document.querySelector('.setup-container').style.display = 'none';
    assignBtn.style.display = 'none';
    loadLastUsedBtn.style.display = 'none';
    document.getElementById('ergebnisse-title').style.display = 'block';
    document.querySelector('.navigation-buttons').style.display = 'flex';
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

  window.addEventListener('click', (event) => {
    if (event.target === roleInfoModal) {
      roleInfoModal.style.display = 'none';
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
      nightIndex: nightIndex
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

    playersTextarea.value = session.players.join('\n');

    const roleCounts = {};
    session.roles.forEach(r => {
        roleCounts[r.name] = r.quantity;
    });

    rolesContainer.innerHTML = '';
    allRoles.forEach(role => {
        const qty = roleCounts[role] || 0;
        addRoleRow(role, qty);
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
});

  // Admin Panel
  const adminPanel = document.getElementById('admin-panel');
  const triggerBloodMoonBtn = document.getElementById('trigger-blood-moon-btn');
  const adminPanelToggle = document.getElementById('admin-panel-toggle');
  const closeAdminPanelBtn = document.getElementById('close-admin-panel-btn');

  if (adminPanelToggle) {
    adminPanelToggle.addEventListener('click', () => {
      adminPanel.classList.toggle('hidden');
    });
  }

  if (closeAdminPanelBtn) {
    closeAdminPanelBtn.addEventListener('click', () => {
      adminPanel.classList.add('hidden');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.shiftKey && e.key === 'o') {
      adminPanel.classList.toggle('hidden');
    }
  });

  triggerBloodMoonBtn.addEventListener('click', () => {
    bloodMoonActive = true;
    
    // If in werewolf night step, update UI immediately
    if (nightMode && nightSteps[nightIndex] === 'Werwolf') {
      document.body.classList.add('blood-moon-active');
      nightTextEl.innerHTML = nightTexts['Werwolf'] + "<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.";
      renderPlayerChoices(2);
    }
  });