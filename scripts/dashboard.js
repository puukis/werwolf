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
      if (doctorPendingNight !== null && doctorPlayers.length > 0) {
        const availableDoctorTargets = getDoctorAvailableTargets();
        if (availableDoctorTargets.length > 0) {
          events.push(`Arzt vorbereitet (Nacht ${doctorPendingNight}): ${availableDoctorTargets.join(', ')}`);
        }
      }
      if (doctorLastHealedTarget && doctorLastHealedNight === nightCounter) {
        events.push(`Arzt Heilung: ${doctorLastHealedTarget}`);
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
      const schedulerSnapshot = eventScheduler.getState();
      schedulerSnapshot.activeModifiers.forEach(modifier => {
        events.push(`Modifikator: ${modifier.label}`);
      });
      schedulerSnapshot.queuedEffects.forEach(entry => {
        const nightLabel = entry.night ? ` (Nacht ${entry.night})` : '';
        events.push(`Geplant: ${entry.label}${nightLabel}`);
      });
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

    if (stepBackBtn) {
      if (nightMode && nightStepHistory.length > 1) {
        const previousEntry = nightStepHistory[nightStepHistory.length - 2];
        const targetLabel = previousEntry && previousEntry.role
          ? previousEntry.role
          : 'vorherigen Schritt';
        stepBackBtn.disabled = false;
        stepBackBtn.textContent = `Zurück zu ${targetLabel}`;
      } else {
        stepBackBtn.disabled = true;
        stepBackBtn.textContent = defaultStepBackText;
      }
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
      doctorPlayers: doctorPlayers.slice(),
      doctorPendingTargets: doctorPendingTargets.slice(),
      doctorPendingNight,
      doctorTriggerSourceNight,
      doctorLastHealedTarget,
      doctorLastHealedNight,
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      firstNightShieldUsed,
      eventEngineState: getEventEngineSnapshot(),
      roleSchema: getRoleSchemaSnapshot(),
      roleSchemaSource
    };
  }

  function captureGameCheckpoint(label) {
    if (isRestoringCheckpoint) return;
    const timestamp = Date.now();
    checkpointCounter += 1;
    const snapshot = {
      id: `checkpoint-${timestamp}-${checkpointCounter}`,
      label,
      timestamp,
      actionSequence: actionSequenceCounter,
      state: createStateSnapshot()
    };
    gameCheckpoints.push(snapshot);
    if (gameCheckpoints.length > 20) {
      gameCheckpoints.shift();
    }
    renderNarratorDashboard();
  }

  function applyStateSnapshot(snapshot, { resetNightHistory = true } = {}) {
    if (resetNightHistory) {
      nightStepHistory = [];
    }

    if (snapshot.roleSchema) {
      roleSchemaSource = snapshot.roleSchemaSource || roleSchemaSource || 'custom';
      applyRoleSchema(snapshot.roleSchema);
      refreshRoleInputsFromSchema({ preserveExisting: false });
    } else if (snapshot.roleSchemaSource) {
      roleSchemaSource = snapshot.roleSchemaSource;
      updateRoleEditorStatus();
    }

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
    if (Array.isArray(snapshot.doctorPlayers) && snapshot.doctorPlayers.length > 0) {
      snapshot.doctorPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignDoctorJobToIndex(idx);
        }
      });
    }
    if (snapshot.jobConfig && typeof snapshot.jobConfig.doctorChance === 'number') {
      jobConfig.doctorChance = Math.min(Math.max(snapshot.jobConfig.doctorChance, 0), 1);
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    if (!snapshot.jobConfig || typeof snapshot.jobConfig.doctorChance !== 'number') {
      jobConfig.doctorChance = defaultJobConfig.doctorChance;
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    deadPlayers = snapshot.deadPlayers.slice();
    lovers = snapshot.lovers.map(pair => pair.slice());
    silencedPlayer = snapshot.silencedPlayer;
    healRemaining = snapshot.healRemaining;
    poisonRemaining = snapshot.poisonRemaining;
    setBloodMoonState(!!snapshot.bloodMoonActive);
    phoenixPulsePending = !!snapshot.phoenixPulsePending;
    phoenixPulseJustResolved = !!snapshot.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(snapshot.phoenixPulseRevivedPlayers)
      ? snapshot.phoenixPulseRevivedPlayers.slice()
      : [];
    if (typeof snapshot.firstNightShieldUsed === 'boolean') {
      firstNightShieldUsed = snapshot.firstNightShieldUsed;
    } else {
      const snapshotNightCounter = Number.isFinite(snapshot.nightCounter) ? snapshot.nightCounter : 0;
      const snapshotDayCount = Number.isFinite(snapshot.dayCount) ? snapshot.dayCount : 0;
      const nightFinished = snapshotNightCounter > 1 || (snapshotNightCounter === 1 && !snapshot.nightMode);
      firstNightShieldUsed = nightFinished || snapshotDayCount > 0;
    }
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
    doctorPendingTargets = Array.isArray(snapshot.doctorPendingTargets)
      ? snapshot.doctorPendingTargets.slice()
      : [];
    doctorPendingNight = Number.isFinite(snapshot.doctorPendingNight)
      ? snapshot.doctorPendingNight
      : null;
    doctorTriggerSourceNight = Number.isFinite(snapshot.doctorTriggerSourceNight)
      ? snapshot.doctorTriggerSourceNight
      : null;
    doctorLastHealedTarget = snapshot.doctorLastHealedTarget || null;
    doctorLastHealedNight = Number.isFinite(snapshot.doctorLastHealedNight)
      ? snapshot.doctorLastHealedNight
      : null;
    updateDoctorPlayers();
    if (snapshot.eventEngineState) {
      restoreEventEngineState(snapshot.eventEngineState);
    } else {
      persistEventEngineState();
    }
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

  const ACTION_LOG_LIMIT = 500;
  const actionLog = [];
  const undoStack = [];
  const redoStack = [];
  let actionSequenceCounter = 0;

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

  function getActionEntryDate(entry) {
    if (entry.createdAt instanceof Date) {
      return entry.createdAt;
    }
    if (typeof entry.timestamp === 'number') {
      const date = new Date(entry.timestamp);
      if (!Number.isNaN(date.getTime())) {
        entry.createdAt = date;
        return date;
      }
    }
    if (typeof entry.iso === 'string') {
      const parsed = new Date(entry.iso);
      if (!Number.isNaN(parsed.getTime())) {
        entry.createdAt = parsed;
        return parsed;
      }
    }
    const fallback = new Date();
    entry.createdAt = fallback;
    return fallback;
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
      const createdAt = getActionEntryDate(entry);
      timeEl.dateTime = createdAt.toISOString();
      timeEl.textContent = formatTimestamp(createdAt);
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

  function logAction({ type = 'info', label, detail = '', metadata = {}, logKey = null, params = {} }) {
    const createdAt = new Date();
    actionSequenceCounter += 1;
    let resolvedLabel = label;
    let resolvedDetail = detail;

    if (logKey) {
      const templateLabel = localization.formatGameplayString('logs', logKey, 'label', params);
      if (templateLabel) {
        resolvedLabel = templateLabel;
      } else if (!resolvedLabel) {
        const template = localization.getLogTemplate(logKey);
        if (template?.label) {
          resolvedLabel = template.label;
        }
      }
      const templateDetail = localization.formatGameplayString('logs', logKey, 'detail', params);
      if (templateDetail) {
        resolvedDetail = templateDetail;
      } else if (!resolvedDetail) {
        const template = localization.getLogTemplate(logKey);
        if (template?.detail) {
          resolvedDetail = template.detail;
        }
      }
    }

    const entry = {
      id: `action-${createdAt.getTime()}-${actionSequenceCounter}`,
      sequence: actionSequenceCounter,
      type,
      label: resolvedLabel,
      detail: resolvedDetail,
      createdAt,
      phase: nightMode ? 'night' : (dayMode ? 'day' : 'setup'),
      step: nightMode ? nightSteps[nightIndex] || null : null,
      metadata: {
        ...metadata,
        dayCount,
        nightCounter,
        mayor,
        playerCount: players.length
      }
    };
    actionLog.unshift(entry);
    if (actionLog.length > ACTION_LOG_LIMIT) {
      actionLog.pop();
    }
    updateTimelineUI();
    renderNarratorDashboard();
    return entry;
  }

  function recordAction({ type = 'admin', label, detail = '', undo, redo, logKey = null, params = {} }) {
    logAction({ type, label, detail, logKey, params });
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
          if (roleName === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
            roleNameEl.classList.add('long-text');
          } else {
            roleNameEl.classList.remove('long-text');
          }
          renderRoleWithJobs(roleNameEl, roleName, Array.isArray(jobs) ? jobs : []);
        }
      }
    });
  }

  function syncBloodMoonUI({ silent = false } = {}) {
    const isWerewolfStep = nightMode && nightSteps[nightIndex] === 'Werwolf';
    if (isWerewolfStep) {
      if (bloodMoonActive) {
        document.body.classList.add('blood-moon-active');
        const prompt = escapeHtml(nightTexts['Werwolf'] || 'Werwölfe wachen auf.');
        nightTextEl.innerHTML = `${prompt}<br><strong>Blutmond!</strong> Ihr dürft ein zweites Opfer wählen.`;
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
    const roleOptionValues = [...allRoles, 'Bodyguard', 'Doctor'];
    roleOptionValues.forEach(r => {
      const option = document.createElement('option');
      option.value = r;
      if (r === 'Bodyguard') {
        option.textContent = 'Bodyguard (Job)';
      } else if (r === 'Doctor') {
        option.textContent = 'Arzt (Job)';
      } else {
        option.textContent = r;
      }
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

  if (stepBackBtn) {
    stepBackBtn.addEventListener('click', () => {
      if (!nightMode || nightStepHistory.length <= 1) {
        return;
      }

      const currentEntry = nightStepHistory.pop();
      const previousEntry = nightStepHistory[nightStepHistory.length - 1];

      if (!previousEntry) {
        if (currentEntry) {
          nightStepHistory.push(currentEntry);
        }
        return;
      }

      phaseTimerManager.cancelAll();
      logAction({
        type: 'admin',
        label: 'Schritt zurück',
        detail: `Nachtaktion: ${previousEntry.role || 'Unbekannt'}`
      });

      applyStateSnapshot(previousEntry.state, { resetNightHistory: false });
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
        if (previousRole === 'Doctor') {
          previousRole = 'Dorfbewohner';
          if (!previousJobs.includes('Doctor')) {
            previousJobs.push('Doctor');
          }
        }

        const isJobSelection = newRole === 'Bodyguard' || newRole === 'Doctor';
        const appliedRole = isJobSelection ? 'Dorfbewohner' : newRole;
        const hasBodyguardJob = previousJobs.includes('Bodyguard');
        const hasDoctorJob = previousJobs.includes('Doctor');
        const wantsBodyguard = newRole === 'Bodyguard';
        const wantsDoctor = newRole === 'Doctor';

        if (appliedRole === previousRole && hasBodyguardJob === wantsBodyguard && hasDoctorJob === wantsDoctor) {
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
        if (wantsDoctor) {
          assignDoctorJobToIndex(playerIndex);
        } else {
          removeDoctorJobFromIndex(playerIndex);
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
            removeDoctorJobFromIndex(playerIndex);
            if (previousJobs.includes('Bodyguard')) {
              assignBodyguardJobToIndex(playerIndex);
            }
            if (previousJobs.includes('Doctor')) {
              assignDoctorJobToIndex(playerIndex);
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
            removeDoctorJobFromIndex(playerIndex);
            if (newJobs.includes('Doctor')) {
              assignDoctorJobToIndex(playerIndex);
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

      setBloodMoonState(true);
      syncBloodMoonUI({ silent: true });
      showConfirmation('Blutmond aktiviert', 'Der Blutmond wurde für die nächste Nacht manuell aktiviert.', () => {}, 'Okay', false);

      eventScheduler.addModifier({
        id: 'blood-moon-manual',
        originCardId: 'blood-moon',
        label: '🌕 Blutmond (manuell)',
        expiresAfterNight: nightCounter + 1
      });
      persistValue('bloodMoonPityTimer', '0');
      persistEventEngineState();
      renderNarratorDashboard();

      recordAction({
        type: 'admin',
        label: 'Blutmond manuell aktiviert',
        detail: 'Gilt für die kommende Nacht.',
        undo: () => {
          setBloodMoonState(wasActive);
          syncBloodMoonUI({ silent: true });
          eventScheduler.removeModifier('blood-moon-manual');
          persistEventEngineState();
          renderNarratorDashboard();
        },
        redo: () => {
          setBloodMoonState(true);
          syncBloodMoonUI({ silent: true });
          eventScheduler.addModifier({
            id: 'blood-moon-manual',
            originCardId: 'blood-moon',
            label: '🌕 Blutmond (manuell)',
            expiresAfterNight: nightCounter + 1
          });
          persistValue('bloodMoonPityTimer', '0');
          persistEventEngineState();
          renderNarratorDashboard();
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
          phoenixPulsePending,
          phoenixPulseJustResolved,
          phoenixPulseRevivedPlayers: phoenixPulseRevivedPlayers.slice(),
          firstNightShieldUsed,
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
          doctorPlayers: doctorPlayers.slice(),
          doctorPendingTargets: doctorPendingTargets.slice(),
          doctorPendingNight,
          doctorTriggerSourceNight,
          doctorLastHealedTarget,
          doctorLastHealedNight,
          jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
          jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
          eventEngineState: getEventEngineSnapshot(),
          timeline: buildSessionTimeline(),
          ambience: ambienceManager.getSnapshot(),
          roleSchema: getRoleSchemaSnapshot(),
          roleSchemaSource
        };
      },
      setState(partial = {}) {
        let recalcJobs = false;
        let phoenixStateChanged = false;
        if (partial.roleSchema) {
          roleSchemaSource = partial.roleSchemaSource || roleSchemaSource || 'custom';
          applyRoleSchema(partial.roleSchema);
          refreshRoleInputsFromSchema({ preserveExisting: false });
          recalcJobs = true;
        } else if (partial.roleSchemaSource) {
          roleSchemaSource = partial.roleSchemaSource;
          updateRoleEditorStatus();
        }
        if (Array.isArray(partial.players)) {
          players = partial.players.slice();
          recalcJobs = true;
        }
        if (Array.isArray(partial.rolesAssigned)) {
          rolesAssigned = partial.rolesAssigned.slice();
          recalcJobs = true;
        }
        if (Array.isArray(partial.jobsAssigned)) {
          jobsAssigned = partial.jobsAssigned.map(entry => Array.isArray(entry) ? entry.slice() : []);
          recalcJobs = true;
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
          setBloodMoonState(!!partial.bloodMoonActive);
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
        if (partial.eventEngineState) {
          restoreEventEngineState(partial.eventEngineState);
        }
        if ('firstNightShieldUsed' in partial) {
          firstNightShieldUsed = !!partial.firstNightShieldUsed;
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
        if (partial.jobConfig && typeof partial.jobConfig.doctorChance === 'number') {
          jobConfig.doctorChance = Math.min(Math.max(partial.jobConfig.doctorChance, 0), 1);
          updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
        }

        if (phoenixStateChanged) {
          setPhoenixPulseCharged(phoenixPulsePending);
          updatePhoenixPulseStatus();
        }

        if (recalcJobs || Array.isArray(partial.jobsAssigned) || Array.isArray(partial.bodyguardPlayers) || Array.isArray(partial.doctorPlayers)) {
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
          if (Array.isArray(partial.doctorPlayers)) {
            partial.doctorPlayers.forEach(name => {
              const idx = players.indexOf(name);
              if (idx !== -1) {
                assignDoctorJobToIndex(idx);
              }
            });
          }
          updateBodyguardPlayers();
          recalcJobs = false;
        } else if (recalcJobs) {
          ensureJobsStructure();
          updateBodyguardPlayers();
          recalcJobs = false;
        }
        if (Array.isArray(partial.doctorPendingTargets)) {
          doctorPendingTargets = partial.doctorPendingTargets.slice();
        }
        if ('doctorPendingNight' in partial) {
          doctorPendingNight = Number.isFinite(partial.doctorPendingNight)
            ? partial.doctorPendingNight
            : null;
        }
        if ('doctorTriggerSourceNight' in partial) {
          doctorTriggerSourceNight = Number.isFinite(partial.doctorTriggerSourceNight)
            ? partial.doctorTriggerSourceNight
            : null;
        }
        if ('doctorLastHealedTarget' in partial) {
          doctorLastHealedTarget = partial.doctorLastHealedTarget || null;
        }
        if ('doctorLastHealedNight' in partial) {
          doctorLastHealedNight = Number.isFinite(partial.doctorLastHealedNight)
            ? partial.doctorLastHealedNight
            : null;
        }
        updateDoctorPlayers();
        renderNarratorDashboard();
      },
      renderNarratorDashboard,
      getAmbienceState() {
        return ambienceManager.getSnapshot();
      },
      setManualAmbience(config = {}) {
        if (config && Object.prototype.hasOwnProperty.call(config, 'playlist')) {
          ambienceManager.setManualPlaylist(config.playlist);
        }
        if (config && Object.prototype.hasOwnProperty.call(config, 'lighting')) {
          ambienceManager.setManualLighting(config.lighting);
        }
      },
      setPhaseAmbience: ambienceManager.setPhaseAmbience,
      previewNightStep(role) {
        if (role) {
          ambienceManager.setNightStep(role);
        } else {
          ambienceManager.clearNightStep();
        }
      },
      triggerAmbienceEvent(key, active = true) {
        ambienceManager.setEventAmbience(key, !!active);
      },
      playAmbienceStinger(id) {
        ambienceManager.triggerStinger(id);
      },
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
      setRoleSchema(schema, source = 'custom') {
        if (!schema || typeof schema !== 'object') {
          return;
        }
        roleSchemaSource = source || 'custom';
        applyRoleSchema(schema);
        refreshRoleInputsFromSchema({ preserveExisting: false });
        renderNarratorDashboard();
      },
      getRoleSchema() {
        return getRoleSchemaSnapshot();
      },
      generateNightSequence(context = {}) {
        return generateNightSteps(context);
      },
      getNightPrompt(stepId) {
        if (!stepId) {
          return '';
        }
        return nightTexts[stepId] || '';
      },
      showRoleInfo(roleName, options) {
        showRoleInfo(roleName, options);
      },
      getActionLog() {
        return actionLog.slice();
      },
      getTimerEvents() {
        return timerEventHistory.slice();
      },
      phaseTimerManager,
      getEventEngineState() {
        return getEventEngineSnapshot();
      },
      triggerNightEvents() {
        const upcomingNight = nightCounter + 1;
        triggerRandomEvents();
        nightCounter = upcomingNight;
      },
      resolvePhoenixPulse: applyPhoenixPulseRevival,
      auth: {
        getUser() {
          return authManager?.getUser() || null;
        },
        forceUser(user) {
          if (authManager) {
            authManager.forceUser(user, { suppressScreen: true });
          }
        },
        async requireLogin() {
          if (!authManager) {
            return null;
          }
          const user = authManager.getUser();
          if (user) {
            return user;
          }
          authManager.showLogin();
          return authManager.waitForAuth();
        },
      }
    };
  }

  if (deferInitialEventEnablement) {
    applyGlobalEventsEnabledState();
  } else {
    refreshEventUI();
  }

  renderNarratorDashboard();

});
