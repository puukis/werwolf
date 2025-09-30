  function triggerRandomEvents() {
    const upcomingNightNumber = nightCounter + 1;
    eventScheduler.clearExpiredModifiers(upcomingNightNumber);

    if (!areRandomEventsEnabled()) {
      persistEventEngineState();
      renderNarratorDashboard();
      return;
    }

    const forcedCardIds = new Set();
    const campaign = campaignDefinitions.find(entry => entry && entry.id === eventConfig.campaignId);
    if (campaign) {
      const executedKeys = new Set(eventEngineState?.campaignProgress?.executed || []);
      const script = Array.isArray(campaign.script) ? campaign.script : [];
      script
        .filter(step => step && step.eventId && step.night === upcomingNightNumber)
        .forEach(step => {
          const key = `${step.night || 0}:${step.eventId}`;
          if (executedKeys.has(key)) {
            return;
          }
          const card = eventCardDefinitions.find(entry => entry.id === step.eventId);
          if (!card) {
            return;
          }
          forcedCardIds.add(card.id);
          const meta = { triggered: true, forced: true, script: step };
          executeEventCard(card, meta, upcomingNightNumber, { scriptStep: step });
          markCampaignStepExecuted(step);
        });
    }

  const deckEntries = buildNightDeckEntries();
  deckEntries.forEach(entry => {
    if (forcedCardIds.has(entry.card.id)) {
      return;
    }
      const meta = evaluateEventCard(entry.card, entry.weight, upcomingNightNumber);
      if (meta && meta.triggered) {
        executeEventCard(entry.card, meta, upcomingNightNumber);
      } else if (meta && meta.reason !== 'disabled') {
        eventScheduler.recordHistory({
          night: upcomingNightNumber,
          cardId: entry.card.id,
          label: entry.card.label || entry.card.id,
          meta,
          narratorNote: null
        });
      }
    });

    persistEventEngineState();
    renderNarratorDashboard();
  }

  startNightBtn.addEventListener("click", () => {
    document.querySelector('.container').classList.add('hidden');
    ambienceManager.setPhaseAmbience('night');
    ambienceManager.clearNightStep();
    updateBodyguardPlayers();
    const livingRoleSet = getLivingRoleSet();
    const upcomingNightNumber = nightCounter + 1;
    const doctorTargets = getDoctorAvailableTargets();
    if (doctorPendingNight !== null && doctorPendingNight < upcomingNightNumber) {
      clearDoctorPending();
    }
    const doctorShouldAct = hasActiveDoctor()
      && doctorPendingNight === upcomingNightNumber
      && doctorTargets.length > 0;
    if (doctorPendingNight === upcomingNightNumber && doctorTargets.length === 0) {
      clearDoctorPending();
    }

    nightSteps = generateNightSteps({ doctorShouldAct, livingRoleSet });

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

    nightStepHistory = [];
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

  function applyLobbyWriteState(canWrite) {
    const hint = canWrite ? '' : READ_ONLY_HINT;

    const writableControls = [
      saveNamesBtn,
      saveRolesBtn,
      saveGameBtn,
      roleEditorSaveBtn,
      roleEditorResetBtn,
      roleEditorAddRoleBtn,
      roleEditorAddJobBtn,
      roleEditorAddNightStepBtn,
    ];

    writableControls.forEach((control) => {
      if (!control) {
        return;
      }
      control.disabled = !canWrite;
      if ('title' in control) {
        control.title = hint;
      }
      control.classList.toggle('read-only', !canWrite);
    });

    const writableInputs = [
      eventsEnabledCheckbox,
      bloodMoonEnabledCheckbox,
      firstNightShieldCheckbox,
      phoenixPulseEnabledCheckbox,
      revealDeadRolesCheckbox,
      bloodMoonChanceInput,
      phoenixPulseChanceInput,
      bodyguardJobChanceInput,
      doctorJobChanceInput,
    ];

    writableInputs.forEach((input) => {
      if (!input) {
        return;
      }
      input.disabled = !canWrite;
      if ('title' in input) {
        input.title = hint;
      }
      input.classList.toggle('read-only', !canWrite);
    });
  }

  lobbyUiInitialized = true;
  updateWriteControlsState();
  if (pendingSessionReload) {
    loadSessions();
    pendingSessionReload = false;
  }

  function refreshRoleInputsFromSchema({ preserveExisting = false } = {}) {
    const previousSnapshot = preserveExisting ? getRoleLayoutSnapshot() : null;
    const knownRoles = new Set([
      ...categorizedRoles.village,
      ...categorizedRoles.werwolf,
      ...categorizedRoles.special
    ]);
    rolesContainerVillage.innerHTML = "";
    rolesContainerWerwolf.innerHTML = "";
    rolesContainerSpecial.innerHTML = "";

    const applyCategory = (categoryKey, roleList, container) => {
      roleList.forEach((roleName) => {
        const qty = previousSnapshot && previousSnapshot[categoryKey]
          ? previousSnapshot[categoryKey][roleName] ?? 0
          : 0;
        addRoleRow(roleName, qty, container);
      });
    };

    applyCategory('village', categorizedRoles.village, rolesContainerVillage);
    applyCategory('werwolf', categorizedRoles.werwolf, rolesContainerWerwolf);
    applyCategory('special', categorizedRoles.special, rolesContainerSpecial);

    if (previousSnapshot) {
      ['village', 'werwolf', 'special'].forEach((categoryKey) => {
        const entries = previousSnapshot[categoryKey] || {};
        Object.keys(entries).forEach((roleName) => {
          if (!knownRoles.has(roleName)) {
            addRoleRow(roleName, entries[roleName] || 0, rolesContainerSpecial);
          }
        });
      });
    }
  }

  roleEditorStatusEl = document.getElementById('role-editor-status');
  roleEditorRolesEl = document.getElementById('role-editor-roles');
  roleEditorJobsEl = document.getElementById('role-editor-jobs');
  roleEditorNightListEl = document.getElementById('role-editor-night-list');
  roleEditorAddRoleBtn = document.getElementById('role-editor-add-role');
  roleEditorAddJobBtn = document.getElementById('role-editor-add-job');
  roleEditorAddNightStepBtn = document.getElementById('role-editor-add-night-step');
  roleEditorSaveBtn = document.getElementById('role-editor-save');
  roleEditorResetBtn = document.getElementById('role-editor-reset');

  roleEditorReady = Boolean(roleEditorRolesEl && roleEditorJobsEl && roleEditorNightListEl);
  roleEditorState = null;
  roleEditorDirty = false;
  const nightDragState = { draggingId: null };

  function ensureRoleEditorStateStructure() {
    if (!roleEditorState || typeof roleEditorState !== 'object') {
      roleEditorState = getRoleSchemaSnapshot();
    }
    if (!roleEditorState || typeof roleEditorState !== 'object') {
      roleEditorState = { version: roleSchema.version || 1, categories: roleSchema.categories.slice(), roles: [], jobs: [], night: { sequence: [] } };
    }
    if (!Array.isArray(roleEditorState.categories) || roleEditorState.categories.length === 0) {
      roleEditorState.categories = roleSchema.categories.slice();
    }
    if (!Array.isArray(roleEditorState.roles)) {
      roleEditorState.roles = [];
    }
    if (!Array.isArray(roleEditorState.jobs)) {
      roleEditorState.jobs = [];
    }
    if (!roleEditorState.night || typeof roleEditorState.night !== 'object') {
      roleEditorState.night = { sequence: [] };
    }
    if (!Array.isArray(roleEditorState.night.sequence)) {
      roleEditorState.night.sequence = [];
    }
  }

  function createRoleTemplate() {
    ensureRoleEditorStateStructure();
    return { name: '', category: 'special', description: '', abilities: [] };
  }

  function createJobTemplate() {
    ensureRoleEditorStateStructure();
    return { name: '', description: '', eligibleRoles: [] };
  }

  function createNightStepTemplate() {
    ensureRoleEditorStateStructure();
    const nextIndex = Array.isArray(roleEditorState?.night?.sequence)
      ? roleEditorState.night.sequence.length
      : 0;
    return {
      id: `Schritt ${nextIndex + 1}`,
      prompt: '',
      requires: { roles: [], jobs: [] },
      conditions: {},
      phase: 'night'
    };
  }

  function updateRoleEditorStatus() {
    if (roleEditorStatusEl) {
      const sourceText = roleSchemaSource === 'custom' ? 'Benutzerdefiniert' : 'Standard';
      roleEditorStatusEl.textContent = roleEditorDirty
        ? `Konfiguration: ${sourceText} – Änderungen nicht gespeichert`
        : `Konfiguration: ${sourceText}`;
    }
    if (roleEditorSaveBtn) {
      roleEditorSaveBtn.disabled = !roleEditorDirty;
    }
  }

  function markRoleEditorDirty() {
    if (!roleEditorReady) {
      return;
    }
    roleEditorDirty = true;
    updateRoleEditorStatus();
  }

  function renameRoleReferences(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return;
    }
    if (Array.isArray(roleEditorState?.jobs)) {
      roleEditorState.jobs.forEach((job) => {
        if (!Array.isArray(job.eligibleRoles)) {
          job.eligibleRoles = [];
          return;
        }
        job.eligibleRoles = job.eligibleRoles.map((roleName) => (roleName === oldName ? newName : roleName));
      });
    }
    if (Array.isArray(roleEditorState?.night?.sequence)) {
      roleEditorState.night.sequence.forEach((step) => {
        if (!Array.isArray(step?.requires?.roles)) {
          return;
        }
        step.requires.roles = step.requires.roles.map((roleName) => (roleName === oldName ? newName : roleName));
      });
    }
  }

  function renameJobReferences(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return;
    }
    if (Array.isArray(roleEditorState?.night?.sequence)) {
      roleEditorState.night.sequence.forEach((step) => {
        if (!Array.isArray(step?.requires?.jobs)) {
          return;
        }
        step.requires.jobs = step.requires.jobs.map((jobName) => (jobName === oldName ? newName : jobName));
      });
    }
  }

  function updateRoleJobSummaries() {
    if (!roleEditorReady || !roleEditorRolesEl) {
      return;
    }
    const jobMap = new Map();
    if (Array.isArray(roleEditorState?.jobs)) {
      roleEditorState.jobs.forEach((job) => {
        const jobName = job?.name || '';
        if (!jobName) {
          return;
        }
        const eligible = Array.isArray(job.eligibleRoles) ? job.eligibleRoles : [];
        eligible.forEach((roleName) => {
          if (!jobMap.has(roleName)) {
            jobMap.set(roleName, []);
          }
          jobMap.get(roleName).push(jobName);
        });
      });
    }
    roleEditorRolesEl.querySelectorAll('[data-role-summary]').forEach((summaryEl) => {
      const roleName = summaryEl.dataset.roleSummary || '';
      summaryEl.innerHTML = '';
      const jobs = jobMap.get(roleName) || [];
      if (jobs.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'admin-helper-text';
        hint.textContent = 'Keine Jobs';
        summaryEl.appendChild(hint);
        return;
      }
      jobs.forEach((jobName) => {
        const badge = document.createElement('span');
        const modifier = getJobClassModifier(jobName);
        badge.className = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
        badge.textContent = getJobDisplayName(jobName);
        summaryEl.appendChild(badge);
      });
    });
  }

  function renderRoleEditorRoles() {
    if (!roleEditorReady || !roleEditorRolesEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorRolesEl.innerHTML = '';
    const categoryOptions = [
      { value: 'village', label: 'Dorfbewohner' },
      { value: 'werwolf', label: 'Werwölfe' },
      { value: 'special', label: 'Sonderrollen' }
    ];
    const roles = Array.isArray(roleEditorState?.roles) ? roleEditorState.roles : [];
    roles.forEach((role, index) => {
      const card = document.createElement('div');
      card.className = 'role-editor-role';
      card.dataset.roleIndex = String(index);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Rollenname';
      nameInput.value = role?.name || '';
      nameInput.setAttribute('aria-label', `Rollenname ${index + 1}`);
      nameInput.dataset.previousValue = role?.name || '';
      const summaryEl = document.createElement('div');
      summaryEl.className = 'role-editor-role-jobs';
      summaryEl.dataset.roleSummary = role?.name || '';

      nameInput.addEventListener('focus', () => {
        nameInput.dataset.previousValue = role?.name || '';
      });
      nameInput.addEventListener('input', (event) => {
        role.name = event.target.value;
        summaryEl.dataset.roleSummary = event.target.value;
        markRoleEditorDirty();
        updateRoleEditorStatus();
      });
      nameInput.addEventListener('blur', () => {
        const previous = nameInput.dataset.previousValue || '';
        const normalized = nameInput.value.trim();
        if (normalized !== role.name) {
          role.name = normalized;
        }
        nameInput.value = normalized;
        summaryEl.dataset.roleSummary = normalized;
        if (previous && normalized && previous !== normalized) {
          renameRoleReferences(previous, normalized);
          renderRoleEditorJobs();
          renderRoleEditorNight();
        }
        updateRoleJobSummaries();
        updateRoleEditorStatus();
      });

      const categorySelect = document.createElement('select');
      categorySelect.setAttribute('aria-label', `Kategorie für ${role?.name || 'Rolle'}`);
      categoryOptions.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        if ((role?.category || 'special') === option.value) {
          opt.selected = true;
        }
        categorySelect.appendChild(opt);
      });
      categorySelect.addEventListener('change', (event) => {
        role.category = event.target.value;
        markRoleEditorDirty();
      });

      const descriptionTextarea = document.createElement('textarea');
      descriptionTextarea.placeholder = 'Beschreibung';
      descriptionTextarea.value = role?.description || '';
      descriptionTextarea.setAttribute('aria-label', `Beschreibung für ${role?.name || 'Rolle'}`);
      descriptionTextarea.addEventListener('input', (event) => {
        role.description = event.target.value;
        markRoleEditorDirty();
      });

      const abilityTextarea = document.createElement('textarea');
      abilityTextarea.placeholder = 'Fähigkeiten (eine pro Zeile)';
      abilityTextarea.value = Array.isArray(role?.abilities) ? role.abilities.join('\n') : '';
      abilityTextarea.setAttribute('aria-label', `Fähigkeiten für ${role?.name || 'Rolle'}`);
      abilityTextarea.addEventListener('input', (event) => {
        const lines = event.target.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        role.abilities = lines;
        markRoleEditorDirty();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Rolle entfernen';
      removeBtn.addEventListener('click', () => {
        const removed = roles.splice(index, 1)[0];
        if (removed && removed.name) {
          const name = removed.name;
          if (Array.isArray(roleEditorState?.jobs)) {
            roleEditorState.jobs.forEach((job) => {
              if (Array.isArray(job.eligibleRoles)) {
                job.eligibleRoles = job.eligibleRoles.filter((roleName) => roleName !== name);
              }
            });
          }
          if (Array.isArray(roleEditorState?.night?.sequence)) {
            roleEditorState.night.sequence.forEach((step) => {
              if (Array.isArray(step?.requires?.roles)) {
                step.requires.roles = step.requires.roles.filter((roleName) => roleName !== name);
              }
            });
          }
        }
        markRoleEditorDirty();
        renderRoleEditorRoles();
        renderRoleEditorJobs();
        renderRoleEditorNight();
        updateRoleJobSummaries();
      });

      card.appendChild(nameInput);
      card.appendChild(categorySelect);
      card.appendChild(descriptionTextarea);
      card.appendChild(abilityTextarea);
      card.appendChild(summaryEl);
      card.appendChild(removeBtn);

      roleEditorRolesEl.appendChild(card);
    });
    updateRoleJobSummaries();
  }

  function renderRoleEditorJobs() {
    if (!roleEditorReady || !roleEditorJobsEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorJobsEl.innerHTML = '';
    const jobs = Array.isArray(roleEditorState?.jobs) ? roleEditorState.jobs : [];
    const roleNames = Array.isArray(roleEditorState?.roles)
      ? roleEditorState.roles.map((role) => role?.name || '').filter((name) => name.length > 0)
      : [];

    jobs.forEach((job, index) => {
      const card = document.createElement('div');
      card.className = 'role-editor-job';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Jobname';
      nameInput.value = job?.name || '';
      nameInput.setAttribute('aria-label', `Jobname ${index + 1}`);
      nameInput.dataset.previousValue = job?.name || '';
      nameInput.addEventListener('focus', () => {
        nameInput.dataset.previousValue = job?.name || '';
      });
      nameInput.addEventListener('input', (event) => {
        job.name = event.target.value;
        markRoleEditorDirty();
      });
      nameInput.addEventListener('blur', () => {
        const previous = nameInput.dataset.previousValue || '';
        const normalized = nameInput.value.trim();
        job.name = normalized;
        nameInput.value = normalized;
        if (previous && normalized && previous !== normalized) {
          renameJobReferences(previous, normalized);
          renderRoleEditorNight();
        }
        updateRoleJobSummaries();
        updateRoleEditorStatus();
      });

      const descriptionTextarea = document.createElement('textarea');
      descriptionTextarea.placeholder = 'Beschreibung';
      descriptionTextarea.value = job?.description || '';
      descriptionTextarea.setAttribute('aria-label', `Beschreibung für ${job?.name || 'Job'}`);
      descriptionTextarea.addEventListener('input', (event) => {
        job.description = event.target.value;
        markRoleEditorDirty();
      });

      const targetsContainer = document.createElement('div');
      targetsContainer.className = 'role-editor-job-targets';
      roleNames.forEach((roleName) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Array.isArray(job?.eligibleRoles)
          ? job.eligibleRoles.includes(roleName)
          : false;
        checkbox.addEventListener('change', () => {
          if (!Array.isArray(job.eligibleRoles)) {
            job.eligibleRoles = [];
          }
          if (checkbox.checked) {
            if (!job.eligibleRoles.includes(roleName)) {
              job.eligibleRoles.push(roleName);
            }
          } else {
            job.eligibleRoles = job.eligibleRoles.filter((name) => name !== roleName);
          }
          markRoleEditorDirty();
          updateRoleJobSummaries();
        });
        label.appendChild(checkbox);
        const text = document.createElement('span');
        text.textContent = roleName;
        label.appendChild(text);
        targetsContainer.appendChild(label);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Job entfernen';
      removeBtn.addEventListener('click', () => {
        const removed = jobs.splice(index, 1)[0];
        if (removed && removed.name) {
          const jobName = removed.name;
          if (Array.isArray(roleEditorState?.night?.sequence)) {
            roleEditorState.night.sequence.forEach((step) => {
              if (Array.isArray(step?.requires?.jobs)) {
                step.requires.jobs = step.requires.jobs.filter((name) => name !== jobName);
              }
            });
          }
        }
        markRoleEditorDirty();
        renderRoleEditorJobs();
        renderRoleEditorNight();
        updateRoleJobSummaries();
      });

      card.appendChild(nameInput);
      card.appendChild(descriptionTextarea);
      card.appendChild(targetsContainer);
      card.appendChild(removeBtn);

      roleEditorJobsEl.appendChild(card);
    });
    updateRoleJobSummaries();
  }

  function getNightStepDragAfterElement(y) {
    const elements = Array.from(roleEditorNightListEl.querySelectorAll('.role-editor-step:not(.dragging)'));
    return elements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function syncNightStepOrderFromDom() {
    if (!roleEditorReady || !roleEditorNightListEl) {
      return;
    }
    const orderedIds = Array.from(roleEditorNightListEl.querySelectorAll('.role-editor-step'))
      .map((item) => item.dataset.stepId)
      .filter((id) => id);
    if (!Array.isArray(roleEditorState?.night?.sequence)) {
      return;
    }
    const lookup = new Map();
    roleEditorState.night.sequence.forEach((step) => {
      lookup.set(step.id, step);
    });
    roleEditorState.night.sequence = orderedIds
      .map((id) => lookup.get(id))
      .filter((step) => step);
  }

  function renderRoleEditorNight() {
    if (!roleEditorReady || !roleEditorNightListEl) {
      return;
    }
    ensureRoleEditorStateStructure();
    roleEditorNightListEl.innerHTML = '';
    const steps = Array.isArray(roleEditorState?.night?.sequence)
      ? roleEditorState.night.sequence
      : [];
    const availableRoles = Array.isArray(roleEditorState?.roles)
      ? roleEditorState.roles.map((role) => role?.name || '').filter((name) => name.length > 0)
      : [];
    const availableJobs = Array.isArray(roleEditorState?.jobs)
      ? roleEditorState.jobs.map((job) => job?.name || '').filter((name) => name.length > 0)
      : [];

    steps.forEach((step, index) => {
      if (!step.requires) {
        step.requires = { roles: [], jobs: [] };
      } else {
        step.requires.roles = Array.isArray(step.requires.roles) ? step.requires.roles : [];
        step.requires.jobs = Array.isArray(step.requires.jobs) ? step.requires.jobs : [];
      }
      if (!step.conditions || typeof step.conditions !== 'object') {
        step.conditions = {};
      }

      if (!step.id || !step.id.trim()) {
        step.id = `Schritt ${index + 1}`;
      }

      const item = document.createElement('li');
      item.className = 'role-editor-step';
      item.draggable = true;
      item.dataset.stepId = step.id;

      item.addEventListener('dragstart', (event) => {
        nightDragState.draggingId = step.id;
        item.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          try {
            event.dataTransfer.setData('text/plain', step.id);
          } catch (error) {
            // Ignored – some browsers restrict setData during dragstart for certain mime types.
          }
        }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        nightDragState.draggingId = null;
        syncNightStepOrderFromDom();
        markRoleEditorDirty();
      });

      const header = document.createElement('div');
      header.className = 'role-editor-step-header';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.textContent = '☰';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Schrittname';
      nameInput.value = step.id || '';
      nameInput.setAttribute('aria-label', `Schrittname ${index + 1}`);
      nameInput.addEventListener('input', (event) => {
        step.id = event.target.value;
        item.dataset.stepId = event.target.value;
        markRoleEditorDirty();
      });
      nameInput.addEventListener('blur', () => {
        const normalized = nameInput.value.trim() || `Schritt ${index + 1}`;
        step.id = normalized;
        nameInput.value = normalized;
        item.dataset.stepId = normalized;
        markRoleEditorDirty();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary-btn small-btn';
      removeBtn.textContent = 'Schritt entfernen';
      removeBtn.addEventListener('click', () => {
        steps.splice(index, 1);
        markRoleEditorDirty();
        renderRoleEditorNight();
      });

      header.appendChild(dragHandle);
      header.appendChild(nameInput);
      header.appendChild(removeBtn);

      const promptTextarea = document.createElement('textarea');
      promptTextarea.placeholder = 'Ansagetext für diesen Schritt';
      promptTextarea.value = step.prompt || '';
      promptTextarea.setAttribute('aria-label', `Ansagetext ${index + 1}`);
      promptTextarea.addEventListener('input', (event) => {
        step.prompt = event.target.value;
        markRoleEditorDirty();
      });

      const rolesContainer = document.createElement('div');
      rolesContainer.className = 'role-editor-job-targets';
      if (availableRoles.length > 0) {
        availableRoles.forEach((roleName) => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = step.requires.roles.includes(roleName);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (!step.requires.roles.includes(roleName)) {
                step.requires.roles.push(roleName);
              }
            } else {
              step.requires.roles = step.requires.roles.filter((name) => name !== roleName);
            }
            markRoleEditorDirty();
          });
          const text = document.createElement('span');
          text.textContent = roleName;
          label.appendChild(checkbox);
          label.appendChild(text);
          rolesContainer.appendChild(label);
        });
      }

      const jobsContainer = document.createElement('div');
      jobsContainer.className = 'role-editor-job-targets';
      if (availableJobs.length > 0) {
        availableJobs.forEach((jobName) => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = step.requires.jobs.includes(jobName);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (!step.requires.jobs.includes(jobName)) {
                step.requires.jobs.push(jobName);
              }
            } else {
              step.requires.jobs = step.requires.jobs.filter((name) => name !== jobName);
            }
            markRoleEditorDirty();
          });
          const text = document.createElement('span');
          text.textContent = jobName;
          label.appendChild(checkbox);
          label.appendChild(text);
          jobsContainer.appendChild(label);
        });
      }

      const conditionsContainer = document.createElement('div');
      conditionsContainer.className = 'role-editor-conditions';

      const firstNightLabel = document.createElement('label');
      const firstNightCheckbox = document.createElement('input');
      firstNightCheckbox.type = 'checkbox';
      firstNightCheckbox.checked = Boolean(step.conditions.firstNightOnly);
      firstNightCheckbox.addEventListener('change', () => {
        step.conditions.firstNightOnly = firstNightCheckbox.checked;
        if (!firstNightCheckbox.checked) {
          delete step.conditions.firstNightOnly;
        }
        markRoleEditorDirty();
      });
      firstNightLabel.appendChild(firstNightCheckbox);
      const firstNightText = document.createElement('span');
      firstNightText.textContent = 'Nur in der ersten Nacht';
      firstNightLabel.appendChild(firstNightText);
      conditionsContainer.appendChild(firstNightLabel);

      const doctorLabel = document.createElement('label');
      const doctorCheckbox = document.createElement('input');
      doctorCheckbox.type = 'checkbox';
      doctorCheckbox.checked = Boolean(step.conditions.requiresDoctorTargets);
      doctorCheckbox.addEventListener('change', () => {
        step.conditions.requiresDoctorTargets = doctorCheckbox.checked;
        if (!doctorCheckbox.checked) {
          delete step.conditions.requiresDoctorTargets;
        }
        markRoleEditorDirty();
      });
      doctorLabel.appendChild(doctorCheckbox);
      const doctorText = document.createElement('span');
      doctorText.textContent = 'Nur mit Arztzielen';
      doctorLabel.appendChild(doctorText);
      conditionsContainer.appendChild(doctorLabel);

      item.appendChild(header);
      item.appendChild(promptTextarea);
      if (availableRoles.length > 0) {
        item.appendChild(rolesContainer);
      }
      if (availableJobs.length > 0) {
        item.appendChild(jobsContainer);
      }
      item.appendChild(conditionsContainer);

      roleEditorNightListEl.appendChild(item);
    });

    if (steps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'role-editor-night-empty';
      empty.textContent = 'Keine Nachtaktionen definiert.';
      roleEditorNightListEl.appendChild(empty);
    }
  }

  function buildRoleEditorConfigFromState() {
    ensureRoleEditorStateStructure();
    const errors = [];

    const categoriesSource = Array.isArray(roleEditorState.categories) && roleEditorState.categories.length > 0
      ? roleEditorState.categories
      : roleSchema.categories;

    const categories = Array.isArray(categoriesSource)
      ? categoriesSource
          .map((category) => {
            if (typeof category === 'string') {
              return { id: category.trim(), label: category.trim() };
            }
            const id = typeof category?.id === 'string' ? category.id.trim() : '';
            const label = typeof category?.label === 'string' && category.label.trim().length > 0
              ? category.label.trim()
              : (typeof category?.id === 'string' ? category.id.trim() : '');
            return id ? { id, label } : null;
          })
          .filter(Boolean)
      : [];

    if (categories.length === 0) {
      categories.push({ id: 'village', label: 'Dorfbewohner' });
      categories.push({ id: 'werwolf', label: 'Werwölfe' });
      categories.push({ id: 'special', label: 'Sonderrollen' });
    }

    const validCategoryIds = new Set(categories.map((category) => category.id));
    const defaultCategory = categories[0]?.id || 'special';

    const normalizedRoles = [];
    const seenRoleKeys = new Set();
    const abilityDeduper = (entries) => {
      const seen = new Set();
      const result = [];
      entries.forEach((entry) => {
        const trimmed = typeof entry === 'string' ? entry.trim() : '';
        if (!trimmed) {
          return;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        result.push(trimmed);
      });
      return result;
    };

    roleEditorState.roles.forEach((role) => {
      const name = typeof role?.name === 'string' ? role.name.trim() : '';
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (seenRoleKeys.has(key)) {
        errors.push(`Rolle „${name}“ ist mehrfach vorhanden.`);
        return;
      }
      seenRoleKeys.add(key);

      const category = validCategoryIds.has(role?.category) ? role.category : defaultCategory;
      const description = typeof role?.description === 'string' ? role.description.trim() : '';
      const abilities = Array.isArray(role?.abilities) ? abilityDeduper(role.abilities) : [];
      normalizedRoles.push({ name, category, description, abilities });
    });

    if (normalizedRoles.length === 0) {
      errors.push('Mindestens eine Rolle muss definiert sein.');
    }

    const roleNameSet = new Set(normalizedRoles.map((role) => role.name.toLowerCase()));

    const normalizedJobs = [];
    const seenJobKeys = new Set();
    roleEditorState.jobs.forEach((job) => {
      const name = typeof job?.name === 'string' ? job.name.trim() : '';
      if (!name) {
        return;
      }
      const key = name.toLowerCase();
      if (seenJobKeys.has(key)) {
        errors.push(`Job „${name}“ ist mehrfach vorhanden.`);
        return;
      }
      seenJobKeys.add(key);

      const description = typeof job?.description === 'string' ? job.description.trim() : '';
      const eligibleRolesRaw = Array.isArray(job?.eligibleRoles) ? job.eligibleRoles : [];
      const eligibleSet = new Set();
      const eligibleRoles = [];
      eligibleRolesRaw.forEach((roleName) => {
        const trimmed = typeof roleName === 'string' ? roleName.trim() : '';
        if (!trimmed) {
          return;
        }
        const keyName = trimmed.toLowerCase();
        if (!roleNameSet.has(keyName) || eligibleSet.has(keyName)) {
          return;
        }
        eligibleSet.add(keyName);
        eligibleRoles.push(trimmed);
      });
      normalizedJobs.push({ name, description, eligibleRoles });
    });

    const jobNameSet = new Set(normalizedJobs.map((job) => job.name.toLowerCase()));

    const normalizedSteps = [];
    const seenStepIds = new Map();

    const steps = Array.isArray(roleEditorState.night.sequence)
      ? roleEditorState.night.sequence
      : [];

    steps.forEach((step, index) => {
      const rawId = typeof step?.id === 'string' ? step.id.trim() : '';
      const baseId = rawId || `Schritt ${index + 1}`;
      let normalizedId = baseId;
      let suffix = 2;
      while (seenStepIds.has(normalizedId.toLowerCase())) {
        normalizedId = `${baseId} (${suffix})`;
        suffix += 1;
      }
      seenStepIds.set(normalizedId.toLowerCase(), true);

      const prompt = typeof step?.prompt === 'string' ? step.prompt.trim() : '';

      const requiresRoles = Array.isArray(step?.requires?.roles)
        ? step.requires.roles
            .map((roleName) => typeof roleName === 'string' ? roleName.trim() : '')
            .filter((roleName, idx, arr) => roleName.length > 0
              && roleNameSet.has(roleName.toLowerCase())
              && arr.indexOf(roleName) === idx)
        : [];

      const requiresJobs = Array.isArray(step?.requires?.jobs)
        ? step.requires.jobs
            .map((jobName) => typeof jobName === 'string' ? jobName.trim() : '')
            .filter((jobName, idx, arr) => jobName.length > 0
              && jobNameSet.has(jobName.toLowerCase())
              && arr.indexOf(jobName) === idx)
        : [];

      const phase = typeof step?.phase === 'string' && step.phase.trim().length > 0
        ? step.phase.trim()
        : 'night';

      const conditions = {};
      if (step?.conditions && typeof step.conditions === 'object') {
        if (step.conditions.firstNightOnly) {
          conditions.firstNightOnly = true;
        }
        if (step.conditions.requiresDoctorTargets) {
          conditions.requiresDoctorTargets = true;
        }
      }

      normalizedSteps.push({
        id: normalizedId,
        prompt,
        requires: { roles: requiresRoles, jobs: requiresJobs },
        phase,
        conditions
      });
    });

    const version = Number.isFinite(Number(roleEditorState.version))
      ? Number(roleEditorState.version)
      : (Number.isFinite(Number(roleSchema.version)) ? Number(roleSchema.version) : 1);

    return {
      config: {
        version,
        categories,
        roles: normalizedRoles,
        jobs: normalizedJobs,
        night: { sequence: normalizedSteps }
      },
      errors
    };
  }

  if (roleEditorNightListEl) {
    roleEditorNightListEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      const afterElement = getNightStepDragAfterElement(event.clientY);
      const draggable = roleEditorNightListEl.querySelector('.role-editor-step.dragging');
      if (!draggable) {
        return;
      }
      if (!afterElement) {
        roleEditorNightListEl.appendChild(draggable);
      } else {
        roleEditorNightListEl.insertBefore(draggable, afterElement);
      }
    });

    roleEditorNightListEl.addEventListener('drop', (event) => {
      event.preventDefault();
      syncNightStepOrderFromDom();
      markRoleEditorDirty();
    });
  }

  async function saveRoleEditorConfig() {
    ensureRoleEditorStateStructure();
    const { config, errors } = buildRoleEditorConfigFromState();
    if (errors.length > 0) {
      const list = errors.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
      showInfoMessage({
        title: 'Speichern nicht möglich',
        html: `<p>Bitte behebe folgende Probleme:</p><ul>${list}</ul>`,
        confirmText: 'Okay',
        log: { type: 'error', label: 'Rollenkonfiguration ungültig', detail: errors.join(' | ') }
      });
      return;
    }

    await withButtonLoading(roleEditorSaveBtn, 'Speichere …', async () => {
      try {
        const response = await apiClient.rolesConfig.set(config);
        const nextConfig = response?.config || config;
        const source = response?.source || 'custom';
        roleSchemaSource = source;
        applyRoleSchema(nextConfig);
        refreshRoleInputsFromSchema({ preserveExisting: false });
        lastSuggestionSnapshot = null;
        roleLayoutCustomized = false;
        renderNarratorDashboard();
        roleEditorDirty = false;
        updateRoleEditorStatus();
        showInfoMessage({
          title: 'Konfiguration gespeichert',
          text: 'Die Rollen- und Nachtabfolge wurde übernommen.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Rollenkonfiguration gespeichert', detail: `Quelle: ${source === 'custom' ? 'Benutzerdefiniert' : 'Standard'}` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Rollenkonfiguration konnte nicht gespeichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Rollenkonfiguration speichern fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  }

  async function resetRoleEditorConfig() {
    await withButtonLoading(roleEditorResetBtn, 'Setze zurück …', async () => {
      try {
        await apiClient.rolesConfig.reset();
        const { config, source } = await apiClient.rolesConfig.get();
        if (config) {
          roleSchemaSource = source || 'default';
          applyRoleSchema(config);
        } else {
          roleSchemaSource = 'default';
          const fallback = await loadFallbackRoleSchema();
          if (fallback) {
            applyRoleSchema(fallback);
          }
        }
        refreshRoleInputsFromSchema({ preserveExisting: false });
        lastSuggestionSnapshot = null;
        roleLayoutCustomized = false;
        renderNarratorDashboard();
        roleEditorDirty = false;
        updateRoleEditorStatus();
        showInfoMessage({
          title: 'Standard wiederhergestellt',
          text: 'Die ursprüngliche Rollenkonfiguration wurde geladen.',
          confirmText: 'Okay',
          log: { type: 'warning', label: 'Rollenkonfiguration zurückgesetzt', detail: 'Zurück zum Standardprofil gewechselt.' }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Zurücksetzen fehlgeschlagen',
          text: 'Die Rollenkonfiguration konnte nicht zurückgesetzt werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Rollenkonfiguration zurücksetzen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  }

  if (roleEditorAddRoleBtn) {
    roleEditorAddRoleBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.roles.push(createRoleTemplate());
      markRoleEditorDirty();
      renderRoleEditorRoles();
      renderRoleEditorJobs();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorAddJobBtn) {
    roleEditorAddJobBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.jobs.push(createJobTemplate());
      markRoleEditorDirty();
      renderRoleEditorJobs();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorAddNightStepBtn) {
    roleEditorAddNightStepBtn.addEventListener('click', () => {
      ensureRoleEditorStateStructure();
      roleEditorState.night.sequence.push(createNightStepTemplate());
      markRoleEditorDirty();
      renderRoleEditorNight();
      updateRoleEditorStatus();
    });
  }

  if (roleEditorSaveBtn) {
    roleEditorSaveBtn.addEventListener('click', () => {
      saveRoleEditorConfig();
    });
  }

  if (roleEditorResetBtn) {
    roleEditorResetBtn.addEventListener('click', () => {
      showConfirmation({
        title: 'Standard wiederherstellen?',
        text: 'Alle Änderungen gehen verloren. Fortfahren?',
        confirmText: 'Zurücksetzen',
        cancelText: 'Abbrechen',
        focus: 'cancel',
        onConfirm: () => {
          void resetRoleEditorConfig();
        },
        logOnConfirm: { type: 'warning', label: 'Rollenkonfiguration zurücksetzen bestätigt', detail: 'Zurücksetzen angestoßen.' }
      });
    });
  }

  if (roleEditorReady) {
    ensureRoleEditorStateStructure();
    renderRoleEditorRoles();
    renderRoleEditorJobs();
    renderRoleEditorNight();
    updateRoleEditorStatus();
  }

  const roleSuggestions = {
    4: { Dorfbewohner: 2, Werwolf: 1, Seer: 1 },
    5: { Dorfbewohner: 2, Werwolf: 1, Seer: 1, Hexe: 1 },
    6: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1 },
    7: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1, Amor: 1 },
    8: { Dorfbewohner: 2, Werwolf: 2, Seer: 1, Hexe: 1, Amor: 1, Jäger: 1 },
  };

  function applyRoleSuggestion(count, { forceOverwrite = false } = {}) {
    const suggestion = roleSuggestions[count] || {};
    const suggestionSnapshot = buildSuggestionSnapshot(suggestion);
    const previousSuggestionSnapshot = lastSuggestionSnapshot;
    const currentSnapshot = getRoleLayoutSnapshot();
    const matchesLast = previousSuggestionSnapshot && snapshotsEqual(currentSnapshot, previousSuggestionSnapshot);

    if (matchesLast) {
      roleLayoutCustomized = false;
    }

    const shouldOverwrite = forceOverwrite || !roleLayoutCustomized;

    if (shouldOverwrite) {
      suppressCustomizationTracking = true;
      try {
        refreshRoleInputsFromSchema({ preserveExisting: false });
        Object.entries(suggestion).forEach(([roleName, qty]) => {
          const row = findRoleRow(rolesContainerVillage, roleName)
            || findRoleRow(rolesContainerWerwolf, roleName)
            || findRoleRow(rolesContainerSpecial, roleName);
          if (row) {
            setRowQuantity(row, qty);
          }
        });
      } finally {
        suppressCustomizationTracking = false;
      }

      lastSuggestionSnapshot = suggestionSnapshot;
      roleLayoutCustomized = false;
      return;
    }

    const mergeCategory = (categoryKey, rolesList, container) => {
      rolesList.forEach((roleName) => {
        const desiredQty = suggestion[roleName] || 0;
        const previousQty = previousSuggestionSnapshot && previousSuggestionSnapshot[categoryKey]
          ? previousSuggestionSnapshot[categoryKey][roleName]
          : undefined;
        const currentQty = currentSnapshot[categoryKey]
          ? currentSnapshot[categoryKey][roleName]
          : undefined;
        const row = findRoleRow(container, roleName);

        if (!row) {
          return;
        }

        if (typeof previousQty === 'number' && currentQty === previousQty) {
          setRowQuantity(row, desiredQty);
        }
      });
    };

    suppressCustomizationTracking = true;
    try {
      mergeCategory("village", categorizedRoles.village, rolesContainerVillage);
      mergeCategory("werwolf", categorizedRoles.werwolf, rolesContainerWerwolf);
      mergeCategory("special", categorizedRoles.special, rolesContainerSpecial);
    } finally {
      suppressCustomizationTracking = false;
    }

    lastSuggestionSnapshot = suggestionSnapshot;
  }

  playersTextarea.addEventListener("input", () => {
    if (isLoadingLastUsed) return;
    const count = playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length;
    const matchesDefaultLayout = layoutMatchesLastSuggestion();
    const forceOverwrite = matchesDefaultLayout || !roleLayoutCustomized;
    applyRoleSuggestion(count, { forceOverwrite });
  });

  // Initial role setup
  refreshRoleInputsFromSchema({ preserveExisting: false });

  // Apply suggestion once on load (if players already entered)
  applyRoleSuggestion(
    playersTextarea.value
      .split(/\n|\r/)
      .map((n) => n.trim())
      .filter(Boolean).length
  );

  // Save names to backend
  saveNamesBtn.addEventListener("click", async () => {
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
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

    await withButtonLoading(saveNamesBtn, 'Speichere …', async () => {
      try {
        await apiClient.savedNames.set(names);
        showInfoMessage({
          title: 'Namen gespeichert',
          text: 'Alle Spielernamen wurden gesichert.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Namen gespeichert', detail: `${names.length} Namen abgelegt.` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Namen konnten nicht gesichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Speichern der Namen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Load names from backend
  loadNamesBtn.addEventListener("click", async () => {
    await withButtonLoading(loadNamesBtn, 'Lade …', async () => {
      try {
        const names = await apiClient.savedNames.get();
        if (!Array.isArray(names) || names.length === 0) {
          showInfoMessage({
            title: 'Keine gespeicherten Namen',
            text: 'Es wurden noch keine Namen gesichert.',
            confirmText: 'Okay',
            log: { type: 'info', label: 'Keine gespeicherten Namen', detail: 'Backend ohne gespeicherte Einträge.' }
          });
          return;
        }
        playersTextarea.value = names.join("\n");
        playersTextarea.dispatchEvent(new Event("input"));
      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der Namen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der Namen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Save roles to backend
  saveRolesBtn.addEventListener("click", async () => {
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
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
    await withButtonLoading(saveRolesBtn, 'Speichere …', async () => {
      try {
        await apiClient.rolePresets.set(roleSetup);
        showInfoMessage({
          title: 'Rollen gespeichert',
          text: 'Die aktuelle Rollenverteilung wurde gesichert.',
          confirmText: 'Okay',
          log: { type: 'info', label: 'Rollen gespeichert', detail: `${roleSetup.length} Rolleneinträge gespeichert.` }
        });
      } catch (error) {
        showInfoMessage({
          title: 'Speichern fehlgeschlagen',
          text: 'Die Rollen konnten nicht gesichert werden.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Speichern der Rollen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  // Load roles from backend
  loadRolesBtn.addEventListener("click", async () => {
    await withButtonLoading(loadRolesBtn, 'Lade …', async () => {
      try {
        const savedRoles = await apiClient.rolePresets.get();
        if (!Array.isArray(savedRoles) || savedRoles.length === 0) {
          showInfoMessage({
            title: 'Keine gespeicherten Rollen',
            text: 'Es wurden noch keine Rollen gesichert.',
            confirmText: 'Okay',
            log: { type: 'info', label: 'Keine gespeicherten Rollen', detail: 'Backend ohne Rollendaten.' }
          });
          return;
        }

      refreshRoleInputsFromSchema({ preserveExisting: false });

      savedRoles.forEach((role) => {
        if (!role || typeof role.name !== 'string') {
          return;
        }
        const quantity = Number.isFinite(role.quantity) ? role.quantity : 0;
        let row = findRoleRow(rolesContainerVillage, role.name)
          || findRoleRow(rolesContainerWerwolf, role.name)
          || findRoleRow(rolesContainerSpecial, role.name);
        if (!row) {
          if (categorizedRoles.village.includes(role.name)) {
            addRoleRow(role.name, quantity, rolesContainerVillage);
          } else if (categorizedRoles.werwolf.includes(role.name)) {
            addRoleRow(role.name, quantity, rolesContainerWerwolf);
          } else {
            addRoleRow(role.name, quantity, rolesContainerSpecial);
          }
          row = findRoleRow(rolesContainerVillage, role.name)
            || findRoleRow(rolesContainerWerwolf, role.name)
            || findRoleRow(rolesContainerSpecial, role.name);
        }
        if (row) {
          setRowQuantity(row, quantity);
        }
      });

      lastSuggestionSnapshot = null;
      roleLayoutCustomized = true;

      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der Rollen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der Rollen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      }
    });
  });

  loadLastUsedBtn.addEventListener("click", async () => {
    await withButtonLoading(loadLastUsedBtn, 'Lade …', async () => {
      const data = await refreshPersistedValue('werwolfLastUsed');
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

      refreshRoleInputsFromSchema({ preserveExisting: false });

      let legacyBodyguardRole = false;
      lastUsed.roles.forEach(role => {
        if (!role || typeof role.name !== 'string') {
          return;
        }
        const qty = Number.isFinite(role.quantity) ? role.quantity : 0;
        const roleName = role.name === 'Bodyguard' ? 'Dorfbewohner' : role.name;
        if (role.name === 'Bodyguard') {
          legacyBodyguardRole = true;
        }
        let row = findRoleRow(rolesContainerVillage, roleName)
          || findRoleRow(rolesContainerWerwolf, roleName)
          || findRoleRow(rolesContainerSpecial, roleName);
        if (!row) {
          if (categorizedRoles.village.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerVillage);
          } else if (categorizedRoles.werwolf.includes(roleName)) {
            addRoleRow(roleName, qty, rolesContainerWerwolf);
          } else {
            addRoleRow(roleName, qty, rolesContainerSpecial);
          }
          row = findRoleRow(rolesContainerVillage, roleName)
            || findRoleRow(rolesContainerWerwolf, roleName)
            || findRoleRow(rolesContainerSpecial, roleName);
        }
        if (row) {
          setRowQuantity(row, qty);
        }
      });

      if (lastUsed.jobConfig && typeof lastUsed.jobConfig.bodyguardChance === 'number') {
        jobConfig.bodyguardChance = Math.min(Math.max(lastUsed.jobConfig.bodyguardChance, 0), 1);
        updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
      } else if (legacyBodyguardRole) {
        jobConfig.bodyguardChance = 1;
        updateBodyguardChanceUI(100, { save: true });
      }
      if (lastUsed.jobConfig && typeof lastUsed.jobConfig.doctorChance === 'number') {
        jobConfig.doctorChance = Math.min(Math.max(lastUsed.jobConfig.doctorChance, 0), 1);
        updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
      } else if (!lastUsed.jobConfig || typeof lastUsed.jobConfig.doctorChance !== 'number') {
        jobConfig.doctorChance = defaultJobConfig.doctorChance;
        updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
      }

      lastSuggestionSnapshot = null;
      roleLayoutCustomized = true;

      } catch (error) {
        showInfoMessage({
          title: 'Laden fehlgeschlagen',
          text: 'Fehler beim Laden der zuletzt benutzten Optionen.',
          confirmText: 'Okay',
          log: { type: 'error', label: 'Fehler beim Laden der zuletzt benutzten Optionen', detail: error?.message || 'Unbekannter Fehler.' }
        });
      } finally {
        isLoadingLastUsed = false;
      }
    });
  });


  addRoleBtn.addEventListener("click", () => {
    addRoleRow("", 1, rolesContainerSpecial);
    markLayoutCustomized();
  });

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
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      eventEngineState: getEventEngineSnapshot()
    };
    persistValue('werwolfLastUsed', JSON.stringify(lastUsedOptions));

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
        phaseTimerManager.cancelAll();
        phaseTimerManager.resetHistory();
        resetTimerEventHistory();
        actionLog.length = 0;
        undoStack.length = 0;
        redoStack.length = 0;
        actionSequenceCounter = 0;
        checkpointCounter = 0;
        updateTimelineUI();
        updateUndoHistoryUI();
        lastWinner = null;

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
        doctorPlayers = [];
        doctorPendingTargets = [];
        doctorPendingNight = null;
        doctorTriggerSourceNight = null;
        doctorLastHealedTarget = null;
        doctorLastHealedNight = null;
        firstNightShieldUsed = false;
        initializeMichaelJacksonAccusations();

        assignBodyguardJobByChance();
        assignDoctorJobByChance();

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
        updateDoctorPlayers();

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
        hideRevealControls();
        revealGrid.innerHTML = ''; // Clear previous cards
        revealCards = new Array(players.length);
        revealCurrentPlayerHasFlipped = false;
        currentlyFlippedCard = null;

        players.forEach((player, index) => {
          const card = document.createElement('div');
          card.className = 'reveal-card';
          card.dataset.playerIndex = String(index);
          card.style.animationDelay = `${index * 0.05}s`;
          if (deadPlayers.includes(player)) {
            card.classList.add('dead');
          }
          card.onclick = () => {
            if (revealTurnIndex < 0 || revealTurnOrder[revealTurnIndex] !== index) {
              return;
            }
            if (currentlyFlippedCard && currentlyFlippedCard !== card) {
              currentlyFlippedCard.classList.remove('flipped');
            }
            card.classList.toggle('flipped');
            const isFlipped = card.classList.contains('flipped');
            currentlyFlippedCard = isFlipped ? card : null;
            revealCurrentPlayerHasFlipped = isFlipped;
            refreshRevealControls();
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
          if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
            roleNameEl.classList.add('long-text');
          }
          renderRoleWithJobs(roleNameEl, role, jobs);
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
          revealCards[index] = card;
        });

        const revealOrder = players.map((_, idx) => idx);
        shuffleArray(revealOrder);
        setRevealTurnOrder(revealOrder);

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

    const canonicalRole = typeof role === 'string' ? role : '';
    const fallbackRoleLabel = localization.t('roles.info.unknown') || 'Unbekannte Rolle';
    const normalizedRole = localization.getRoleDisplayName(canonicalRole) || canonicalRole || fallbackRoleLabel;
    const jobListRaw = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const jobDisplayList = jobListRaw
      .map((job) => localization.getJobDisplayName(job) || getJobDisplayName(job))
      .filter(Boolean);
    const titleText = jobDisplayList.length
      ? `${normalizedRole} (${jobDisplayList.join(' + ')})`
      : normalizedRole;

    title.textContent = titleText;

    const baseDescription = localization.getRoleDescription(canonicalRole)
      || roleDescriptions[canonicalRole]
      || roleDescriptions[normalizedRole]
      || localization.t('roles.info.noDescription')
      || 'Keine Beschreibung für diese Rolle verfügbar.';
    const localizedAbilities = localization.getRoleAbilities(canonicalRole);
    const abilities = Array.isArray(localizedAbilities) && localizedAbilities.length > 0
      ? localizedAbilities
      : getRoleAbilities(canonicalRole);

    const descriptionHtml = `<p>${escapeHtml(baseDescription)}</p>`;

    const abilityTitle = localization.t('roles.info.abilitiesTitle') || 'Fähigkeiten';
    const abilityHtml = Array.isArray(abilities) && abilities.length > 0
      ? `<div><span class="role-info-section-title">${escapeHtml(abilityTitle)}</span><ul class="role-info-abilities">${abilities
          .map((ability) => `<li>${escapeHtml(ability)}</li>`)
          .join('')}</ul></div>`
      : '';

    const jobHtmlEntries = jobListRaw
      .map((job) => {
        const label = localization.getJobDisplayName(job) || getJobDisplayName(job);
        if (!label) {
          return '';
        }
        const modifier = getJobClassModifier(job);
        const badgeClass = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
        const badgeHtml = `<span class="${badgeClass}">${escapeHtml(label)}</span>`;
        const description = localization.getJobDescription(job) || jobDescriptions[job];
        const descriptionHtml = description ? `<span class="job-description-text">${escapeHtml(description)}</span>` : '';
        return `<span class="job-description">${badgeHtml}${descriptionHtml}</span>`;
      })
      .filter(Boolean)
      .join('');

    const jobsTitle = localization.t('roles.info.jobsTitle') || 'Jobs';
    const jobsHtml = jobHtmlEntries
      ? `<div><span class="role-info-section-title">${escapeHtml(jobsTitle)}</span><div class="role-info-jobs">${jobHtmlEntries}</div></div>`
      : '';

    desc.innerHTML = `${descriptionHtml}${abilityHtml}${jobsHtml}`;

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

  function hideRevealControls() {
    revealCards.forEach((card) => {
      if (card) {
        card.classList.remove('reveal-disabled', 'active');
      }
    });
    revealTurnOrder = [];
    revealTurnIndex = -1;
    revealCards = [];
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;
    if (revealControlsEl) {
      revealControlsEl.style.display = 'none';
    }
    if (currentRevealPlayerEl) {
      currentRevealPlayerEl.textContent = '';
    }
    if (revealNextBtn) {
      revealNextBtn.disabled = true;
      revealNextBtn.style.display = '';
    }
  }

  function updateRevealCardStates() {
    const hasActive = revealTurnIndex >= 0 && revealTurnIndex < revealTurnOrder.length;
    revealCards.forEach((card, index) => {
      if (!card) {
        return;
      }
      const isCurrent = hasActive && revealTurnOrder[revealTurnIndex] === index;
      if (card.classList.contains('dead')) {
        card.classList.remove('reveal-disabled');
      } else {
        card.classList.toggle('reveal-disabled', !isCurrent);
      }
      card.classList.toggle('active', isCurrent);
    });
  }

  function refreshRevealControls() {
    if (!revealControlsEl) {
      return;
    }
    if (revealTurnIndex < 0 || revealTurnIndex >= revealTurnOrder.length) {
      hideRevealControls();
      return;
    }

    revealControlsEl.style.display = 'flex';
    const currentPlayerIndex = revealTurnOrder[revealTurnIndex];
    const playerName = players[currentPlayerIndex] || '';
    const isLast = revealTurnIndex === revealTurnOrder.length - 1;

    if (currentRevealPlayerEl) {
      if (!playerName) {
        currentRevealPlayerEl.textContent = 'Aktueller Spieler unbekannt';
      } else if (isLast) {
        currentRevealPlayerEl.textContent = `Letzter Spieler: ${playerName} – danach den Laptop an den Erzähler geben`;
      } else {
        currentRevealPlayerEl.textContent = `Aktueller Spieler: ${playerName}`;
      }
    }

    if (revealNextBtn) {
      if (isLast) {
        revealNextBtn.style.display = 'none';
        revealNextBtn.disabled = true;
      } else {
        revealNextBtn.style.display = '';
        revealNextBtn.disabled = !revealCurrentPlayerHasFlipped;
      }
    }

    updateRevealCardStates();
  }

  function setRevealTurnOrder(order) {
    if (!Array.isArray(order) || order.length === 0) {
      hideRevealControls();
      return;
    }

    revealTurnOrder = order.slice();
    revealTurnIndex = 0;
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;
    refreshRevealControls();
  }

  function advanceRevealTurn() {
    if (revealTurnIndex < 0 || revealTurnIndex >= revealTurnOrder.length - 1) {
      return;
    }

    if (currentlyFlippedCard) {
      currentlyFlippedCard.classList.remove('flipped');
      currentlyFlippedCard = null;
    }

    revealTurnIndex += 1;
    revealCurrentPlayerHasFlipped = false;
    refreshRevealControls();
  }

  if (revealNextBtn) {
    revealNextBtn.addEventListener('click', () => {
      advanceRevealTurn();
    });
  }

  function syncJobChanceInputs() {
    updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: false });
    updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: false });
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
    hideRevealControls();
    showRolesOverviewBtn.style.display = 'none';
    firstNightShieldUsed = false;
    syncJobChanceInputs();
    renderNarratorDashboard();
  });

  function serializeActionEntry(entry) {
    const createdAt = getActionEntryDate(entry);
    return {
      id: entry.id,
      sequence: entry.sequence,
      type: entry.type,
      label: entry.label,
      detail: entry.detail,
      timestamp: createdAt.getTime(),
      iso: createdAt.toISOString(),
      phase: entry.phase,
      step: entry.step || null,
      metadata: entry.metadata || {}
    };
  }

  function serializeCheckpointEntry(checkpoint) {
    const timestamp = typeof checkpoint.timestamp === 'number'
      ? checkpoint.timestamp
      : Date.now();
    return {
      id: checkpoint.id,
      label: checkpoint.label,
      timestamp,
      iso: new Date(timestamp).toISOString(),
      actionSequence: typeof checkpoint.actionSequence === 'number' ? checkpoint.actionSequence : null,
      state: checkpoint.state
    };
  }

  function buildSessionTimeline() {
    const actions = actionLog
      .slice()
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      .map(serializeActionEntry);

    const checkpoints = gameCheckpoints
      .slice()
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map(serializeCheckpointEntry);

    const timers = phaseTimerManager.history().map(event => {
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
      return {
        id: event.id,
        sequence: event.sequence,
        kind: event.kind,
        timestamp,
        iso: new Date(timestamp).toISOString(),
        metadata: event.metadata || {}
      };
    });

    return { actions, checkpoints, timers };
  }

  function renderAnalytics(data) {
    if (!analyticsSummaryEl) {
      return;
    }

    const summary = data?.summary || {};
    const playerAnalytics = data?.players || {};
    const sessionCount = Number.isFinite(summary.sessionCount) ? summary.sessionCount : Number(summary.sessions) || 0;
    const averageLengthMs = Number.isFinite(summary.averageGameLengthMs)
      ? summary.averageGameLengthMs
      : Number(summary.average_game_length_ms);
    const averageActions = Number.isFinite(summary.averageActionCount)
      ? summary.averageActionCount
      : Number(summary.average_action_count);
    const averagePlayers = Number.isFinite(summary.averagePlayerCount)
      ? summary.averagePlayerCount
      : Number(summary.average_player_count);
    const trackedSessions = Number.isFinite(playerAnalytics.trackedSessions)
      ? playerAnalytics.trackedSessions
      : Number(playerAnalytics.sessionCount);
    const distinctPlayers = Number.isFinite(playerAnalytics.totalCount)
      ? playerAnalytics.totalCount
      : Number(playerAnalytics.distinctPlayers);
    const meta = data?.meta || {};
    const averageNights = Number.isFinite(meta.averageNightCount)
      ? meta.averageNightCount
      : Number(meta.average_night_count);
    const averageDays = Number.isFinite(meta.averageDayCount)
      ? meta.averageDayCount
      : Number(meta.average_day_count);

    const formatLocaleNumber = (value, { fractionDigits = 0 } = {}) => {
      if (!Number.isFinite(value)) {
        return '–';
      }
      return value.toLocaleString('de-DE', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      });
    };

    const formatDuration = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) {
        return '–';
      }
      const totalSeconds = Math.round(ms / 1000);
      if (totalSeconds < 60) {
        return `${totalSeconds}s`;
      }
      const totalMinutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (minutes === 0) {
          return `${hours}h`;
        }
        return `${hours}h ${minutes}m`;
      }
      if (seconds === 0) {
        return `${totalMinutes}m`;
      }
      return `${totalMinutes}m ${seconds}s`;
    };

    const summaryParts = [`Spiele: ${formatLocaleNumber(sessionCount)}`];
    if (Number.isFinite(distinctPlayers)) {
      summaryParts.push(`Spieler:innen: ${formatLocaleNumber(distinctPlayers)}`);
    }
    summaryParts.push(`Stand: ${new Date().toLocaleString('de-DE')}`);
    analyticsSummaryEl.textContent = summaryParts.join(' • ');

    if (analyticsMetricSessionsEl) {
      analyticsMetricSessionsEl.textContent = formatLocaleNumber(sessionCount);
    }
    if (analyticsMetricTrackedEl) {
      analyticsMetricTrackedEl.textContent = Number.isFinite(trackedSessions)
        ? formatLocaleNumber(trackedSessions)
        : '0';
    }
    if (analyticsMetricPlayersEl) {
      analyticsMetricPlayersEl.textContent = Number.isFinite(distinctPlayers)
        ? formatLocaleNumber(distinctPlayers)
        : '0';
    }
    if (analyticsMetricAveragePlayersEl) {
      analyticsMetricAveragePlayersEl.textContent = Number.isFinite(averagePlayers)
        ? formatLocaleNumber(averagePlayers, { fractionDigits: 1 })
        : '–';
    }
    if (analyticsMetricAverageActionsEl) {
      analyticsMetricAverageActionsEl.textContent = Number.isFinite(averageActions)
        ? formatLocaleNumber(averageActions, { fractionDigits: 1 })
        : '–';
    }
    if (analyticsMetricDurationEl) {
      analyticsMetricDurationEl.textContent = formatDuration(averageLengthMs);
    }

    if (analyticsWinratesEl) {
      analyticsWinratesEl.innerHTML = '';
      const winRates = Array.isArray(data?.winRates) ? data.winRates : [];
      if (winRates.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'empty';
        emptyItem.textContent = 'Noch keine Siege ausgewertet.';
        analyticsWinratesEl.appendChild(emptyItem);
      } else {
        winRates.forEach(entry => {
          const item = document.createElement('li');
          const winnerName = entry.winner || 'Unbekannt';
          const rateValue = Number.isFinite(entry.rate) ? entry.rate : Number(entry.percentage) / 100;
          const countValueRaw = Number.isFinite(entry.count) ? entry.count : Number(entry.total) || 0;
          const countValue = Number.isFinite(countValueRaw) ? countValueRaw : 0;
          const headerRow = document.createElement('div');
          headerRow.className = 'analytics-winrate-row';
          const winnerEl = document.createElement('strong');
          winnerEl.textContent = winnerName;
          headerRow.appendChild(winnerEl);

          const detailSpan = document.createElement('span');
          detailSpan.className = 'analytics-winrate-value';
          detailSpan.textContent = `${formatPercentage(rateValue, { defaultText: '–', fractionDigits: 0 })} (${countValue.toLocaleString('de-DE')})`;
          headerRow.appendChild(detailSpan);
          item.appendChild(headerRow);

          const progress = document.createElement('div');
          progress.className = 'analytics-progress';
          const progressFill = document.createElement('div');
          progressFill.className = 'analytics-progress-fill';
          if (Number.isFinite(rateValue)) {
            progressFill.style.width = `${Math.max(0, Math.min(100, rateValue * 100))}%`;
          }
          progress.appendChild(progressFill);
          item.appendChild(progress);

          analyticsWinratesEl.appendChild(item);
        });
      }
    }

    if (analyticsMetaEl) {
      const metaParts = [];
      if (Number.isFinite(averageNights)) {
        metaParts.push(`Ø Nächte: ${averageNights.toFixed(1)}`);
      }
      if (Number.isFinite(averageDays)) {
        metaParts.push(`Ø Tage: ${averageDays.toFixed(1)}`);
      }
      if (Number.isFinite(trackedSessions) && trackedSessions > 0) {
        metaParts.push(`Analysierte Sessions: ${trackedSessions.toLocaleString('de-DE')}`);
      }
      if (Number.isFinite(distinctPlayers) && distinctPlayers > 0) {
        metaParts.push(`Spieler:innen: ${distinctPlayers.toLocaleString('de-DE')}`);
      }
      if (metaParts.length === 0) {
        analyticsMetaEl.innerHTML = '<p class="analytics-meta-empty">Noch keine Metadaten vorhanden.</p>';
      } else {
        analyticsMetaEl.innerHTML = metaParts
          .map(part => `<span class="analytics-meta-chip">${escapeHtml(part)}</span>`)
          .join('');
      }
    }

    if (analyticsHighlightsEl) {
      analyticsHighlightsEl.innerHTML = '';
      const formatNumber = (value) => (Number.isFinite(value) ? value.toLocaleString('de-DE') : null);
      const stats = Array.isArray(playerAnalytics.stats) ? playerAnalytics.stats : [];
      const globalRoleUsage = stats.reduce((acc, stat) => {
        const roles = Array.isArray(stat.topRoles) ? stat.topRoles : [];
        roles.forEach(roleEntry => {
          const roleName = roleEntry?.role;
          const count = Number(roleEntry?.count);
          if (!roleName || !Number.isFinite(count)) {
            return;
          }
          acc.set(roleName, (acc.get(roleName) || 0) + count);
        });
        return acc;
      }, new Map());
      const globalRoleHighlights = Array.from(globalRoleUsage.entries())
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const highlightConfigs = [
        {
          key: 'topWinners',
          title: 'Top Sieger:innen',
          description: 'Meiste Siege insgesamt',
          icon: '🏆',
          items: Array.isArray(playerAnalytics.topWinners) ? playerAnalytics.topWinners : [],
          format(entry) {
            const wins = formatNumber(entry.wins);
            const games = formatNumber(entry.games);
            const parts = [];
            if (wins !== null) {
              parts.push(`${wins} ${entry.wins === 1 ? 'Sieg' : 'Siege'}`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const winRateText = formatPercentage(entry.winRate, { defaultText: '–', fractionDigits: 0 });
            if (winRateText !== '–') {
              parts.push(winRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'mostDeaths',
          title: 'Dramatischstes Ende',
          description: 'Wer stirbt am häufigsten?',
          icon: '💀',
          items: Array.isArray(playerAnalytics.mostDeaths) ? playerAnalytics.mostDeaths : [],
          format(entry) {
            const deaths = formatNumber(entry.deaths);
            const games = formatNumber(entry.games);
            const parts = [];
            if (deaths !== null) {
              parts.push(`${deaths} ${entry.deaths === 1 ? 'Tod' : 'Tode'}`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const deathRateText = formatPercentage(entry.deathRate, { defaultText: '–', fractionDigits: 0 });
            if (deathRateText !== '–') {
              parts.push(deathRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'bestSurvivors',
          title: 'Überlebenskünstler:innen',
          description: 'Beste Überlebensquote ab 2 Spielen',
          icon: '🛡️',
          items: Array.isArray(playerAnalytics.bestSurvivors) ? playerAnalytics.bestSurvivors : [],
          format(entry) {
            const survivals = formatNumber(entry.survivals);
            const games = formatNumber(entry.games);
            const parts = [];
            if (survivals !== null) {
              parts.push(`${survivals}× überlebt`);
            }
            if (games !== null) {
              parts.push(`${games} Spiele`);
            }
            const survivalRateText = formatPercentage(entry.survivalRate, { defaultText: '–', fractionDigits: 0 });
            if (survivalRateText !== '–') {
              parts.push(survivalRateText);
            }
            return parts.join(' • ') || 'Keine Daten';
          }
        },
        {
          key: 'favoriteRoles',
          title: 'Beliebteste Rollen',
          description: 'Rollen mit den meisten Einsätzen insgesamt',
          icon: '🎭',
          items: globalRoleHighlights,
          format(entry) {
            const count = formatNumber(entry.count);
            if (count !== null) {
              return `${count} Einsätze`;
            }
            return 'Keine Daten';
          },
          getName(entry) {
            return entry.role || 'Unbekannt';
          }
        }
      ];

      highlightConfigs.forEach(config => {
        const card = document.createElement('article');
        card.className = 'analytics-card';
        const titleEl = document.createElement('h6');
        const iconEl = document.createElement('span');
        iconEl.className = 'analytics-card-icon';
        iconEl.textContent = config.icon || '⭐';
        titleEl.appendChild(iconEl);
        titleEl.appendChild(document.createTextNode(config.title));
        card.appendChild(titleEl);
        if (config.description) {
          const descEl = document.createElement('p');
          descEl.textContent = config.description;
          card.appendChild(descEl);
        }
        const items = Array.isArray(config.items) ? config.items : [];
        if (items.length === 0) {
          const emptyState = document.createElement('p');
          emptyState.className = 'analytics-empty-state';
          emptyState.textContent = 'Noch keine Daten vorhanden.';
          card.appendChild(emptyState);
        } else {
          const list = document.createElement('ul');
          items.slice(0, 5).forEach(entry => {
            const item = document.createElement('li');
            const nameEl = document.createElement('strong');
            const entryName = typeof config.getName === 'function'
              ? config.getName(entry)
              : entry.name || entry.player || entry.role || 'Unbekannt';
            nameEl.textContent = entryName;
            item.appendChild(nameEl);
            const detailText = config.format(entry);
            if (detailText) {
              const detailEl = document.createElement('span');
              detailEl.textContent = detailText;
              item.appendChild(detailEl);
            }
            list.appendChild(item);
          });
          card.appendChild(list);
        }
        analyticsHighlightsEl.appendChild(card);
      });
    }

    if (analyticsPlayerTableBody) {
      analyticsPlayerTableBody.innerHTML = '';
      const stats = Array.isArray(playerAnalytics.stats) ? playerAnalytics.stats : [];
      const formatCount = (value) => (Number.isFinite(value) ? value.toLocaleString('de-DE') : '–');
      if (stats.length === 0) {
        const row = document.createElement('tr');
        row.className = 'empty';
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.textContent = 'Noch keine Spielerstatistiken verfügbar.';
        row.appendChild(cell);
        analyticsPlayerTableBody.appendChild(row);
      } else {
        stats.forEach(stat => {
          const row = document.createElement('tr');

          const nameCell = document.createElement('td');
          nameCell.textContent = stat.name || 'Unbekannt';
          row.appendChild(nameCell);

          const gamesCell = document.createElement('td');
          gamesCell.textContent = formatCount(stat.games);
          row.appendChild(gamesCell);

          const winsCell = document.createElement('td');
          winsCell.textContent = formatCount(stat.wins);
          row.appendChild(winsCell);

          const winRateCell = document.createElement('td');
          winRateCell.textContent = formatPercentage(stat.winRate, { defaultText: '–', fractionDigits: 0 });
          row.appendChild(winRateCell);

          const deathsCell = document.createElement('td');
          deathsCell.textContent = formatCount(stat.deaths);
          row.appendChild(deathsCell);

          const survivalCell = document.createElement('td');
          survivalCell.textContent = formatPercentage(stat.survivalRate, { defaultText: '–', fractionDigits: 0 });
          row.appendChild(survivalCell);

          const favoriteCell = document.createElement('td');
          const favoriteRole = stat.favoriteRole && typeof stat.favoriteRole.role === 'string'
            ? stat.favoriteRole
            : null;
          if (favoriteRole) {
            const label = document.createElement('div');
            const countText = Number.isFinite(favoriteRole.count)
              ? ` (${favoriteRole.count.toLocaleString('de-DE')}×)`
              : '';
            label.textContent = `${favoriteRole.role}${countText}`;
            favoriteCell.appendChild(label);
          } else {
            favoriteCell.textContent = '–';
          }

          const roleChips = Array.isArray(stat.topRoles) ? stat.topRoles.slice(0, 3) : [];
          if (roleChips.length > 0) {
            const roleList = document.createElement('div');
            roleList.className = 'analytics-role-list';
            roleChips.forEach(roleEntry => {
              if (!roleEntry || typeof roleEntry.role !== 'string') {
                return;
              }
              const chip = document.createElement('span');
              chip.className = 'analytics-role-chip';
              const countText = Number.isFinite(roleEntry.count)
                ? ` ${roleEntry.count.toLocaleString('de-DE')}×`
                : '';
              chip.textContent = `${roleEntry.role}${countText}`;
              roleList.appendChild(chip);
            });
            favoriteCell.appendChild(roleList);
          }
          row.appendChild(favoriteCell);

          const lastPlayedCell = document.createElement('td');
          if (Number.isFinite(stat.lastPlayedAt) && stat.lastPlayedAt > 0) {
            const lastPlayedDate = new Date(stat.lastPlayedAt);
            lastPlayedCell.innerHTML = `<span class="analytics-last-played">${escapeHtml(lastPlayedDate.toLocaleDateString('de-DE', { dateStyle: 'medium' }))}</span>`;
          } else {
            lastPlayedCell.textContent = '–';
          }
          row.appendChild(lastPlayedCell);

          analyticsPlayerTableBody.appendChild(row);
        });
      }
    }
  }

  async function loadAnalytics(options = {}) {
    const { showLoading = true } = options;
    if (!analyticsSummaryEl) {
      return null;
    }

    if (showLoading) {
      analyticsSummaryEl.textContent = 'Lade Statistiken…';
    }
    if (analyticsWinratesEl) {
      analyticsWinratesEl.innerHTML = '';
    }
    if (analyticsMetaEl) {
      analyticsMetaEl.innerHTML = '';
    }

    try {
      setAnalyticsLoadingState(true, { showLoadingText: showLoading });
      const data = await apiClient.analytics.get();
      renderAnalytics(data);
      return data;
    } catch (error) {
      analyticsSummaryEl.textContent = 'Statistiken konnten nicht geladen werden.';
      console.error('Analytics konnten nicht geladen werden.', error);
      return null;
    } finally {
      setAnalyticsLoadingState(false, { showLoadingText: showLoading });
    }
  }

  // Session Management
  async function saveSession() {
    if (!canEditActiveLobby) {
      throw new Error(READ_ONLY_HINT);
    }
    const roleCounts = rolesAssigned.reduce((acc, role) => {
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});

    const timeline = buildSessionTimeline();
    let gameDurationMs = null;
    if (timeline.actions.length > 1) {
      const first = timeline.actions[0];
      const last = timeline.actions[timeline.actions.length - 1];
      const duration = last.timestamp - first.timestamp;
      if (Number.isFinite(duration) && duration >= 0) {
        gameDurationMs = duration;
      }
    }

    const sessionMetadata = {
      playerCount: players.length,
      dayCount,
      nightCount: nightCounter,
      actionCount: timeline.actions.length,
      checkpointCount: timeline.checkpoints.length,
      gameDurationMs,
      winner: lastWinner ? { ...lastWinner } : null,
      savedAt: Date.now()
    };

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
      firstNightShieldUsed,
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
      doctorPlayers: doctorPlayers.slice(),
      doctorPendingTargets: doctorPendingTargets.slice(),
      doctorPendingNight,
      doctorTriggerSourceNight,
      doctorLastHealedTarget,
      doctorLastHealedNight,
      jobsAssigned: jobsAssigned.map(jobs => Array.isArray(jobs) ? jobs.slice() : []),
      jobConfig: { bodyguardChance: jobConfig.bodyguardChance, doctorChance: jobConfig.doctorChance },
      roleSchema: getRoleSchemaSnapshot(),
      roleSchemaSource,
      timeline,
      metadata: sessionMetadata
    };

    await apiClient.sessions.create(session);
    await loadSessions();
    await loadAnalytics({ showLoading: false });
    return session;
  }

  async function loadSessions() {
    sessionsList.innerHTML = '';
    if (!latestLobbySnapshot) {
      sessionsList.innerHTML = '<li>Keine Lobby ausgewählt.</li>';
      updateReplaySessionOptions([]);
      return [];
    }
    let sessions = [];
    try {
      sessions = await apiClient.sessions.list();
    } catch (error) {
      sessionsList.innerHTML = '<li>Sessions konnten nicht geladen werden.</li>';
      console.error('Sessions konnten nicht geladen werden.', error);
      return [];
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      sessionsList.innerHTML = '<li>Keine gespeicherten Sessions.</li>';
      updateReplaySessionOptions([]);
      return [];
    }

    sessionsList.innerHTML = '';
    const canManageSessions = canEditActiveLobby;

    sessions.forEach(session => {
      const li = document.createElement('li');
      const date = new Date(session.timestamp).toLocaleString('de-DE');
      const playerNames = session.players.join(', ');

      li.innerHTML = `
        <div class="session-date">${date}</div>
        <div class="session-players">${playerNames}</div>
        ${canManageSessions ? `<button class="delete-session-btn" data-timestamp="${session.timestamp}">&times;</button>` : ''}
      `;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-session-btn')) return;
        applySession(session);
        sessionsSidebar.classList.remove('show');
        document.body.classList.remove('sidebar-open');
      });

      sessionsList.appendChild(li);
    });

    updateReplaySessionOptions(sessions);

    if (canManageSessions) {
      document.querySelectorAll('.delete-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const timestamp = Number(e.target.dataset.timestamp);
          if (!Number.isFinite(timestamp)) {
            return;
          }
          deleteSession(timestamp);
        });
      });
    }

    return sessions;
  }

  function resetReplayUI() {
    replayTimeline = null;
    replayPointer = -1;
    if (replayScrubber) {
      replayScrubber.min = 0;
      replayScrubber.max = 0;
      replayScrubber.value = 0;
      replayScrubber.disabled = true;
    }
    if (replayActionLabel) {
      replayActionLabel.textContent = '–';
    }
    if (replayApplyBtn) {
      replayApplyBtn.disabled = true;
    }
    if (replayActionList) {
      replayActionList.innerHTML = '';
    }
  }

  function updateReplaySessionOptions(sessions = []) {
    if (!replaySessionSelect) {
      return;
    }

    const previousValue = replaySessionSelect.value;
    replaySessionSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Session auswählen…';
    placeholder.disabled = true;
    replaySessionSelect.appendChild(placeholder);

    let hasSelection = false;
    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.timestamp;
      option.textContent = new Date(session.timestamp).toLocaleString('de-DE');
      if (String(session.timestamp) === previousValue) {
        option.selected = true;
        hasSelection = true;
      }
      replaySessionSelect.appendChild(option);
    });

    placeholder.selected = !hasSelection;
    if (!hasSelection) {
      resetReplayUI();
    }
  }

  function renderReplayActions() {
    if (!replayActionList) {
      return;
    }

    replayActionList.innerHTML = '';

    if (!replayTimeline || !Array.isArray(replayTimeline.actions) || replayTimeline.actions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Keine Aktionen gespeichert.';
      replayActionList.appendChild(empty);
      if (replayScrubber) {
        replayScrubber.disabled = true;
        replayScrubber.value = 0;
        replayScrubber.max = 0;
      }
      if (replayApplyBtn) {
        replayApplyBtn.disabled = true;
      }
      if (replayActionLabel) {
        replayActionLabel.textContent = '–';
      }
      return;
    }

    replayTimeline.actions.forEach((action, index) => {
      const item = document.createElement('li');
      item.className = 'replay-entry';
      const time = action.iso ? new Date(action.iso) : new Date(action.timestamp);
      const timeText = Number.isNaN(time.getTime())
        ? ''
        : time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      item.innerHTML = `
        <div class="replay-entry-header">
          <span class="replay-entry-type">${timelineLabelMap[action.type] || 'Info'}</span>
          <span class="replay-entry-time">${timeText}</span>
        </div>
        <div class="replay-entry-label">${action.label || 'Aktion'}</div>
        ${action.detail ? `<div class="replay-entry-detail">${action.detail}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        setReplayPointer(index);
      });
      replayActionList.appendChild(item);
    });

    if (replayScrubber) {
      replayScrubber.disabled = false;
      replayScrubber.min = 0;
      replayScrubber.max = replayTimeline.actions.length - 1;
      replayScrubber.value = 0;
    }

    setReplayPointer(0);
  }

  function setReplayPointer(index) {
    if (!replayTimeline || !Array.isArray(replayTimeline.actions) || replayTimeline.actions.length === 0) {
      replayPointer = -1;
      if (replayApplyBtn) {
        replayApplyBtn.disabled = true;
      }
      return;
    }

    const boundedIndex = Math.min(Math.max(index, 0), replayTimeline.actions.length - 1);
    replayPointer = boundedIndex;
    const action = replayTimeline.actions[boundedIndex];

    if (replayScrubber) {
      replayScrubber.value = String(boundedIndex);
    }
    if (replayActionLabel) {
      replayActionLabel.textContent = action.label || 'Aktion';
    }
    if (replayApplyBtn) {
      replayApplyBtn.disabled = false;
    }
    if (replayActionList) {
      Array.from(replayActionList.children).forEach((item, idx) => {
        item.classList.toggle('active', idx === boundedIndex);
      });
    }
  }

  function findCheckpointForSequence(sequence) {
    if (!replayTimeline || !Array.isArray(replayTimeline.checkpoints) || replayTimeline.checkpoints.length === 0) {
      return null;
    }
    let candidate = null;
    replayTimeline.checkpoints.forEach(checkpoint => {
      const seq = typeof checkpoint.actionSequence === 'number' ? checkpoint.actionSequence : null;
      if (seq === null) {
        return;
      }
      if (seq <= sequence) {
        if (!candidate || seq >= (candidate.actionSequence ?? -Infinity)) {
          candidate = checkpoint;
        }
      }
    });

    if (!candidate) {
      candidate = replayTimeline.checkpoints[0];
    }
    return candidate;
  }

  async function loadReplayTimeline(timestamp) {
    if (!replaySessionSelect) {
      return null;
    }

    resetReplayUI();
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    isLoadingReplay = true;
    try {
      if (replayActionLabel) {
        replayActionLabel.textContent = 'Lade…';
      }
      const timeline = await apiClient.sessions.timeline(timestamp);
      if (!timeline) {
        if (replayActionLabel) {
          replayActionLabel.textContent = 'Keine Timeline gefunden';
        }
        replayTimeline = null;
        return null;
      }
      replayTimeline = {
        timestamp,
        actions: Array.isArray(timeline.actions) ? timeline.actions : [],
        checkpoints: Array.isArray(timeline.checkpoints) ? timeline.checkpoints : [],
        timers: Array.isArray(timeline.timers) ? timeline.timers : []
      };
      renderReplayActions();
      return replayTimeline;
    } catch (error) {
      console.error('Timeline konnte nicht geladen werden.', error);
      if (replayActionLabel) {
        replayActionLabel.textContent = 'Fehler beim Laden';
      }
      return null;
    } finally {
      isLoadingReplay = false;
    }
  }

  function applyReplaySelection() {
    if (!replayTimeline || replayPointer < 0 || !Array.isArray(replayTimeline.actions)) {
      return;
    }
    const action = replayTimeline.actions[replayPointer];
    const sequence = typeof action.sequence === 'number' ? action.sequence : null;
    const checkpoint = sequence !== null ? findCheckpointForSequence(sequence) : null;
    if (!checkpoint || !checkpoint.state) {
      showInfoMessage({
        title: 'Kein Snapshot vorhanden',
        text: 'Für diese Aktion liegt kein vollständiger Snapshot vor.',
        confirmText: 'Okay'
      });
      return;
    }

    phaseTimerManager.cancelAll();
    phaseTimerManager.resetHistory();
    isRestoringCheckpoint = true;
    try {
      applyStateSnapshot(checkpoint.state);
    } finally {
      isRestoringCheckpoint = false;
    }

    const actionTime = action.iso ? new Date(action.iso) : new Date(action.timestamp);
    const detailParts = [];
    if (!Number.isNaN(actionTime.getTime())) {
      detailParts.push(actionTime.toLocaleString('de-DE'));
    }
    if (checkpoint.label) {
      detailParts.push(`Snapshot: ${checkpoint.label}`);
    }

    logAction({
      type: 'replay',
      label: `Replay geladen – ${action.label || 'Aktion'}`,
      detail: detailParts.join(' | '),
      metadata: {
        source: 'replay',
        sessionTimestamp: replayTimeline.timestamp,
        actionId: action.id,
        checkpointId: checkpoint.id
      }
    });
  }

  async function deleteSession(timestamp) {
    if (!canEditActiveLobby) {
      showInfoMessage({
        title: 'Schreibgeschützt',
        text: READ_ONLY_HINT,
        confirmText: 'Okay',
      });
      return;
    }
    try {
      await apiClient.sessions.remove(timestamp);
      await loadSessions();
    } catch (error) {
      showInfoMessage({
        title: 'Löschen fehlgeschlagen',
        text: 'Die Session konnte nicht entfernt werden.',
        confirmText: 'Okay',
        log: { type: 'error', label: 'Session löschen fehlgeschlagen', detail: error?.message || 'Unbekannter Fehler.' }
      });
    }
  }

  if (replaySessionSelect) {
    replaySessionSelect.addEventListener('change', async (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        resetReplayUI();
        return;
      }
      await loadReplayTimeline(value);
    });
  }

  if (replayScrubber) {
    replayScrubber.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) {
        return;
      }
      setReplayPointer(value);
    });
  }

  if (replayApplyBtn) {
    replayApplyBtn.addEventListener('click', () => {
      applyReplaySelection();
    });
  }

  function applySession(session) {
    phaseTimerManager.resetHistory();
    resetTimerEventHistory();
    actionLog.length = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    actionSequenceCounter = 0;
    checkpointCounter = 0;
    updateTimelineUI();
    updateUndoHistoryUI();
    const sessionWinner = session?.metadata?.winner;
    lastWinner = sessionWinner ? { ...sessionWinner } : null;

    if (session.roleSchema) {
      roleSchemaSource = session.roleSchemaSource || 'custom';
      applyRoleSchema(session.roleSchema);
      refreshRoleInputsFromSchema({ preserveExisting: false });
    } else if (session.roleSchemaSource) {
      roleSchemaSource = session.roleSchemaSource;
      updateRoleEditorStatus();
    }

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

    if (Array.isArray(session.doctorPlayers) && session.doctorPlayers.length > 0) {
      session.doctorPlayers.forEach(name => {
        const idx = players.indexOf(name);
        if (idx !== -1) {
          assignDoctorJobToIndex(idx);
        }
      });
    }

    if (session.jobConfig && typeof session.jobConfig.bodyguardChance === 'number') {
      jobConfig.bodyguardChance = Math.min(Math.max(session.jobConfig.bodyguardChance, 0), 1);
      updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: true });
    }
    if (session.jobConfig && typeof session.jobConfig.doctorChance === 'number') {
      jobConfig.doctorChance = Math.min(Math.max(session.jobConfig.doctorChance, 0), 1);
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    if (!session.jobConfig || typeof session.jobConfig.doctorChance !== 'number') {
      jobConfig.doctorChance = defaultJobConfig.doctorChance;
      updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: true });
    }
    deadPlayers = session.deadPlayers || [];
    lovers = session.lovers || [];
    silencedPlayer = session.silencedPlayer || null;
    healRemaining = session.healRemaining !== undefined ? session.healRemaining : 1;
    poisonRemaining = session.poisonRemaining !== undefined ? session.poisonRemaining : 1;
    setBloodMoonState(!!session.bloodMoonActive);
    phoenixPulsePending = !!session.phoenixPulsePending;
    phoenixPulseJustResolved = !!session.phoenixPulseJustResolved;
    phoenixPulseRevivedPlayers = Array.isArray(session.phoenixPulseRevivedPlayers)
      ? session.phoenixPulseRevivedPlayers.slice()
      : [];
    if (typeof session.firstNightShieldUsed === 'boolean') {
      firstNightShieldUsed = session.firstNightShieldUsed;
    } else {
      const legacyNightCounter = Number.isFinite(session.nightCounter) ? session.nightCounter : 0;
      const legacyNightMode = !!session.nightMode;
      const legacyDayCount = Number.isFinite(session.dayCount) ? session.dayCount : 0;
      const nightFinished = legacyNightCounter > 1 || (legacyNightCounter === 1 && !legacyNightMode);
      firstNightShieldUsed = nightFinished || legacyDayCount > 0;
    }
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
    doctorPendingTargets = Array.isArray(session.doctorPendingTargets)
      ? session.doctorPendingTargets.slice()
      : [];
    doctorPendingNight = Number.isFinite(session.doctorPendingNight)
      ? session.doctorPendingNight
      : null;
    doctorTriggerSourceNight = Number.isFinite(session.doctorTriggerSourceNight)
      ? session.doctorTriggerSourceNight
      : null;
    doctorLastHealedTarget = session.doctorLastHealedTarget || null;
    doctorLastHealedNight = Number.isFinite(session.doctorLastHealedNight)
      ? session.doctorLastHealedNight
      : null;
    updateDoctorPlayers();
    if (session.eventEngineState) {
      restoreEventEngineState(session.eventEngineState);
    } else {
      persistEventEngineState();
    }
    bodyguardProtectionTarget = session.bodyguardProtectionTarget || null;
    bodyguardProtectionNight = Number.isFinite(session.bodyguardProtectionNight)
      ? session.bodyguardProtectionNight
      : null;
    bodyguardSavedTarget = session.bodyguardSavedTarget || null;
    dayAnnouncements = [];
    currentDayAdditionalParagraphs = [];
    dayIntroHtml = '';

    const timelineData = session.timeline || null;

    phaseTimerManager.cancelAll();
    gameCheckpoints.length = 0;

    if (timelineData && Array.isArray(timelineData.checkpoints) && timelineData.checkpoints.length > 0) {
      const sortedCheckpoints = timelineData.checkpoints
        .slice()
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      sortedCheckpoints.forEach((cp, index) => {
        if (!cp.state) {
          return;
        }
        const timestamp = typeof cp.timestamp === 'number'
          ? cp.timestamp
          : (typeof cp.iso === 'string' ? Date.parse(cp.iso) : Date.now());
        const sequence = typeof cp.actionSequence === 'number' ? cp.actionSequence : index;
        checkpointCounter = Math.max(checkpointCounter, sequence);
        gameCheckpoints.push({
          id: cp.id || `checkpoint-${timestamp}-${sequence || index + 1}`,
          label: cp.label || 'Snapshot',
          timestamp,
          actionSequence: sequence,
          state: cp.state
        });
      });
      if (gameCheckpoints.length === 0) {
        captureGameCheckpoint('Session geladen');
      }
    } else {
      captureGameCheckpoint('Session geladen');
    }

    if (timelineData && Array.isArray(timelineData.actions) && timelineData.actions.length > 0) {
      const restoredActions = timelineData.actions
        .slice()
        .map(action => {
          const createdAt = action.iso ? new Date(action.iso) : new Date(action.timestamp);
          const sequence = typeof action.sequence === 'number' ? action.sequence : 0;
          return {
            id: action.id || `action-${createdAt.getTime()}-${sequence}`,
            sequence,
            type: action.type || 'info',
            label: action.label || '',
            detail: action.detail || '',
            createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
            phase: action.phase || 'setup',
            step: action.step || null,
            metadata: action.metadata || {}
          };
        })
        .sort((a, b) => (b.sequence || 0) - (a.sequence || 0));
      restoredActions.forEach(entry => {
        actionLog.push(entry);
        actionSequenceCounter = Math.max(actionSequenceCounter, entry.sequence || 0);
      });
    }

    if (timelineData && Array.isArray(timelineData.timers) && timelineData.timers.length > 0) {
      resetTimerEventHistory();
      timelineData.timers
        .slice()
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
        .forEach(event => {
          const timestamp = typeof event.timestamp === 'number'
            ? event.timestamp
            : (typeof event.iso === 'string' ? Date.parse(event.iso) : Date.now());
          const sequence = typeof event.sequence === 'number' ? event.sequence : timerEventCounter + 1;
          timerEventCounter = Math.max(timerEventCounter, sequence);
          timerEventHistory.push({
            id: event.id || `timer-${timestamp}-${sequence}`,
            sequence,
            kind: event.kind || 'custom',
            timestamp,
            metadata: event.metadata || {}
          });
        });
    }

    updateTimelineUI();
    updateUndoHistoryUI();

    playersTextarea.value = session.players.join('\n');

    const roleCounts = {};
    session.roles.forEach(r => {
        const name = r.name === 'Bodyguard' ? 'Dorfbewohner' : r.name;
        roleCounts[name] = (roleCounts[name] || 0) + r.quantity;
    });

    refreshRoleInputsFromSchema({ preserveExisting: false });
    Object.entries(roleCounts).forEach(([roleName, qty]) => {
      let row = findRoleRow(rolesContainerVillage, roleName)
        || findRoleRow(rolesContainerWerwolf, roleName)
        || findRoleRow(rolesContainerSpecial, roleName);
      if (!row) {
        if (categorizedRoles.village.includes(roleName)) {
          addRoleRow(roleName, qty, rolesContainerVillage);
        } else if (categorizedRoles.werwolf.includes(roleName)) {
          addRoleRow(roleName, qty, rolesContainerWerwolf);
        } else {
          addRoleRow(roleName, qty, rolesContainerSpecial);
        }
        row = findRoleRow(rolesContainerVillage, roleName)
          || findRoleRow(rolesContainerWerwolf, roleName)
          || findRoleRow(rolesContainerSpecial, roleName);
      }
      if (row) {
        setRowQuantity(row, qty);
      }
    });

    lastSuggestionSnapshot = null;
    roleLayoutCustomized = true;

    // Hide setup and show results
    document.querySelector('.setup-container').style.display = 'none';
    assignBtn.style.display = 'none';
    loadLastUsedBtn.style.display = 'none';
    document.getElementById('ergebnisse-title').style.display = 'block';
    document.querySelector('.navigation-buttons').style.display = 'flex';
    document.getElementById('reveal-grid').style.display = 'grid';

    // Create and display reveal cards
    const revealGrid = document.getElementById('reveal-grid');
    hideRevealControls();
    revealGrid.innerHTML = ''; // Clear previous cards
    revealCards = new Array(players.length);
    revealCurrentPlayerHasFlipped = false;
    currentlyFlippedCard = null;

    players.forEach((player, index) => {
      const card = document.createElement('div');
      card.className = 'reveal-card';
      card.dataset.playerIndex = String(index);
      card.style.animationDelay = `${index * 0.05}s`;
      if (deadPlayers.includes(player)) {
        card.classList.add('dead');
      }
      card.onclick = () => {
        if (revealTurnIndex < 0 || revealTurnOrder[revealTurnIndex] !== index) {
          return;
        }
        if (currentlyFlippedCard && currentlyFlippedCard !== card) {
          currentlyFlippedCard.classList.remove('flipped');
        }
        card.classList.toggle('flipped');
        const isFlipped = card.classList.contains('flipped');
        currentlyFlippedCard = isFlipped ? card : null;
        revealCurrentPlayerHasFlipped = isFlipped;
        refreshRevealControls();
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
      if (role === 'Dorfbewohner' && (!Array.isArray(jobs) || jobs.length === 0)) {
        roleNameEl.classList.add('long-text');
      }
      renderRoleWithJobs(roleNameEl, role, jobs);
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
      revealCards[index] = card;
    });

    const revealOrder = players.map((_, idx) => idx);
    shuffleArray(revealOrder);
    setRevealTurnOrder(revealOrder);


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

  await loadSessions();
  await loadAnalytics();

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
  const stepBackBtn = document.getElementById('admin-step-back-btn');
  const rollbackCheckpointBtn = document.getElementById('admin-rollback-checkpoint-btn');
  const defaultStepBackText = stepBackBtn ? stepBackBtn.textContent : 'Zum vorherigen Schritt';

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

  function formatPercentage(value, { defaultText = '–', fractionDigits = 0 } = {}) {
    if (!Number.isFinite(value)) {
      return defaultText;
    }
    const percentage = value * 100;
    if (!Number.isFinite(percentage)) {
      return defaultText;
    }
    return `${percentage.toFixed(fractionDigits)}%`;
  }

