  const phaseTimerManager = (() => {
    let timers = new Map();
    let paused = false;
    let onChange = () => {};
    let counter = 0;

    function notifyChange() {
      onChange();
    }

    function serializeTimer(timer) {
      return {
        id: timer.id,
        label: timer.label,
        delay: timer.delay,
        remaining: timer.remaining
      };
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
        recordTimerEvent('triggered', { timerId: id, label });
        callback();
        notifyChange();
      };

      timer.run = run;

      if (!paused) {
        timer.timeoutId = setTimeout(run, delay);
      }

      timers.set(id, timer);
      recordTimerEvent('scheduled', { timerId: id, label, delay });
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
      recordTimerEvent('paused', { timers: Array.from(timers.values()).map(serializeTimer) });
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
            recordTimerEvent('triggered', { timerId: timer.id, label: timer.label });
            timer.callback();
            notifyChange();
          }, 0);
        } else {
          timer.timeoutId = setTimeout(() => {
            timers.delete(timer.id);
            recordTimerEvent('triggered', { timerId: timer.id, label: timer.label });
            timer.callback();
            notifyChange();
          }, timer.remaining);
        }
      });
      recordTimerEvent('resumed', { timers: Array.from(timers.values()).map(serializeTimer) });
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
      recordTimerEvent('cancelled', { timerId: id, label: timer.label });
      notifyChange();
      return true;
    }

    function cancelAll() {
      const activeTimers = Array.from(timers.values()).map(serializeTimer);
      timers.forEach(timer => {
        if (timer.timeoutId) {
          clearTimeout(timer.timeoutId);
        }
      });
      timers.clear();
      recordTimerEvent('cancelled_all', { timers: activeTimers });
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

    function history() {
      return timerEventHistory.slice();
    }

    function resetHistory() {
      resetTimerEventHistory();
    }

    return { schedule, pause, resume, cancel, cancelAll, list, setOnChange, isPaused, history, resetHistory };
  })();

  const gameCheckpoints = [];
  let checkpointCounter = 0;
  let isRestoringCheckpoint = false;
  let nightCounter = 0;
  let firstNightShieldUsed = false;

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
    logAction({
      type: 'night',
      label: logLabel || undefined,
      detail,
      logKey: 'bodyguard.saved',
      params: { player: target }
    });
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

    if (!isPhoenixPulseAvailable()) {
      phoenixPulseStatus.textContent = localization.t('phoenix.status.disabled') || 'Phoenix Pulse: deaktiviert';
      return;
    }

    if (phoenixPulsePending) {
      phoenixPulseStatus.textContent = localization.t('phoenix.status.ready') || 'Phoenix Pulse: bereit';
      phoenixPulseStatus.classList.add('active');
    } else if (phoenixPulseJustResolved && phoenixPulseRevivedPlayers.length > 0) {
      const revivedList = phoenixPulseRevivedPlayers.join(', ');
      phoenixPulseStatus.textContent = localization.t('phoenix.status.resolved', { players: revivedList })
        || `Phoenix Pulse: ${revivedList} zurück`;
      phoenixPulseStatus.classList.add('resolved');
    } else {
      phoenixPulseStatus.textContent = localization.t('phoenix.status.default') || 'Phoenix Pulse: –';
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

      ambienceManager.flashPhoenixPulse();

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

  function captureNightStepSnapshot(role) {
    if (isRestoringCheckpoint) {
      return;
    }

    const lastEntry = nightStepHistory[nightStepHistory.length - 1];
    if (lastEntry && lastEntry.index === nightIndex) {
      return;
    }

    while (nightStepHistory.length > 0 && nightStepHistory[nightStepHistory.length - 1].index >= nightIndex) {
      nightStepHistory.pop();
    }

    nightStepHistory.push({
      index: nightIndex,
      role,
      state: createStateSnapshot()
    });
  }

  function showNightStep() {
    // Skip to next step if no more steps
    if (nightIndex >= nightSteps.length) {
      // End of night
      ambienceManager.clearNightStep();
      nightOverlay.style.display = "none";
      startDayPhase();
      return;
    }
    
    const role = nightSteps[nightIndex];
    // Normalize role name for comparison
    const normalizedRole = role.toLowerCase();
    ambienceManager.setNightStep(role);

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

    captureNightStepSnapshot(role);

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
                const prompt = escapeHtml(nightTexts['Werwolf'] || 'Werwölfe wachen auf.');
                nightTextEl.innerHTML = `${prompt}<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.`;
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
    } else if (role === "Doctor") {
      const targets = getDoctorAvailableTargets();
      const prompt = escapeHtml(nightTexts[role] || 'Der Arzt wacht auf.');
      if (targets.length > 0) {
        const targetText = targets.map((name) => escapeHtml(name)).join(', ');
        nightTextEl.innerHTML = `${prompt}<br><small>Verfügbare Ziele: ${targetText}</small>`;
        renderPlayerChoices(1, targets);
      } else {
        nightTextEl.innerHTML = `${prompt}<br><small>Es gibt niemanden zu heilen.</small>`;
        nightChoices.innerHTML = "";
        nightChoices.style.display = "none";
      }
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
            const henkerName = escapeHtml(henker.player || '');
            const targetName = escapeHtml(henker.target || '');
            nightTextEl.innerHTML = `Der Henker ist <strong>${henkerName}</strong>.<br>Sein Ziel, das gelyncht werden muss, ist <strong>${targetName}</strong>.`;
        } else {
            nightTextEl.textContent = nightTexts[role];
        }
        nightChoices.innerHTML = "";
        nightChoices.style.display = "none";
    } else if (role === "Geschwister") {
      if (dayCount === 0) { // Only on the first night
        const otherGeschwister = geschwister.filter(p => !deadPlayers.includes(p));
        const siblingText = otherGeschwister.map((name) => escapeHtml(name)).join(', ');
        nightTextEl.innerHTML = `Ihr seid die Geschwister. Die anderen Geschwister sind: <br><strong>${siblingText}</strong>`;
      }
      nightChoices.innerHTML = "";
      nightChoices.style.display = "none";
    } else if (role === "Inquisitor") {
      renderPlayerChoices(1, players.filter((p) => !deadPlayers.includes(p)));
    } else {
      nightChoices.innerHTML = "";
      nightChoices.style.display = "none";
    }

    renderNarratorDashboard();
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
        const shieldPreventsLynch = eventConfig.firstNightShield && !firstNightShieldUsed && dayCount === 1 && nightCounter <= 1;
        const messageParts = [`<p>${lynched} wurde mit ${maxVotes} Stimmen gehängt.</p>`];
        if (shieldPreventsLynch) {
          firstNightShieldUsed = true;
          peaceDays++;
          messageParts[0] = `<p>✨ Schutznacht: ${lynched} überlebt.</p>`;
          composeDayMessage(messageParts);
          logAction({ type: 'event', label: 'Schutznacht', detail: `${lynched} entkommt der Lynchung` });
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
          renderNarratorDashboard();
          return;
        }

        if (!deadPlayers.includes(lynched)) {
          deadPlayers.push(lynched);
          peaceDays = 0;
          handlePlayerDeath(lynched);
        }
        updatePlayerCardVisuals();
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
      const jobs = getPlayerJobs(playerIndex);

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
      if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
        roleNameEl.classList.add('long-text');
      }
      renderRoleWithJobs(roleNameEl, role, jobs);
      back.innerHTML = `<span class="player-name">${victimName}</span>`;
      back.prepend(roleNameEl);

      const infoBtn = document.createElement('button');
      infoBtn.className = 'info-btn';
      infoBtn.textContent = 'Info';
      infoBtn.onclick = (e) => {
        e.stopPropagation();
        showRoleInfo(role, { jobs });
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
    eventScheduler.completeQueuedEffect('phoenix-pulse', { revived });
    persistEventEngineState();
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
    ambienceManager.setPhaseAmbience('day');
    ambienceManager.clearNightStep();

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
      setBloodMoonState(false);
      nightMode = false;
      nightOverlay.style.display = "none";
      assignBtn.style.display = "inline-block";
      startNightBtn.style.display = "none";
      console.log("Tote Spieler:", deadPlayers);
      console.log("Liebespaare:", lovers);

      const uniqueVictims = Array.from(new Set(currentNightVictims));
      if (uniqueVictims.length >= 2) {
        doctorPendingTargets = uniqueVictims.slice();
        doctorPendingNight = nightCounter + 1;
        doctorTriggerSourceNight = nightCounter;
      }

      nightStepHistory = [];
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
    } else if (role === "Doctor") {
      const availableTargets = getDoctorAvailableTargets();
      if (availableTargets.length === 0) {
        clearDoctorPending();
        renderNarratorDashboard();
        moveToNextNightStep();
        return;
      }
      const selected = nightChoices.querySelector(".player-btn.selected");
      if (!selected) {
        showConfirmation({
          title: 'Keine Heilung?',
          text: 'Der Arzt kann diese Nacht eine Person heilen. Soll er darauf verzichten?',
          confirmText: 'Überspringen',
          cancelText: 'Zurück',
          onConfirm: () => {
            clearDoctorPending();
            logAction({
              type: 'night',
              logKey: 'doctor.skipped',
              params: {},
              detail: 'Keine Heilung gewählt'
            });
            renderNarratorDashboard();
            moveToNextNightStep();
          }
        });
        return;
      }
      const name = selected.textContent;
      showConfirmation('Heilung einsetzen?', `Soll ${name} vom Arzt geheilt werden?`, () => {
        const wasDead = deadPlayers.includes(name);
        if (wasDead) {
          deadPlayers = deadPlayers.filter(player => player !== name);
          doctorPendingTargets = doctorPendingTargets.filter(player => player !== name);
          doctorLastHealedTarget = name;
          doctorLastHealedNight = nightCounter;
          updatePlayerCardVisuals();
          populateAdminKillSelect();
          populateAdminReviveSelect();
          if (name === jagerDiedLastNight) {
            jagerDiedLastNight = null;
          }
          checkGameOver(true);
          if (resultOutput) {
            resultOutput.innerHTML += `<br>🩺 Der Arzt hat ${name} geheilt!`;
          }
          logAction({
            type: 'night',
            logKey: 'doctor.healed',
            params: { player: name },
            detail: name
          });
        } else {
          if (resultOutput) {
            resultOutput.innerHTML += `<br>🩺 Der Arzt wollte ${name} heilen, aber die Person lebt bereits.`;
          }
          logAction({
            type: 'night',
            logKey: 'doctor.alive',
            params: { player: name },
            detail: `${name} war bereits am Leben`
          });
        }
        clearDoctorPending();
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
      const victims = Array.from(selected).map(btn => btn.textContent);
      const victimNames = victims.join(' und ');
      showConfirmation("Opfer auswählen?", `Willst du ${victimNames} wirklich fressen?`, () => {
        const shouldTriggerFirstNightShield = eventConfig.firstNightShield && !firstNightShieldUsed && nightCounter <= 1;
        if (shouldTriggerFirstNightShield) {
          const plural = victims.length > 1 ? 'überleben' : 'überlebt';
          if (resultOutput) {
            resultOutput.innerHTML += `<br>✨ Schutznacht: ${victimNames} ${plural}.`;
          }
          logAction({ type: 'event', label: 'Schutznacht', detail: victimNames });
          firstNightShieldUsed = true;
          renderNarratorDashboard();
          moveToNextNightStep();
          return;
        }

        victims.forEach(victim => {
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
    if (event.target === configModal) {
      closeConfigModal();
    }
  });
  
  // Day phase event listeners
  // We'll handle click events through direct onclick assignments
  // to prevent multiple event listeners from stacking up

  function updateBloodMoonOdds() {
    const oddsEl = document.getElementById('blood-moon-odds');
    if (!oddsEl) {
      return;
    }

    if (!isBloodMoonAvailable()) {
      oddsEl.textContent = 'Blutmond deaktiviert';
      return;
    }

    const rawTimer = parseInt(getPersistedValue('bloodMoonPityTimer') || '0', 10);
    const pityTimer = Number.isFinite(rawTimer) ? Math.max(rawTimer, 0) : 0;
    const bloodMoonChance = getBloodMoonChance(pityTimer);
    oddsEl.textContent = `Blutmond-Chance diese Nacht: ${Math.round(bloodMoonChance * 100)}%`;
  }

  function buildEventTriggerContext(nightNumber) {
    return {
      nightNumber,
      flags: {
        randomEventsEnabled: areRandomEventsEnabled(),
        bloodMoonEnabled: isBloodMoonEventEnabled(),
        phoenixEnabled: isPhoenixPulseEventEnabled()
      },
      state: {
        bloodMoonActive
      },
      storage: {
        getNumber(key, fallback = 0) {
          const raw = getPersistedValue(key);
          if (raw === null || raw === undefined) {
            return fallback;
          }
          const value = Number(raw);
          return Number.isFinite(value) ? value : fallback;
        },
        setNumber(key, value) {
          try {
            const numeric = Number.isFinite(value) ? value : 0;
            persistValue(key, String(numeric));
          } catch (error) {
            // Ignore storage errors
          }
        }
      },
      helpers: {
        getBloodMoonChance,
        getPhoenixPulseChance
      },
      random: Math.random
    };
  }

  function buildNightDeckEntries() {
    const activeDecks = new Set(getActiveDeckIds());
    return eventCardDefinitions
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => {
        if (!card || !card.id) {
          return false;
        }
        if (!card.deckId) {
          return true;
        }
        return activeDecks.has(card.deckId);
      })
      .map(({ card, index }) => {
        const deckConfig = eventConfig.decks[card.deckId] || { enabled: true, weight: 1 };
        const weight = Math.max(0, Number(deckConfig.weight) || 0);
        return { card, weight, index };
      })
      .filter(entry => entry.weight > 0)
      .sort((a, b) => {
        const weightDiff = b.weight - a.weight;
        if (Math.abs(weightDiff) > Number.EPSILON) {
          return weightDiff;
        }
        return a.index - b.index;
      });
  }

  function executeEventCard(card, meta, nightNumber, { scriptStep = null } = {}) {
    if (!card) {
      return;
    }
    const effectResult = typeof card.effect === 'function'
      ? card.effect({
          scheduler: eventScheduler,
          helpers: {
            logAction,
            refreshEventUI,
            setBloodMoonState,
            clearBloodMoonState,
            setPhoenixPulseCharged,
            updatePhoenixPulseStatus
          },
          meta,
          nightNumber,
          scriptStep
        }) || {}
      : {};

    if (effectResult.log) {
      logAction(effectResult.log);
    }

    if (effectResult.message && resultOutput) {
      resultOutput.innerHTML += effectResult.message;
    }

    const historyEntry = {
      night: nightNumber,
      cardId: card.id,
      label: card.label || card.id,
      meta,
      narratorNote: effectResult.narratorNote || null,
      scriptStep: scriptStep ? { ...scriptStep } : null
    };
    eventScheduler.recordHistory(historyEntry);
    persistEventEngineState();
  }

  function evaluateEventCard(card, deckWeight, nightNumber) {
    if (!card || typeof card.trigger !== 'function') {
      return { triggered: false, reason: 'missing-trigger' };
    }
    const weight = Math.max(0, Number(deckWeight) || 0);
    if (weight <= 0) {
      return { triggered: false, reason: 'weight-zero' };
    }
    const context = buildEventTriggerContext(nightNumber);
    if (weight < 1) {
      const gateRoll = Math.random();
      if (gateRoll > weight) {
        return { triggered: false, reason: 'weight-gate', gateRoll };
      }
    }
    let meta = card.trigger(context) || { triggered: false };
    if (!meta.triggered && weight > 1) {
      const tries = Math.max(1, Math.round(weight));
      for (let attempt = 1; attempt < tries; attempt += 1) {
        meta = card.trigger(context) || { triggered: false };
        if (meta.triggered) {
          break;
        }
      }
    }
    return meta;
  }

