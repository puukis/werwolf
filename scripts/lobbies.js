  function createLobbyManager() {
    const toolbar = document.getElementById('lobby-toolbar');
    const lobbySelect = document.getElementById('lobby-select');
    const createLobbyBtn = document.getElementById('create-lobby-btn');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const shareLobbyBtn = document.getElementById('share-lobby-btn');
    const manageLobbyBtn = document.getElementById('manage-lobby-btn');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
    const roleBadge = document.getElementById('lobby-role-badge');
    const cloneNamesBtn = document.getElementById('clone-names-btn');
    const cloneRolesBtn = document.getElementById('clone-roles-btn');

    let lobbies = [];
    let activeLobbyState = null;
    const changeListeners = new Set();

    function cloneLobby(lobby) {
      return lobby ? { ...lobby } : null;
    }

    function canWrite(lobby = activeLobbyState) {
      if (!lobby) {
        return false;
      }
      return lobby.isPersonal || lobby.isOwner || lobby.isAdmin;
    }

    function updateRoleBadge() {
      if (!roleBadge) {
        return;
      }
      if (!activeLobbyState) {
        roleBadge.textContent = '';
        roleBadge.classList.add('hidden');
        return;
      }
      let label = '';
      if (activeLobbyState.isPersonal) {
        label = 'Persönlich';
      } else if (activeLobbyState.isOwner) {
        label = 'Besitzer:in';
      } else if (activeLobbyState.isAdmin) {
        label = 'Admin-Team';
      } else {
        label = 'Mitglied';
      }
      roleBadge.textContent = label;
      roleBadge.dataset.variant = activeLobbyState.role || (activeLobbyState.isPersonal ? 'personal' : 'member');
      roleBadge.classList.toggle('read-only', !canWrite());
      roleBadge.classList.remove('hidden');
    }

    function updateSelectOptions() {
      if (!lobbySelect) {
        return;
      }
      lobbySelect.innerHTML = '';
      lobbies.forEach((lobby) => {
        const option = document.createElement('option');
        option.value = String(lobby.id);
        let suffix = '';
        if (lobby.isPersonal) {
          suffix = ' (persönlich)';
        } else if (lobby.isOwner) {
          suffix = ' (Besitz)';
        } else if (lobby.isAdmin) {
          suffix = ' (Admin)';
        }
        option.textContent = `${lobby.name}${suffix}`;
        lobbySelect.appendChild(option);
      });
      if (activeLobbyState) {
        lobbySelect.value = String(activeLobbyState.id);
      }
    }

    function notifyChange() {
      const snapshot = cloneLobby(activeLobbyState);
      changeListeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (error) {
          console.error('Lobby-Listener fehlgeschlagen', error);
        }
      });
    }

    function updateToolbarVisibility() {
      if (toolbar) {
        toolbar.classList.toggle('hidden', lobbies.length === 0);
      }
      if (shareLobbyBtn) {
        shareLobbyBtn.disabled = !activeLobbyState || !activeLobbyState.joinCode;
        shareLobbyBtn.classList.toggle('hidden', !activeLobbyState || (!activeLobbyState.joinCode && !canWrite()));
      }
      if (manageLobbyBtn) {
        manageLobbyBtn.disabled = !canWrite();
        manageLobbyBtn.classList.toggle('hidden', !activeLobbyState || (!canWrite() && !activeLobbyState.isOwner));
      }
      if (createLobbyBtn) {
        createLobbyBtn.disabled = !authManager?.getUser();
      }
      if (joinLobbyBtn) {
        joinLobbyBtn.disabled = !authManager?.getUser();
      }
      if (cloneNamesBtn) {
        const canClone = activeLobbyState && lobbies.length > 1 && canWrite();
        cloneNamesBtn.disabled = !canClone;
        cloneNamesBtn.title = canClone ? '' : 'Nur mit Schreibrechten möglich.';
      }
      if (cloneRolesBtn) {
        const canClone = activeLobbyState && lobbies.length > 1 && canWrite();
        cloneRolesBtn.disabled = !canClone;
        cloneRolesBtn.title = canClone ? '' : 'Nur mit Schreibrechten möglich.';
      }
      if (leaveLobbyBtn) {
        const canLeave = Boolean(activeLobbyState && !activeLobbyState.isPersonal);
        leaveLobbyBtn.classList.toggle('hidden', !canLeave);
        leaveLobbyBtn.disabled = !canLeave;
        if (canLeave) {
          leaveLobbyBtn.textContent = activeLobbyState.isOwner ? 'Lobby löschen' : 'Lobby verlassen';
        }
      }
    }

    function setActiveLobbyState(lobby, { emitEvent = true } = {}) {
      activeLobbyState = cloneLobby(lobby);
      apiClient.storageScopes.setActiveLobby(activeLobbyState);
      updateSelectOptions();
      updateRoleBadge();
      updateToolbarVisibility();
      if (emitEvent) {
        notifyChange();
      }
    }

    async function refreshLobbies({ preserveActive = true } = {}) {
      let nextLobby = null;
      try {
        const data = await apiClient.lobby.list();
        lobbies = Array.isArray(data) ? data : [];
        if (preserveActive && activeLobbyState) {
          nextLobby = lobbies.find((entry) => entry.id === activeLobbyState.id) || null;
        }
      } catch (error) {
        console.error('Lobbys konnten nicht geladen werden.', error);
        lobbies = [];
        nextLobby = null;
      }

      if (!nextLobby) {
        nextLobby = lobbies.find((entry) => entry.isPersonal) || lobbies[0] || null;
      }

      setActiveLobbyState(nextLobby, { emitEvent: true });
      return cloneLobby(activeLobbyState);
    }

    function showLobbyPrompt({ title, label, placeholder = '', defaultValue = '', validate, onInvalid, confirmText = 'Speichern' }) {
      return new Promise((resolve) => {
        let lastValue = defaultValue || '';
        const inputId = `lobby-input-${Math.random().toString(36).slice(2, 8)}`;

        const openPrompt = () => {
          showConfirmation({
            title,
            html: `<div class="modal-field"><label for="${inputId}">${label}</label><input id="${inputId}" type="text" class="modal-input" placeholder="${placeholder}" /></div>`,
            confirmText,
            cancelText: 'Abbrechen',
            focus: 'confirm',
            onConfirm: () => {
              const inputEl = document.getElementById(inputId);
              const value = inputEl ? inputEl.value.trim() : '';
              lastValue = value;
              if (validate && !validate(value)) {
                if (typeof onInvalid === 'function') {
                  onInvalid(value);
                }
                setTimeout(openPrompt, 0);
                return;
              }
              resolve(value);
            },
            onCancel: () => resolve(null),
          });

          requestAnimationFrame(() => {
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
              inputEl.value = lastValue;
              inputEl.focus();
              inputEl.select();
            }
          });
        };

        openPrompt();
      });
    }

    function buildMembersHtml(members, canManage) {
      if (!Array.isArray(members) || members.length === 0) {
        return '<p class="empty-hint">Noch keine weiteren Teammitglieder.</p>';
      }
      return `
        <ul class="lobby-members-list">
          ${members.map((member) => {
            const actions = [];
            if (canManage && !member.isOwner) {
              if (member.isAdmin) {
                actions.push(`<button data-action="demote" data-member="${member.userId}" class="secondary-btn small-btn">Zu Mitglied</button>`);
              } else {
                actions.push(`<button data-action="promote" data-member="${member.userId}" class="secondary-btn small-btn">Zu Admin</button>`);
              }
              actions.push(`<button data-action="remove" data-member="${member.userId}" class="danger-btn small-btn">Entfernen</button>`);
            }
            const badge = member.isOwner ? 'Besitz' : (member.isAdmin ? 'Admin' : 'Mitglied');
            return `
              <li class="lobby-member">
                <div class="member-info">
                  <span class="member-name">${escapeHtml(member.displayName || member.email || 'Nutzer')}</span>
                  <span class="member-role" data-role="${member.isOwner ? 'owner' : member.isAdmin ? 'admin' : 'member'}">${badge}</span>
                </div>
                ${actions.length ? `<div class="member-actions">${actions.join('')}</div>` : ''}
              </li>
            `;
          }).join('')}
        </ul>
      `;
    }

    function openManageMembers() {
      if (!activeLobbyState) {
        return;
      }
      const lobbyId = activeLobbyState.id;
      const modalId = `lobby-members-${lobbyId}`;

      const render = async () => {
        let result = null;
        try {
          result = await apiClient.lobby.members(lobbyId);
        } catch (error) {
          console.error('Mitglieder konnten nicht geladen werden.', error);
          showInfoMessage({
            title: 'Fehler beim Laden',
            text: 'Die Mitgliederliste konnte nicht geladen werden.',
            confirmText: 'Okay',
          });
          return;
        }

        const members = Array.isArray(result?.members) ? result.members : [];
        const canManage = canWrite() && activeLobbyState?.isOwner;
        showConfirmation({
          title: `Team ${activeLobbyState.name}`,
          html: `<div id="${modalId}" class="lobby-members-manager">${buildMembersHtml(members, canManage)}</div>`,
          confirmText: 'Schließen',
          showCancel: false,
          modalClass: 'lobby-modal',
          onConfirm: () => {},
        });

        requestAnimationFrame(() => {
          const container = document.getElementById(modalId);
          if (!container) {
            return;
          }
          container.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-member]');
            if (!button) {
              return;
            }
            const memberId = Number(button.dataset.member);
            const action = button.dataset.action;
            try {
              if (action === 'promote') {
                await apiClient.lobby.updateMember(lobbyId, memberId, 'admin');
              } else if (action === 'demote') {
                await apiClient.lobby.updateMember(lobbyId, memberId, 'member');
              } else if (action === 'remove') {
                await apiClient.lobby.removeMember(lobbyId, memberId);
              }
              await render();
            } catch (error) {
              console.error('Mitgliedsänderung fehlgeschlagen.', error);
              showInfoMessage({
                title: 'Aktion fehlgeschlagen',
                text: 'Die Änderung konnte nicht durchgeführt werden.',
                confirmText: 'Okay',
              });
            }
          }, { once: true });
        });
      };

      render();
    }

    async function promptForSourceLobby({ title, excludeActive = true } = {}) {
      const choices = lobbies.filter((entry) => !excludeActive || !activeLobbyState || entry.id !== activeLobbyState.id);
      if (choices.length === 0) {
        showInfoMessage({
          title: 'Keine weiteren Lobbys',
          text: 'Es sind keine weiteren Lobbys verfügbar.',
          confirmText: 'Okay',
        });
        return null;
      }
      const selectId = `lobby-source-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve) => {
        showConfirmation({
          title,
          html: `<div class="modal-field"><label for="${selectId}">Quelle auswählen</label><select id="${selectId}" class="modal-select">${choices.map((entry) => `<option value="${entry.id}">${escapeHtml(entry.name)}${entry.isPersonal ? ' (persönlich)' : ''}</option>`).join('')}</select></div>`,
          confirmText: 'Übernehmen',
          cancelText: 'Abbrechen',
          focus: 'confirm',
          onConfirm: () => {
            const selectEl = document.getElementById(selectId);
            const value = selectEl ? Number(selectEl.value) : NaN;
            resolve(Number.isFinite(value) ? value : null);
          },
          onCancel: () => resolve(null),
        });
        requestAnimationFrame(() => {
          document.getElementById(selectId)?.focus();
        });
      });
    }

    async function clonePresetsFromLobby(sourceLobbyId, { copyNames = false, copyRoles = false } = {}) {
      if (!canWrite()) {
        showInfoMessage({
          title: 'Nur Leserechte',
          text: 'In dieser Lobby kannst du keine Daten verändern.',
          confirmText: 'Okay',
        });
        return;
      }
      if (!activeLobbyState || !Number.isInteger(sourceLobbyId) || sourceLobbyId === activeLobbyState.id) {
        return;
      }

      const tasks = [];
      if (copyNames) {
        tasks.push((async () => {
          const names = await apiClient.lobby.withLobby(sourceLobbyId, () => apiClient.savedNames.get());
          await apiClient.lobby.withLobby(activeLobbyState, () => apiClient.savedNames.set(Array.isArray(names) ? names : []));
        })());
      }
      if (copyRoles) {
        tasks.push((async () => {
          const roles = await apiClient.lobby.withLobby(sourceLobbyId, () => apiClient.rolePresets.get());
          await apiClient.lobby.withLobby(activeLobbyState, () => apiClient.rolePresets.set(Array.isArray(roles) ? roles : []));
        })());
      }

      try {
        await Promise.all(tasks);
        if (copyNames && cloneNamesBtn) {
          cloneNamesBtn.classList.add('success');
          setTimeout(() => cloneNamesBtn.classList.remove('success'), 1200);
        }
        if (copyRoles && cloneRolesBtn) {
          cloneRolesBtn.classList.add('success');
          setTimeout(() => cloneRolesBtn.classList.remove('success'), 1200);
        }
      } catch (error) {
        console.error('Voreinstellungen konnten nicht kopiert werden.', error);
        showInfoMessage({
          title: 'Kopieren fehlgeschlagen',
          text: 'Die ausgewählten Daten konnten nicht kopiert werden.',
          confirmText: 'Okay',
        });
      }
    }

    async function handleCreateLobby() {
      const name = await showLobbyPrompt({
        title: 'Neue Lobby anlegen',
        label: 'Lobbynamen eingeben',
        placeholder: 'z. B. Sommerlager',
        defaultValue: '',
        validate: (value) => value.trim().length >= 2,
        onInvalid: () => showInfoMessage({ title: 'Ungültiger Name', text: 'Der Name muss mindestens zwei Zeichen haben.', confirmText: 'Okay' }),
      });
      if (!name) {
        return;
      }
      await withButtonLoading(createLobbyBtn, 'Erstelle …', async () => {
        try {
          const response = await apiClient.lobby.create({ name });
          if (Array.isArray(response?.lobbies)) {
            lobbies = response.lobbies;
          }
          if (response?.lobby) {
            setActiveLobbyState(response.lobby, { emitEvent: true });
          } else {
            await refreshLobbies({ preserveActive: false });
          }
          showInfoMessage({
            title: 'Lobby erstellt',
            text: 'Die Lobby wurde erfolgreich erstellt.',
            confirmText: 'Okay',
          });
        } catch (error) {
          console.error('Lobby konnte nicht erstellt werden.', error);
          showInfoMessage({
            title: 'Erstellung fehlgeschlagen',
            text: 'Die Lobby konnte nicht erstellt werden.',
            confirmText: 'Okay',
          });
        }
      });
    }

    async function handleJoinLobby() {
      const code = await showLobbyPrompt({
        title: 'Lobby beitreten',
        label: 'Beitrittscode eingeben',
        placeholder: 'CODE123',
        validate: (value) => value.length >= 4,
        onInvalid: () => showInfoMessage({ title: 'Ungültiger Code', text: 'Bitte gib einen gültigen Beitrittscode ein.', confirmText: 'Okay' }),
        confirmText: 'Beitreten',
      });
      if (!code) {
        return;
      }
      await withButtonLoading(joinLobbyBtn, 'Tritt bei …', async () => {
        try {
          const response = await apiClient.lobby.join({ code });
          if (Array.isArray(response?.lobbies)) {
            lobbies = response.lobbies;
          }
          if (response?.lobby) {
            setActiveLobbyState(response.lobby, { emitEvent: true });
          } else {
            await refreshLobbies({ preserveActive: false });
          }
          showInfoMessage({
            title: 'Beitritt erfolgreich',
            text: 'Du bist der Lobby beigetreten.',
            confirmText: 'Okay',
          });
        } catch (error) {
          console.error('Lobby konnte nicht beigetreten werden.', error);
          showInfoMessage({
            title: 'Beitritt fehlgeschlagen',
            text: 'Der Beitrittscode wurde nicht akzeptiert.',
            confirmText: 'Okay',
          });
        }
      });
    }

    function handleShareLobby() {
      if (!activeLobbyState || !activeLobbyState.joinCode) {
        showInfoMessage({
          title: 'Kein Beitrittscode',
          text: 'Für diese Lobby steht kein Beitrittscode zur Verfügung.',
          confirmText: 'Okay',
        });
        return;
      }
      showInfoMessage({
        title: 'Beitrittscode',
        html: `<p class="join-code">${escapeHtml(activeLobbyState.joinCode)}</p><p class="join-hint">Teile diesen Code mit deinem Team, um gemeinsam an Sessions und Voreinstellungen zu arbeiten.</p>`,
        confirmText: 'Verstanden',
      });
    }

    async function handleDeleteOrLeaveLobby() {
      if (!activeLobbyState) {
        return;
      }
      if (activeLobbyState.isPersonal) {
        showInfoMessage({
          title: 'Nicht möglich',
          text: 'Die persönliche Lobby kann nicht verlassen werden.',
          confirmText: 'Okay',
        });
        return;
      }

      const isOwner = activeLobbyState.isOwner;
      const confirmTitle = isOwner ? 'Lobby löschen?' : 'Lobby verlassen?';
      const confirmText = isOwner
        ? 'Willst du diese Lobby wirklich dauerhaft löschen?'
        : 'Willst du diese Lobby wirklich verlassen?';

      showConfirmation({
        title: confirmTitle,
        text: confirmText,
        confirmText: isOwner ? 'Löschen' : 'Verlassen',
        cancelText: 'Abbrechen',
        modalClass: 'danger',
        onConfirm: async () => {
          if (isOwner) {
            await apiClient.lobby.remove(activeLobbyState.id, { deleteLobby: true });
          } else {
            await apiClient.lobby.remove(activeLobbyState.id);
          }
          await refreshLobbies({ preserveActive: false });
        },
      });
    }

    function bindEventHandlers() {
      if (lobbySelect) {
        lobbySelect.addEventListener('change', () => {
          const selectedId = Number(lobbySelect.value);
          const next = lobbies.find((entry) => entry.id === selectedId);
          if (next) {
            setActiveLobbyState(next, { emitEvent: true });
          }
        });
      }
      if (createLobbyBtn) {
        createLobbyBtn.addEventListener('click', handleCreateLobby);
      }
      if (joinLobbyBtn) {
        joinLobbyBtn.addEventListener('click', handleJoinLobby);
      }
      if (shareLobbyBtn) {
        shareLobbyBtn.addEventListener('click', handleShareLobby);
      }
      if (manageLobbyBtn) {
        manageLobbyBtn.addEventListener('click', openManageMembers);
      }
      if (cloneNamesBtn) {
        cloneNamesBtn.addEventListener('click', async () => {
          const sourceId = await promptForSourceLobby({ title: 'Namen kopieren' });
          if (Number.isInteger(sourceId)) {
            await clonePresetsFromLobby(sourceId, { copyNames: true });
          }
        });
      }
      if (cloneRolesBtn) {
        cloneRolesBtn.addEventListener('click', async () => {
          const sourceId = await promptForSourceLobby({ title: 'Rollenvoreinstellungen kopieren' });
          if (Number.isInteger(sourceId)) {
            await clonePresetsFromLobby(sourceId, { copyRoles: true });
          }
        });
      }
      const deleteBtn = document.getElementById('leave-lobby-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteOrLeaveLobby);
      }
    }

    bindEventHandlers();

    return {
      async initialize() {
        return refreshLobbies({ preserveActive: true });
      },
      async refresh() {
        return refreshLobbies({ preserveActive: true });
      },
      getActiveLobby() {
        return cloneLobby(activeLobbyState);
      },
      canEditActiveLobby() {
        return canWrite();
      },
      onChange(listener) {
        if (typeof listener === 'function') {
          changeListeners.add(listener);
          listener(cloneLobby(activeLobbyState));
        }
        return () => changeListeners.delete(listener);
      },
      handleUserChange(user, { refreshCaches = false } = {}) {
        if (!user) {
          lobbies = [];
          setActiveLobbyState(null, { emitEvent: true });
          return;
        }
        refreshLobbies({ preserveActive: !refreshCaches });
      },
      async cloneFrom(sourceLobbyId, options) {
        await clonePresetsFromLobby(sourceLobbyId, options);
      },
      setActiveLobbyById(lobbyId) {
        const target = lobbies.find((entry) => entry.id === lobbyId);
        if (target) {
          setActiveLobbyState(target, { emitEvent: true });
        }
      },
      canWriteActiveLobby() {
        return canWrite();
      },
    };
  }

  const eventDeckMetadata = Array.isArray(window.WERWOLF_EVENT_DECKS)
    ? window.WERWOLF_EVENT_DECKS.slice()
    : [];
  const eventCardDefinitions = Array.isArray(window.WERWOLF_EVENT_DEFINITIONS)
    ? window.WERWOLF_EVENT_DEFINITIONS.slice()
    : [];
  const campaignDefinitions = Array.isArray(window.WERWOLF_CAMPAIGNS)
    ? window.WERWOLF_CAMPAIGNS.slice()
    : [];
  eventDefinitionsReady = true;

  function applyEventLocalization() {
    if (!eventDefinitionsReady) {
      return;
    }
    eventCardDefinitions.forEach((card) => {
      if (!card || !card.id) {
        return;
      }
      if (!card.__localizedWrapped) {
        const originalEffect = typeof card.effect === 'function' ? card.effect.bind(card) : null;
        if (originalEffect) {
          card.effect = function (...args) {
            const result = originalEffect(...args);
            const currentStrings = localization.getEventStrings(card.id) || {};
            if (result && typeof result === 'object') {
              if (currentStrings.log) {
                result.log = {
                  ...(result.log || {}),
                  label: currentStrings.log.label || result.log?.label || undefined,
                  detail: currentStrings.log.detail || result.log?.detail || undefined,
                };
              }
              if (currentStrings.message && Object.prototype.hasOwnProperty.call(result, 'message')) {
                result.message = currentStrings.message;
              }
              if (currentStrings.note && Object.prototype.hasOwnProperty.call(result, 'narratorNote')) {
                result.narratorNote = currentStrings.note;
              }
            }
            return result;
          };
        }
        if (typeof card.preview === 'function') {
          const originalPreview = card.preview.bind(card);
          card.preview = function (...args) {
            const currentStrings = localization.getEventStrings(card.id);
            if (currentStrings?.preview) {
              return currentStrings.preview;
            }
            return originalPreview(...args);
          };
        }
        card.__localizedWrapped = true;
      }
      const strings = localization.getEventStrings(card.id);
      if (strings?.label) {
        card.label = strings.label;
      }
      if (strings?.description) {
        card.description = strings.description;
      }
    });
    renderEventDeckControls();
    renderEventCardPreview();
    renderCampaignSelect();
    renderCampaignPreview();
  }

  if (eventDeckMetadata.length === 0) {
    eventDeckMetadata.push({
      id: 'legacy',
      name: 'Klassisches Deck',
      description: 'Erhält die bekannten Ereignisse Blutmond und Phoenix Pulse.'
    });
  }

  if (eventCardDefinitions.length === 0) {
    eventCardDefinitions.push(
      {
        id: 'blood-moon',
        legacyKey: 'bloodMoon',
        deckId: 'legacy',
        label: '🌕 Blutmond',
        description: 'Der Mond färbt sich rot – die Werwölfe dürfen ein zweites Opfer wählen.',
        cooldownNights: 1,
        pityKey: 'bloodMoonPityTimer',
        trigger(context) {
          if (!context.flags.randomEventsEnabled || !context.flags.bloodMoonEnabled) {
            return { triggered: false, reason: 'disabled' };
          }

          if (context.state.bloodMoonActive) {
            context.storage.setNumber(this.pityKey, 0);
            return { triggered: true, reason: 'forced' };
          }

          const pityTimer = context.storage.getNumber(this.pityKey, 0);
          const chance = context.helpers.getBloodMoonChance(pityTimer);
          const roll = context.random();
          const triggeredByChance = roll < chance;
          let triggered = triggeredByChance;
          let nextPity = triggered ? 0 : pityTimer + 1;
          if (!triggered && nextPity >= 3) {
            triggered = true;
            nextPity = 0;
          }
          context.storage.setNumber(this.pityKey, nextPity);

          return {
            triggered,
            pityTimer,
            chance,
            roll,
            nextPity,
            triggeredByChance
          };
        },
        effect({ scheduler, helpers, meta, nightNumber }) {
          if (!meta || !meta.triggered) {
            return { skipped: true };
          }

          scheduler.addModifier({
            id: 'blood-moon',
            label: '🌕 Blutmond',
            expiresAfterNight: nightNumber,
            originCardId: 'blood-moon'
          });

          return {
            log: {
              type: 'event',
              label: 'Blutmond steigt auf',
              detail: 'Die Werwölfe dürfen in dieser Nacht zwei Opfer wählen.'
            },
            narratorNote: 'Die Werwölfe wählen zwei Opfer.',
            meta
          };
        },
        preview() {
          return 'Werwölfe wählen zwei Opfer.';
        }
      },
      {
        id: 'phoenix-pulse',
        legacyKey: 'phoenixPulse',
        deckId: 'legacy',
        label: '🔥 Phoenix Pulse',
        description: 'Eine uralte Energie lodert durch das Dorf – Nachtopfer werden wiederbelebt.',
        trigger(context) {
          if (!context.flags.randomEventsEnabled || !context.flags.phoenixEnabled) {
            return { triggered: false, reason: 'disabled' };
          }

          const chance = context.helpers.getPhoenixPulseChance();
          const roll = context.random();
          return {
            triggered: roll < chance,
            chance,
            roll
          };
        },
        effect({ scheduler, helpers, meta }) {
          if (!meta || !meta.triggered) {
            return { skipped: true };
          }

          const alreadyQueued = scheduler.getState().queuedEffects.some(
            entry => entry.cardId === 'phoenix-pulse'
          );
          if (alreadyQueued) {
            return { skipped: true, meta };
          }

          scheduler.enqueueResolution({
            cardId: 'phoenix-pulse',
            label: '🔥 Phoenix Pulse',
            meta
          });

          return {
            log: {
              type: 'event',
              label: 'Phoenix Pulse geladen',
              detail: 'Die Phoenix Pulse lädt und wird bei Tagesanbruch explodieren.'
            },
            narratorNote: 'Nachtopfer werden am Morgen wiederbelebt.',
            message: '<br><strong>🔥 Phoenix Pulse:</strong> Eine uralte Energie sammelt sich in dieser Nacht.',
            meta
          };
        },
        preview() {
          return 'Nachtopfer kehren bei Tagesanbruch zurück.';
        }
      }
    );
  }

  if (campaignDefinitions.length === 0) {
    campaignDefinitions.push({
      id: 'legacy',
      name: 'Klassische Ereigniskette',
      description: 'Behält die bisherigen Zufallsereignisse mit sanften Vorahnungen bei.',
      deckConfig: {
        legacy: { weight: 1 }
      },
      script: [
        {
          night: 1,
          eventId: 'phoenix-pulse',
          title: 'Vorzeichen des Phönix',
          description: 'Die Phoenix Pulse knistert schon in der ersten Nacht und lädt garantiert.'
        }
      ]
    });
  }

  function buildDefaultDeckConfig() {
    const config = {};
    const decks = eventDeckMetadata.length > 0
      ? eventDeckMetadata
      : [{ id: 'legacy', name: 'Standard' }];
    decks.forEach(deck => {
      config[deck.id] = { enabled: true, weight: 1 };
    });
    return config;
  }

  function getDefaultCampaignId() {
    const firstCampaign = campaignDefinitions.find(campaign => campaign && campaign.id);
    return firstCampaign ? firstCampaign.id : null;
  }

  const defaultEventConfig = {
    bloodMoonEnabled: true,
    phoenixPulseEnabled: true,
    firstNightShield: true,
    decks: buildDefaultDeckConfig(),
    campaignId: getDefaultCampaignId()
  };

  function setConfigModalVisibility(isOpen) {
    if (!configModal) {
      return;
    }
    configModal.style.display = isOpen ? 'flex' : 'none';
    configModal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function openConfigModal() {
    setConfigModalVisibility(true);
    const firstInteractiveElement = configModal?.querySelector('button, input, select, textarea');
    if (firstInteractiveElement && typeof firstInteractiveElement.focus === 'function') {
      firstInteractiveElement.focus();
    }
  }

  function closeConfigModal() {
    setConfigModalVisibility(false);
    if (openConfigBtn && typeof openConfigBtn.focus === 'function') {
      openConfigBtn.focus();
    }
  }
  let eventConfig = loadEventConfig();
  eventConfig.decks = sanitizeDeckConfig(eventConfig.decks || {});
  let jobConfig = loadJobConfig();
  let bloodMoonConfig = loadBloodMoonConfig();
  let phoenixPulseConfig = loadPhoenixPulseConfig();

  setConfigModalVisibility(false);

  if (openConfigBtn && configModal) {
    openConfigBtn.addEventListener('click', () => {
      openConfigModal();
    });
  }

  if (closeConfigBtn) {
    closeConfigBtn.addEventListener('click', () => {
      closeConfigModal();
    });
  }

  if (closeConfigFooterBtn) {
    closeConfigFooterBtn.addEventListener('click', () => {
      closeConfigModal();
    });
  }

  function setAnalyticsModalVisibility(isOpen) {
    if (!analyticsModal) {
      return;
    }
    analyticsModal.style.display = isOpen ? 'flex' : 'none';
    analyticsModal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function focusFirstAnalyticsElement() {
    if (!analyticsModal) {
      return;
    }
    const focusable = analyticsModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus();
    }
  }

  function openAnalyticsModal() {
    if (!analyticsModal) {
      return;
    }
    lastAnalyticsTrigger = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement
      : null;
    setAnalyticsModalVisibility(true);
    focusFirstAnalyticsElement();
    loadAnalytics({ showLoading: false });
  }

  function closeAnalyticsModal() {
    if (!analyticsModal) {
      return;
    }
    setAnalyticsModalVisibility(false);
    if (lastAnalyticsTrigger) {
      lastAnalyticsTrigger.focus();
    } else if (openAnalyticsBtn && typeof openAnalyticsBtn.focus === 'function') {
      openAnalyticsBtn.focus();
    }
  }

  function setAnalyticsLoadingState(isLoading, { showLoadingText = true } = {}) {
    if (analyticsRefreshBtn) {
      analyticsRefreshBtn.disabled = isLoading;
      if (showLoadingText) {
        analyticsRefreshBtn.textContent = isLoading ? 'Aktualisiere…' : analyticsRefreshBtnDefaultText;
      }
    }
  }

  if (analyticsModal) {
    setAnalyticsModalVisibility(false);
    analyticsModal.addEventListener('click', (event) => {
      if (event.target === analyticsModal) {
        closeAnalyticsModal();
      }
    });
  }

  if (openAnalyticsBtn && analyticsModal) {
    openAnalyticsBtn.addEventListener('click', () => {
      openAnalyticsModal();
    });
  }

  if (closeAnalyticsBtn) {
    closeAnalyticsBtn.addEventListener('click', () => {
      closeAnalyticsModal();
    });
  }

  if (analyticsRefreshBtn) {
    analyticsRefreshBtn.addEventListener('click', () => {
      loadAnalytics({ showLoading: true });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (configModal?.style.display === 'flex') {
        closeConfigModal();
      }
      if (analyticsModal?.style.display === 'flex') {
        closeAnalyticsModal();
      }
    }
  });

  function cloneDeckConfig(config) {
    return Object.keys(config || {}).reduce((acc, key) => {
      const entry = config[key] || {};
      const weight = Number.isFinite(entry.weight) ? entry.weight : 1;
      acc[key] = {
        enabled: entry.enabled !== false,
        weight: Math.max(0, weight)
      };
      return acc;
    }, {});
  }

  function sanitizeDeckConfig(rawConfig) {
    const base = buildDefaultDeckConfig();
    const overrides = cloneDeckConfig(rawConfig);
    return Object.keys(base).reduce((acc, deckId) => {
      const override = overrides[deckId] || {};
      const normalizedWeight = Number.isFinite(override.weight)
        ? Math.max(0, override.weight)
        : base[deckId].weight;
      acc[deckId] = {
        enabled: override.enabled !== false && normalizedWeight > 0,
        weight: normalizedWeight > 0 ? normalizedWeight : 0
      };
      return acc;
    }, {});
  }

  function loadEventConfig() {
    try {
      const raw = getPersistedValue(EVENT_CONFIG_STORAGE_KEY);
      const defaults = {
        bloodMoonEnabled: defaultEventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: defaultEventConfig.phoenixPulseEnabled,
        firstNightShield: defaultEventConfig.firstNightShield,
        decks: cloneDeckConfig(defaultEventConfig.decks),
        campaignId: defaultEventConfig.campaignId
      };
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        bloodMoonEnabled: parsed.bloodMoonEnabled !== false,
        phoenixPulseEnabled: parsed.phoenixPulseEnabled !== false,
        firstNightShield: parsed.firstNightShield !== false,
        decks: sanitizeDeckConfig(parsed.decks || {}),
        campaignId: typeof parsed.campaignId === 'string'
          ? parsed.campaignId
          : defaults.campaignId
      };
    } catch (error) {
      return {
        bloodMoonEnabled: defaultEventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: defaultEventConfig.phoenixPulseEnabled,
        firstNightShield: defaultEventConfig.firstNightShield,
        decks: cloneDeckConfig(defaultEventConfig.decks),
        campaignId: defaultEventConfig.campaignId
      };
    }
  }

  function saveEventConfig() {
    try {
      const payload = {
        bloodMoonEnabled: !!eventConfig.bloodMoonEnabled,
        phoenixPulseEnabled: !!eventConfig.phoenixPulseEnabled,
        firstNightShield: !!eventConfig.firstNightShield,
        decks: sanitizeDeckConfig(eventConfig.decks || {}),
        campaignId: eventConfig.campaignId || null
      };
      persistValue(EVENT_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function areRandomEventsEnabled() {
    return !eventsEnabledCheckbox || eventsEnabledCheckbox.checked;
  }

  function isBloodMoonEventEnabled() {
    return !!eventConfig.bloodMoonEnabled;
  }

  function isPhoenixPulseEventEnabled() {
    return !!eventConfig.phoenixPulseEnabled;
  }

  function isBloodMoonAvailable() {
    return areRandomEventsEnabled() && isBloodMoonEventEnabled();
  }

  function isPhoenixPulseAvailable() {
    return areRandomEventsEnabled() && isPhoenixPulseEventEnabled();
  }

  function loadJobConfig() {
    try {
      const raw = getPersistedValue(JOB_CONFIG_STORAGE_KEY);
      if (!raw) {
        return { ...defaultJobConfig };
      }
      const parsed = JSON.parse(raw);
      const normalizeChance = (value, fallback) => {
        const rawChance = typeof value === 'number' ? value : fallback;
        return Number.isFinite(rawChance)
          ? Math.min(Math.max(rawChance, 0), 1)
          : fallback;
      };
      return {
        bodyguardChance: normalizeChance(parsed.bodyguardChance, defaultJobConfig.bodyguardChance),
        doctorChance: normalizeChance(parsed.doctorChance, defaultJobConfig.doctorChance)
      };
    } catch (error) {
      return { ...defaultJobConfig };
    }
  }

  function saveJobConfig() {
    if (jobConfigSaveTimeout !== null) {
      clearTimeout(jobConfigSaveTimeout);
      jobConfigSaveTimeout = null;
    }
    try {
      const normalizeChance = (value, fallback) => {
        const numeric = typeof value === 'number' ? value : fallback;
        return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : fallback;
      };
      const payload = {
        bodyguardChance: normalizeChance(jobConfig.bodyguardChance, defaultJobConfig.bodyguardChance),
        doctorChance: normalizeChance(jobConfig.doctorChance, defaultJobConfig.doctorChance)
      };
      persistValue(JOB_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadBloodMoonConfig() {
    try {
      const raw = getPersistedValue(BLOOD_MOON_CONFIG_STORAGE_KEY);
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
      persistValue(BLOOD_MOON_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors
    }
  }

  function loadPhoenixPulseConfig() {
    try {
      const raw = getPersistedValue(PHOENIX_PULSE_CONFIG_STORAGE_KEY);
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
      persistValue(PHOENIX_PULSE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
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

  function scheduleJobConfigSave() {
    if (jobConfigSaveTimeout !== null) {
      clearTimeout(jobConfigSaveTimeout);
    }
    jobConfigSaveTimeout = setTimeout(() => {
      jobConfigSaveTimeout = null;
      saveJobConfig();
    }, 150);
  }

  updateBodyguardChanceUI(jobConfig.bodyguardChance * 100, { save: false });

  if (bodyguardJobChanceInput) {
    bodyguardJobChanceInput.addEventListener('input', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: false });
      scheduleJobConfigSave();
    });
    bodyguardJobChanceInput.addEventListener('change', () => {
      updateBodyguardChanceUI(bodyguardJobChanceInput.value, { save: true });
    });
  }

  function updateDoctorChanceUI(percent, { save = false } = {}) {
    const numeric = Number(percent);
    const sanitized = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), 0), 100)
      : 0;
    jobConfig.doctorChance = sanitized / 100;
    if (doctorJobChanceInput && doctorJobChanceInput.value !== String(sanitized)) {
      doctorJobChanceInput.value = String(sanitized);
    }
    if (doctorJobChanceDisplay) {
      doctorJobChanceDisplay.textContent = `${sanitized}%`;
    }
    if (save) {
      saveJobConfig();
    }
  }

  updateDoctorChanceUI(jobConfig.doctorChance * 100, { save: false });

  if (doctorJobChanceInput) {
    doctorJobChanceInput.addEventListener('input', () => {
      updateDoctorChanceUI(doctorJobChanceInput.value, { save: false });
      scheduleJobConfigSave();
    });
    doctorJobChanceInput.addEventListener('change', () => {
      updateDoctorChanceUI(doctorJobChanceInput.value, { save: true });
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
  phoenixPulseStatus = document.getElementById('phoenix-pulse-status');
  const ambiencePlaylistContainer = document.getElementById('ambience-playlists');
  const ambienceStingerContainer = document.getElementById('ambience-stingers');
  const ambienceLightingContainer = document.getElementById('ambience-lighting');
  const ambiencePreviewList = document.getElementById('ambience-preview-list');
  const playlistAudioEl = document.getElementById('narrator-playlist-audio');
  const stingerAudioEl = document.getElementById('narrator-stinger-audio');

