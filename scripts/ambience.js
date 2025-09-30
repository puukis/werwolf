  const ambienceManager = (() => {
    if (!document || !document.body) {
      return {
        init() {},
        setPhaseAmbience() {},
        setNightStep() {},
        clearNightStep() {},
        setEventAmbience() {},
        flashPhoenixPulse() {},
        triggerStinger() {},
        setManualPlaylist() {},
        setManualLighting() {},
        getSnapshot() {
          return {
            activePlaylist: null,
            playlistSource: null,
            activeLighting: null,
            lightingSource: null,
            activeParticles: null,
            particleSource: null,
            overlays: [],
            manualPlaylist: null,
            manualLighting: null
          };
        }
      };
    }

    const MANUAL_STOP_ID = '__manual-stop__';
    const MANUAL_NEUTRAL_ID = '__manual-neutral__';
    const isJsDom = typeof window !== 'undefined'
      && !!window.navigator
      && typeof window.navigator.userAgent === 'string'
      && window.navigator.userAgent.toLowerCase().includes('jsdom');
    const playlistButtons = new Map();
    const lightingButtons = new Map();
    const manualState = { playlist: null, lighting: null };
    const sourcePriority = ['manual', 'step', 'event', 'phase'];
    const playlistSources = { manual: null, event: null, step: null, phase: null };
    const lightingSources = { manual: null, event: null, step: null, phase: null };
    const particleSources = { manual: null, event: null, step: null, phase: null };
    const overlaySources = {
      manual: new Set(),
      event: new Set(),
      step: new Set(),
      phase: new Set()
    };
    const overlayFlags = new Set();
    let activePlaylistId = null;
    let activePlaylistSource = null;
    let activeLightingId = null;
    let activeLightingSource = null;
    let activeParticleId = null;
    let activeParticleSource = null;
    let playlistTransition = Promise.resolve();

    function resolveSource(map) {
      for (const source of sourcePriority) {
        const candidate = map[source];
        if (candidate) {
          return { id: candidate, source };
        }
      }
      return { id: null, source: null };
    }

    const clampVolume = (value) => {
      if (!Number.isFinite(value)) {
        return 0;
      }
      if (value < 0) {
        return 0;
      }
      if (value > 1) {
        return 1;
      }
      return value;
    };

    function safePause(audio) {
      if (isJsDom || !audio || typeof audio.pause !== 'function') {
        return;
      }
      try {
        audio.pause();
      } catch (error) {
        // ignore jsdom not implemented errors
      }
    }

    function safePlay(audio) {
      if (isJsDom || !audio || typeof audio.play !== 'function') {
        return null;
      }
      try {
        const result = audio.play();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
        return result;
      } catch (error) {
        return null;
      }
    }

    function fadeAudio(audio, targetVolume, duration = 400) {
      if (!audio || typeof audio.volume !== 'number') {
        return Promise.resolve();
      }
      const startVolume = clampVolume(audio.volume);
      const endVolume = clampVolume(Number.isFinite(targetVolume) ? targetVolume : 0);
      const delta = endVolume - startVolume;
      if (Math.abs(delta) < 0.001 || duration <= 0) {
        audio.volume = endVolume;
        return Promise.resolve();
      }
      if (isJsDom) {
        audio.volume = endVolume;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const step = (timestamp) => {
          const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? timestamp
            : Date.now();
          const progress = Math.min(1, (now - startTime) / duration);
          const nextVolume = clampVolume(startVolume + delta * progress);
          audio.volume = nextVolume;
          if (progress < 1) {
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(step);
            } else {
              setTimeout(() => step(Date.now()), 16);
            }
          } else {
            resolve();
          }
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(step);
        } else {
          setTimeout(() => step(Date.now()), 16);
        }
      });
    }

    function updateOverlay() {
      overlayFlags.clear();
      sourcePriority.forEach((source) => {
        overlaySources[source].forEach((flag) => overlayFlags.add(flag));
      });
      if (overlayFlags.size > 0) {
        document.body.dataset.overlay = Array.from(overlayFlags).join(' ');
      } else {
        delete document.body.dataset.overlay;
      }
      updatePreview();
    }

    function setOverlayForSource(source, flags) {
      overlaySources[source] = new Set(Array.isArray(flags) ? flags : []);
      updateOverlay();
    }

    function setParticleSource(source, id) {
      particleSources[source] = id || null;
      syncParticles();
    }

    function setPlaylistSource(source, id) {
      const nextId = typeof id === 'string' ? id : null;
      playlistSources[source] = nextId;
      if (source === 'manual') {
        manualState.playlist = nextId;
        updateManualButtons();
      }
      syncPlaylist();
    }

    function setLightingSource(source, id) {
      const nextId = typeof id === 'string' ? id : null;
      lightingSources[source] = nextId;
      const preset = id ? lightingPresets[id] : null;
      const particles = preset && preset.particles ? preset.particles : null;
      setParticleSource(source, particles);
      setOverlayForSource(source, preset && Array.isArray(preset.overlay) ? preset.overlay : []);
      if (source === 'manual') {
        manualState.lighting = nextId;
        updateManualButtons();
      }
      syncLighting();
    }

    function syncPlaylist() {
      const { id: nextId, source: nextSource } = resolveSource(playlistSources);
      if (nextId === activePlaylistId && nextSource === activePlaylistSource) {
        updatePreview();
        return;
      }
      const prevId = activePlaylistId;
      activePlaylistId = nextId;
      activePlaylistSource = nextSource;
      playlistTransition = playlistTransition.then(async () => {
        if (!playlistAudioEl) {
          updatePreview();
          return;
        }
        if (prevId && prevId !== nextId && prevId !== MANUAL_STOP_ID) {
          await fadeAudio(playlistAudioEl, 0, 320);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
        }
        if (!nextId || nextId === MANUAL_STOP_ID) {
          await fadeAudio(playlistAudioEl, 0, 220);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
          playlistAudioEl.removeAttribute('src');
          updatePreview();
          return;
        }
        const config = narratorAudioLibrary.playlists[nextId];
        if (config) {
          if (playlistAudioEl.src !== config.src) {
            playlistAudioEl.src = config.src;
          }
          playlistAudioEl.loop = config.loop !== false;
          safePlay(playlistAudioEl);
          playlistAudioEl.volume = 0;
          await fadeAudio(playlistAudioEl, config.volume ?? 0.6, 620);
        } else {
          await fadeAudio(playlistAudioEl, 0, 220);
          safePause(playlistAudioEl);
          playlistAudioEl.currentTime = 0;
          playlistAudioEl.removeAttribute('src');
        }
        updatePreview();
      });
    }

    function syncLighting() {
      const { id: nextId, source: nextSource } = resolveSource(lightingSources);
      if (nextId === activeLightingId && nextSource === activeLightingSource) {
        updatePreview();
        return;
      }
      activeLightingId = nextId;
      activeLightingSource = nextSource;
      if (nextId && nextId !== MANUAL_NEUTRAL_ID) {
        document.body.dataset.lighting = nextId;
      } else {
        delete document.body.dataset.lighting;
      }
      updatePreview();
    }

    function syncParticles() {
      const { id: nextId, source: nextSource } = resolveSource(particleSources);
      if (nextId === activeParticleId && nextSource === activeParticleSource) {
        updatePreview();
        return;
      }
      activeParticleId = nextId;
      activeParticleSource = nextSource;
      if (nextId) {
        document.body.dataset.particles = nextId;
      } else {
        delete document.body.dataset.particles;
      }
      updatePreview();
    }

    function triggerStinger(id) {
      const config = narratorAudioLibrary.stingers[id];
      if (!stingerAudioEl || !config) {
        return;
      }
      safePause(stingerAudioEl);
      stingerAudioEl.currentTime = 0;
      stingerAudioEl.src = config.src;
      stingerAudioEl.volume = 0;
      safePlay(stingerAudioEl);
      fadeAudio(stingerAudioEl, config.volume ?? 0.85, 140).then(() => {
        setTimeout(() => {
          fadeAudio(stingerAudioEl, 0, 220).then(() => {
            safePause(stingerAudioEl);
            stingerAudioEl.currentTime = 0;
          });
        }, 260);
      });
    }

    function updateManualButtons() {
      playlistButtons.forEach((btn, id) => {
        btn.setAttribute('aria-pressed', manualState.playlist === id ? 'true' : 'false');
      });
      lightingButtons.forEach((btn, id) => {
        btn.setAttribute('aria-pressed', manualState.lighting === id ? 'true' : 'false');
      });
    }

    function buildControls() {
      playlistButtons.clear();
      lightingButtons.clear();
      if (ambiencePlaylistContainer) {
        ambiencePlaylistContainer.innerHTML = '';
      }
      if (ambienceStingerContainer) {
        ambienceStingerContainer.innerHTML = '';
      }
      if (ambienceLightingContainer) {
        ambienceLightingContainer.innerHTML = '';
      }
      if (ambiencePlaylistContainer) {
        Object.values(narratorAudioLibrary.playlists).forEach((config) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = config.label;
          btn.dataset.id = config.id;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', () => {
            const nextId = manualState.playlist === config.id ? null : config.id;
            setManualPlaylist(nextId);
          });
          ambiencePlaylistContainer.appendChild(btn);
          playlistButtons.set(config.id, btn);
        });
        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'ambience-toggle';
        stopBtn.textContent = '⏹️ Stoppen';
        stopBtn.setAttribute('aria-pressed', 'false');
        stopBtn.addEventListener('click', () => {
          const nextId = manualState.playlist === MANUAL_STOP_ID ? null : MANUAL_STOP_ID;
          setManualPlaylist(nextId);
        });
        stopBtn.dataset.id = MANUAL_STOP_ID;
        ambiencePlaylistContainer.appendChild(stopBtn);
        playlistButtons.set(MANUAL_STOP_ID, stopBtn);
      }

      if (ambienceStingerContainer) {
        Object.values(narratorAudioLibrary.stingers).forEach((config) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = config.label;
          btn.addEventListener('click', () => {
            triggerStinger(config.id);
          });
          ambienceStingerContainer.appendChild(btn);
        });
      }

      if (ambienceLightingContainer) {
        Object.entries(lightingPresets).forEach(([id, preset]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ambience-toggle';
          btn.textContent = preset.label;
          btn.dataset.id = id;
          btn.setAttribute('aria-pressed', 'false');
          btn.addEventListener('click', () => {
            const nextId = manualState.lighting === id ? null : id;
            setManualLighting(nextId);
          });
          ambienceLightingContainer.appendChild(btn);
          lightingButtons.set(id, btn);
        });
        const neutralBtn = document.createElement('button');
        neutralBtn.type = 'button';
        neutralBtn.className = 'ambience-toggle';
        neutralBtn.textContent = '🌫️ Neutral';
        neutralBtn.setAttribute('aria-pressed', 'false');
        neutralBtn.addEventListener('click', () => {
          const nextId = manualState.lighting === MANUAL_NEUTRAL_ID ? null : MANUAL_NEUTRAL_ID;
          setManualLighting(nextId);
        });
        neutralBtn.dataset.id = MANUAL_NEUTRAL_ID;
        ambienceLightingContainer.appendChild(neutralBtn);
        lightingButtons.set(MANUAL_NEUTRAL_ID, neutralBtn);
      }

      updateManualButtons();
    }

    function updatePreview() {
      if (!ambiencePreviewList) {
        return;
      }
      ambiencePreviewList.innerHTML = '';
      const entries = [];
      if (activePlaylistId === MANUAL_STOP_ID) {
        entries.push({ icon: '🎵', label: '⏹️ Stumm', source: activePlaylistSource });
      } else if (activePlaylistId) {
        const config = narratorAudioLibrary.playlists[activePlaylistId];
        const label = config ? config.label : activePlaylistId;
        entries.push({ icon: '🎵', label, source: activePlaylistSource });
      }
      if (activeLightingId === MANUAL_NEUTRAL_ID) {
        entries.push({ icon: '💡', label: '🌫️ Neutral', source: activeLightingSource });
      } else if (activeLightingId) {
        const preset = lightingPresets[activeLightingId];
        const label = preset ? preset.label : activeLightingId;
        entries.push({ icon: '💡', label, source: activeLightingSource });
      }
      if (activeParticleId) {
        entries.push({ icon: '✨', label: activeParticleId, source: activeParticleSource });
      }
      overlayFlags.forEach((flag) => {
        const label = overlayLabels[flag] || flag;
        entries.push({ icon: '🌌', label, source: 'event' });
      });

      if (entries.length === 0) {
        const item = document.createElement('li');
        item.className = 'ambience-empty';
        item.textContent = 'Keine Effekte aktiv.';
        ambiencePreviewList.appendChild(item);
        return;
      }

      entries.forEach((entry) => {
        const li = document.createElement('li');
        const iconSpan = document.createElement('span');
        iconSpan.textContent = entry.icon;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = entry.label;
        li.appendChild(iconSpan);
        li.appendChild(labelSpan);
        if (entry.source) {
          const tag = document.createElement('span');
          tag.className = 'ambience-tag';
          tag.textContent = sourceLabels[entry.source] || entry.source;
          li.appendChild(tag);
        }
        ambiencePreviewList.appendChild(li);
      });
    }

    function setPhaseAmbience(phaseKey) {
      const preset = phaseAmbiencePresets[phaseKey] || phaseAmbiencePresets.setup;
      setPlaylistSource('phase', preset.playlist || null);
      setLightingSource('phase', preset.lighting || null);
      setParticleSource('phase', preset.particles || null);
    }

    function setNightStep(role) {
      const preset = role && nightStepAmbience[role] ? nightStepAmbience[role] : null;
      setPlaylistSource('step', preset && preset.playlist ? preset.playlist : null);
      setLightingSource('step', preset ? preset.lighting || null : null);
      setParticleSource('step', preset ? preset.particles || null : null);
    }

    function setEventAmbience(eventKey, active) {
      if (!active) {
        if (eventKey === 'blood-moon' && playlistSources.event === 'bloodmoon') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'phoenix' && playlistSources.event === 'phoenix') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'victory' && playlistSources.event === 'daybreak') {
          setPlaylistSource('event', null);
        }
        if (eventKey === 'blood-moon' && lightingSources.event === 'blood-moon') {
          setLightingSource('event', null);
        }
        if (eventKey === 'phoenix' && lightingSources.event === 'phoenix') {
          setLightingSource('event', null);
        }
        if (eventKey === 'victory' && lightingSources.event === 'victory') {
          setLightingSource('event', null);
        }
        return;
      }
      if (eventKey === 'blood-moon') {
        setPlaylistSource('event', 'bloodmoon');
        setLightingSource('event', 'blood-moon');
      } else if (eventKey === 'phoenix') {
        setPlaylistSource('event', 'phoenix');
        setLightingSource('event', 'phoenix');
      } else if (eventKey === 'victory') {
        setPlaylistSource('event', 'daybreak');
        setLightingSource('event', 'victory');
      }
    }

    function flashPhoenixPulse() {
      setPlaylistSource('step', 'phoenix');
      setLightingSource('step', 'phoenix');
      triggerStinger('phoenixRise');
      setTimeout(() => {
        if (lightingSources.step === 'phoenix') {
          setLightingSource('step', null);
          setPlaylistSource('step', null);
        }
      }, 3600);
    }

    function setManualPlaylist(id) {
      setPlaylistSource('manual', id);
    }

    function setManualLighting(id) {
      setLightingSource('manual', id);
    }

    function getSnapshot() {
      const effectivePlaylist = activePlaylistId === MANUAL_STOP_ID ? null : activePlaylistId;
      const effectiveLighting = activeLightingId === MANUAL_NEUTRAL_ID ? null : activeLightingId;
      return {
        activePlaylist: effectivePlaylist,
        playlistSource: activePlaylistSource,
        activeLighting: effectiveLighting,
        lightingSource: activeLightingSource,
        activeParticles: activeParticleId,
        particleSource: activeParticleSource,
        overlays: Array.from(overlayFlags),
        manualPlaylist: manualState.playlist,
        manualLighting: manualState.lighting,
        manualStopActive: manualState.playlist === MANUAL_STOP_ID,
        manualNeutralActive: manualState.lighting === MANUAL_NEUTRAL_ID
      };
    }

    function init() {
      buildControls();
      setPhaseAmbience('setup');
      syncPlaylist();
      syncLighting();
      syncParticles();
      updateOverlay();
      updatePreview();
    }

    return {
      init,
      setPhaseAmbience,
      setNightStep,
      clearNightStep() {
        setPlaylistSource('step', null);
        setLightingSource('step', null);
        setParticleSource('step', null);
      },
      setEventAmbience,
      flashPhoenixPulse,
      triggerStinger,
      setManualPlaylist,
      setManualLighting,
      getSnapshot
    };
  })();

  const initAmbienceManager = () => {
    try {
      ambienceManager.init();
    } catch (error) {
      console.error('Ambience manager failed to initialize', error);
    }
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(initAmbienceManager);
  } else {
    Promise.resolve().then(initAmbienceManager);
  }

  function showWin(title, message) {
    ambienceManager.setPhaseAmbience('victory');
    ambienceManager.setEventAmbience('victory', true);
    ambienceManager.setEventAmbience('blood-moon', false);
    ambienceManager.setEventAmbience('phoenix', false);
    ambienceManager.clearNightStep();
    winTitle.textContent = title;
    winMessage.textContent = message;
    winOverlay.style.display = 'flex';
    winOverlay.classList.add('show');
    winBtn.onclick = () => location.reload();
    lastWinner = {
      title,
      message,
      timestamp: Date.now()
    };
    queueMicrotask(() => {
      if (typeof loadAnalytics === 'function') {
        loadAnalytics({ showLoading: false });
      }
    });
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
  let doctorPlayers = [];
  let doctorPendingTargets = [];
  let doctorPendingNight = null;
  let doctorTriggerSourceNight = null;
  let doctorLastHealedTarget = null;
  let doctorLastHealedNight = null;
  let lastWinner = null;

  function setBloodMoonState(isActive) {
    bloodMoonActive = !!isActive;
    if (bloodMoonActive) {
      document.body.classList.add('blood-moon-active');
      ambienceManager.setEventAmbience('blood-moon', true);
      ambienceManager.triggerStinger('bloodStrike');
    } else {
      document.body.classList.remove('blood-moon-active');
      ambienceManager.setEventAmbience('blood-moon', false);
    }
    updateBloodMoonOdds();
  }

  function clearBloodMoonState() {
    setBloodMoonState(false);
  }

  function clearPhoenixPulseState() {
    phoenixPulsePending = false;
    phoenixPulseJustResolved = false;
    phoenixPulseRevivedPlayers = [];
    setPhoenixPulseCharged(false);
    ambienceManager.setEventAmbience('phoenix', false);
  }

  function refreshEventUI() {
    updateBloodMoonOdds();
    updatePhoenixPulseStatus();
  }

  const eventModifierHandlers = {
    'blood-moon': {
      apply() {
        setBloodMoonState(true);
        syncBloodMoonUI({ silent: true });
      },
      expire() {
        setBloodMoonState(false);
        syncBloodMoonUI({ silent: true });
      }
    }
  };

  const eventQueueHandlers = {
    'phoenix-pulse': {
      onEnqueue() {
        phoenixPulsePending = true;
        phoenixPulseJustResolved = false;
        setPhoenixPulseCharged(true);
        updatePhoenixPulseStatus();
      },
      onComplete(_meta, payload = {}) {
        if (payload && payload.deferClear) {
          return;
        }
        phoenixPulsePending = false;
        setPhoenixPulseCharged(false);
        updatePhoenixPulseStatus();
      }
    }
  };

  function sanitizeSchedulerState(raw = {}) {
    const normalizeModifier = (modifier) => {
      if (!modifier) {
        return null;
      }
      const id = typeof modifier.id === 'string' && modifier.id.trim()
        ? modifier.id.trim()
        : (typeof modifier.originCardId === 'string' && modifier.originCardId.trim()
          ? modifier.originCardId.trim()
          : `mod-${Date.now()}`);
      const origin = typeof modifier.originCardId === 'string' && modifier.originCardId.trim()
        ? modifier.originCardId.trim()
        : id;
      const expiresAfterNight = Number.isFinite(modifier.expiresAfterNight)
        ? modifier.expiresAfterNight
        : null;
      return {
        id,
        label: modifier.label || id,
        originCardId: origin,
        expiresAfterNight
      };
    };

    const normalizeQueueEntry = (entry) => {
      if (!entry) {
        return null;
      }
      const cardId = typeof entry.cardId === 'string' && entry.cardId.trim()
        ? entry.cardId.trim()
        : (typeof entry.id === 'string' ? entry.id : 'event');
      return {
        id: typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim()
          : `${cardId}-${Date.now()}`,
        cardId,
        label: entry.label || cardId,
        meta: entry.meta || null,
        night: Number.isFinite(entry.night) ? entry.night : null,
        scheduledAt: Number.isFinite(entry.scheduledAt) ? entry.scheduledAt : Date.now()
      };
    };

    const normalizeHistoryEntry = (entry) => {
      if (!entry) {
        return null;
      }
      const normalized = normalizeQueueEntry(entry);
      return {
        ...normalized,
        payload: entry.payload || null,
        recordedAt: Number.isFinite(entry.recordedAt) ? entry.recordedAt : Date.now(),
        resolvedAt: Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : null
      };
    };

    const activeModifiers = Array.isArray(raw.activeModifiers)
      ? raw.activeModifiers.map(normalizeModifier).filter(Boolean)
      : [];
    const queuedEffects = Array.isArray(raw.queuedEffects)
      ? raw.queuedEffects.map(normalizeQueueEntry).filter(Boolean)
      : [];
    const history = Array.isArray(raw.history)
      ? raw.history.map(normalizeHistoryEntry).filter(Boolean).slice(0, 25)
      : [];

    return {
      activeModifiers,
      queuedEffects,
      history
    };
  }

  function createEventScheduler(initialState = {}, onChange) {
    const state = sanitizeSchedulerState(initialState);
    const notify = () => {
      if (typeof onChange === 'function') {
        onChange(state);
      }
    };

    return {
      addModifier(modifier) {
        const normalized = sanitizeSchedulerState({ activeModifiers: [modifier] }).activeModifiers[0];
        if (!normalized) {
          return null;
        }
        state.activeModifiers = state.activeModifiers.filter(entry => entry.id !== normalized.id);
        state.activeModifiers.push(normalized);
        const handler = eventModifierHandlers[normalized.originCardId] || eventModifierHandlers[normalized.id];
        if (handler && typeof handler.apply === 'function') {
          handler.apply({ modifier: normalized });
        }
        notify();
        return normalized;
      },
      clearExpiredModifiers(currentNight) {
        const remaining = [];
        let changed = false;
        state.activeModifiers.forEach(modifier => {
          if (modifier.expiresAfterNight !== null && currentNight > modifier.expiresAfterNight) {
            const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
            if (handler && typeof handler.expire === 'function') {
              handler.expire({ modifier, night: currentNight });
            }
            changed = true;
          } else {
            remaining.push(modifier);
          }
        });
        state.activeModifiers = remaining;
        if (changed) {
          notify();
        }
      },
      removeModifier(modifierId) {
        let changed = false;
        state.activeModifiers = state.activeModifiers.filter(modifier => {
          if (modifier.id === modifierId) {
            const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
            if (handler && typeof handler.expire === 'function') {
              handler.expire({ modifier, night: null });
            }
            changed = true;
            return false;
          }
          return true;
        });
        if (changed) {
          notify();
        }
      },
      enqueueResolution(entry) {
        const normalized = sanitizeSchedulerState({ queuedEffects: [entry] }).queuedEffects[0];
        if (!normalized) {
          return null;
        }
        state.queuedEffects.push(normalized);
        const handler = eventQueueHandlers[normalized.cardId];
        if (handler && typeof handler.onEnqueue === 'function') {
          handler.onEnqueue(normalized.meta || {}, { entry: normalized });
        }
        notify();
        return normalized;
      },
      completeQueuedEffect(cardId, payload = {}) {
        let completed = null;
        state.queuedEffects = state.queuedEffects.filter(entry => {
          if (!completed && entry.cardId === cardId) {
            completed = entry;
            return false;
          }
          return true;
        });
        if (completed) {
          const handler = eventQueueHandlers[completed.cardId];
          if (handler && typeof handler.onComplete === 'function') {
            handler.onComplete(completed.meta || {}, payload, { entry: completed });
          }
          state.history.unshift({ ...completed, payload, resolvedAt: Date.now() });
          if (state.history.length > 25) {
            state.history.length = 25;
          }
          notify();
        }
        return completed;
      },
      recordHistory(entry) {
        state.history.unshift({ ...entry, recordedAt: Date.now() });
        if (state.history.length > 25) {
          state.history.length = 25;
        }
        notify();
      },
      clearAll({ silent = false } = {}) {
        state.activeModifiers = [];
        state.queuedEffects = [];
        state.history = [];
        if (!silent) {
          notify();
        }
      },
      replaceState(nextState = {}, { silent = false } = {}) {
        const sanitized = sanitizeSchedulerState(nextState);
        state.activeModifiers = sanitized.activeModifiers;
        state.queuedEffects = sanitized.queuedEffects;
        state.history = sanitized.history;
        if (!silent) {
          notify();
        }
      },
      getState() {
        return sanitizeSchedulerState(state);
      }
    };
  }

  function buildDefaultCampaignProgress() {
    return {
      id: defaultEventConfig.campaignId || null,
      executed: []
    };
  }

  function loadEventEngineState() {
    const defaults = {
      scheduler: sanitizeSchedulerState(),
      campaignProgress: buildDefaultCampaignProgress()
    };

    try {
      const raw = getPersistedValue(EVENT_ENGINE_STORAGE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        scheduler: sanitizeSchedulerState(parsed.scheduler || {}),
        campaignProgress: {
          id: typeof parsed?.campaignProgress?.id === 'string'
            ? parsed.campaignProgress.id
            : defaults.campaignProgress.id,
          executed: Array.isArray(parsed?.campaignProgress?.executed)
            ? parsed.campaignProgress.executed.slice(0, 50)
            : []
        }
      };
    } catch (error) {
      return defaults;
    }
  }

  let eventEngineState = loadEventEngineState();

  const eventScheduler = createEventScheduler(eventEngineState.scheduler, () => {
    eventEngineState.scheduler = eventScheduler.getState();
    persistEventEngineState();
    renderNarratorDashboard();
  });

  function persistEventEngineState() {
    try {
      const payload = {
        scheduler: eventScheduler.getState(),
        campaignProgress: {
          id: eventEngineState?.campaignProgress?.id || null,
          executed: Array.isArray(eventEngineState?.campaignProgress?.executed)
            ? eventEngineState.campaignProgress.executed.slice(0, 50)
            : []
        }
      };
      persistValue(EVENT_ENGINE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore persistence errors
    }
  }

  function setCampaignProgress(newProgress) {
    eventEngineState.campaignProgress = {
      id: newProgress?.id || null,
      executed: Array.isArray(newProgress?.executed)
        ? newProgress.executed.slice(0, 50)
        : []
    };
    persistEventEngineState();
    renderCampaignPreview();
  }

  function resetCampaignProgress(campaignId) {
    setCampaignProgress({ id: campaignId || null, executed: [] });
  }

  function markCampaignStepExecuted(step) {
    if (!step) {
      return;
    }
    const key = `${step.night || 0}:${step.eventId || step.id}`;
    const progress = eventEngineState.campaignProgress || buildDefaultCampaignProgress();
    if (!Array.isArray(progress.executed)) {
      progress.executed = [];
    }
    if (!progress.executed.includes(key)) {
      progress.executed.push(key);
      setCampaignProgress({ id: progress.id, executed: progress.executed });
    }
    renderCampaignPreview();
  }

  function rehydrateEventSideEffects() {
    clearBloodMoonState();
    clearPhoenixPulseState();
    const schedulerState = eventScheduler.getState();
    schedulerState.activeModifiers.forEach(modifier => {
      const handler = eventModifierHandlers[modifier.originCardId] || eventModifierHandlers[modifier.id];
      if (handler && typeof handler.apply === 'function') {
        handler.apply({ modifier, fromRestore: true });
      }
    });
    schedulerState.queuedEffects.forEach(entry => {
      const handler = eventQueueHandlers[entry.cardId];
      if (handler && typeof handler.onEnqueue === 'function') {
        handler.onEnqueue(entry.meta || {}, { entry, fromRestore: true });
      }
    });
    refreshEventUI();
  }

  function getEventEngineSnapshot() {
    return {
      scheduler: eventScheduler.getState(),
      campaignProgress: {
        id: eventEngineState?.campaignProgress?.id || null,
        executed: Array.isArray(eventEngineState?.campaignProgress?.executed)
          ? eventEngineState.campaignProgress.executed.slice(0, 50)
          : []
      }
    };
  }

  function restoreEventEngineState(nextState) {
    if (nextState) {
      eventScheduler.replaceState(nextState.scheduler || {}, { silent: true });
      setCampaignProgress(nextState.campaignProgress || {});
    } else {
      eventScheduler.clearAll({ silent: true });
      setCampaignProgress(buildDefaultCampaignProgress());
    }
    rehydrateEventSideEffects();
  }

  if (bloodMoonEnabledCheckbox) {
    bloodMoonEnabledCheckbox.checked = !!eventConfig.bloodMoonEnabled;
  }

  if (firstNightShieldCheckbox) {
    firstNightShieldCheckbox.checked = eventConfig.firstNightShield !== false;
  }

  if (phoenixPulseEnabledCheckbox) {
    phoenixPulseEnabledCheckbox.checked = !!eventConfig.phoenixPulseEnabled;
  }

  function applyGlobalEventsEnabledState() {
    if (!areRandomEventsEnabled()) {
      eventScheduler.clearAll({ silent: true });
      clearBloodMoonState();
      clearPhoenixPulseState();
      persistEventEngineState();
    } else {
      rehydrateEventSideEffects();
    }
    refreshEventUI();
    renderNarratorDashboard();
  }

  function getActiveDeckIds() {
    return Object.entries(eventConfig.decks || {})
      .filter(([, cfg]) => cfg && cfg.enabled !== false && Number(cfg.weight) > 0)
      .map(([deckId]) => deckId);
  }

  function renderEventDeckControls() {
    if (!eventDeckListEl) {
      return;
    }
    const decks = eventDeckMetadata.length > 0
      ? eventDeckMetadata
      : [{ id: 'legacy', name: 'Standard', description: 'Blutmond & Phoenix Pulse' }];
    eventDeckListEl.innerHTML = '';

    decks.forEach(deck => {
      const config = eventConfig.decks[deck.id] || { enabled: true, weight: 1 };
      const entry = document.createElement('div');
      entry.className = 'deck-config-entry';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'config-toggle';
      const toggleSpan = document.createElement('span');
      const deckNameKey = `events.decks.${deck.id}.name`;
      toggleSpan.textContent = localization.t(deckNameKey) || deck.name || deck.id;
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.id = `deck-toggle-${deck.id}`;
      toggleInput.checked = config.enabled !== false && Number(config.weight) > 0;
      toggleLabel.appendChild(toggleSpan);
      toggleLabel.appendChild(toggleInput);
      entry.appendChild(toggleLabel);

      const sliderWrapper = document.createElement('div');
      sliderWrapper.className = 'config-slider';
      const sliderLabel = document.createElement('label');
      sliderLabel.setAttribute('for', `deck-weight-${deck.id}`);
      sliderLabel.textContent = localization.t('settings.events.deckWeight') || 'Gewichtung';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = `deck-weight-${deck.id}`;
      slider.min = '0';
      slider.max = '3';
      slider.step = '0.5';
      const currentWeight = Math.max(0, Number(config.weight) || 0);
      slider.value = String(Math.min(Math.max(currentWeight, 0), 3));
      const weightDisplay = document.createElement('span');
      weightDisplay.className = 'deck-weight-display';

      const updateWeightDisplay = () => {
        const value = Number(slider.value);
        weightDisplay.textContent = `${value.toFixed(1)}x`;
        slider.disabled = !toggleInput.checked;
      };

      updateWeightDisplay();

      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        if (!eventConfig.decks[deck.id]) {
          eventConfig.decks[deck.id] = { enabled: toggleInput.checked, weight: value };
        } else {
          eventConfig.decks[deck.id].weight = value;
        }
        if (value <= 0) {
          toggleInput.checked = false;
          eventConfig.decks[deck.id].enabled = false;
        } else if (!toggleInput.checked) {
          toggleInput.checked = true;
          eventConfig.decks[deck.id].enabled = true;
        }
        updateWeightDisplay();
      });

      slider.addEventListener('change', () => {
        saveEventConfig();
        renderEventCardPreview();
      });

      toggleInput.addEventListener('change', () => {
        if (!eventConfig.decks[deck.id]) {
          eventConfig.decks[deck.id] = { enabled: true, weight: 1 };
        }
        eventConfig.decks[deck.id].enabled = toggleInput.checked;
        if (!toggleInput.checked) {
          slider.value = '0';
          eventConfig.decks[deck.id].weight = 0;
        } else if (Number(eventConfig.decks[deck.id].weight) <= 0) {
          slider.value = '1';
          eventConfig.decks[deck.id].weight = 1;
        }
        updateWeightDisplay();
        saveEventConfig();
        renderEventCardPreview();
      });

      sliderWrapper.appendChild(sliderLabel);
      sliderWrapper.appendChild(slider);
      sliderWrapper.appendChild(weightDisplay);
      entry.appendChild(sliderWrapper);

      const deckDescriptionKey = `events.decks.${deck.id}.description`;
      const deckDescription = localization.t(deckDescriptionKey) || deck.description;
      if (deckDescription) {
        const helper = document.createElement('p');
        helper.className = 'config-helper';
        helper.textContent = deckDescription;
        entry.appendChild(helper);
      }

      eventDeckListEl.appendChild(entry);
    });
  }

  function renderEventCardPreview() {
    if (!eventCardPreviewListEl) {
      return;
    }
    eventCardPreviewListEl.innerHTML = '';
    const activeDecks = new Set(getActiveDeckIds());
    const cards = eventCardDefinitions.filter(card => !card.deckId || activeDecks.has(card.deckId));
    if (cards.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Keine Karten aktiviert.';
      eventCardPreviewListEl.appendChild(li);
      return;
    }
    cards.forEach(card => {
      const li = document.createElement('li');
      const description = card.description || '';
      li.innerHTML = `<strong>${card.label || card.id}</strong>${description ? ` – ${description}` : ''}`;
      eventCardPreviewListEl.appendChild(li);
    });
  }

  function renderCampaignSelect() {
    if (!campaignSelectEl) {
      return;
    }
    campaignSelectEl.innerHTML = '';
    const freeOption = document.createElement('option');
    freeOption.value = '';
    freeOption.textContent = localization.t('events.campaigns.freePlay') || 'Freies Spiel';
    campaignSelectEl.appendChild(freeOption);

    campaignDefinitions.forEach(campaign => {
      if (!campaign || !campaign.id) {
        return;
      }
      const option = document.createElement('option');
      option.value = campaign.id;
      const nameKey = `events.campaigns.${campaign.id}.name`;
      const descriptionKey = `events.campaigns.${campaign.id}.description`;
      option.textContent = localization.t(nameKey) || campaign.name || campaign.id;
      option.dataset.description = localization.t(descriptionKey) || campaign.description || '';
      campaignSelectEl.appendChild(option);
    });

    campaignSelectEl.value = eventConfig.campaignId || '';
  }

  function renderCampaignPreview() {
    if (!campaignPreviewListEl) {
      return;
    }
    campaignPreviewListEl.innerHTML = '';
    const campaign = campaignDefinitions.find(entry => entry && entry.id === eventConfig.campaignId);
    if (!campaign) {
      const li = document.createElement('li');
      li.textContent = localization.t('events.campaigns.noneActive') || 'Keine Kampagne aktiv.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    const executedKeys = new Set(eventEngineState?.campaignProgress?.executed || []);
    const script = Array.isArray(campaign.script) ? campaign.script : [];
    const upcoming = script.filter(step => !executedKeys.has(`${step.night || 0}:${step.eventId || step.id}`));
    if (upcoming.length === 0) {
      const li = document.createElement('li');
      li.textContent = localization.t('events.campaigns.complete') || 'Alle Beats dieser Kampagne wurden erlebt.';
      campaignPreviewListEl.appendChild(li);
      return;
    }
    upcoming.sort((a, b) => (a.night || 0) - (b.night || 0));
    upcoming.forEach(step => {
      const li = document.createElement('li');
      const card = eventCardDefinitions.find(entry => entry.id === step.eventId);
      const label = card ? card.label || card.id : step.eventId;
      const titleKey = `events.campaigns.${campaign.id}.stepTitle`;
      const descriptionKey = `events.campaigns.${campaign.id}.stepDescription`;
      const localizedTitle = localization.t(titleKey, { event: label, night: step.night }) || step.title || label;
      const localizedDescription = localization.t(descriptionKey, { event: label, night: step.night })
        || step.description
        || card?.description
        || '';
      const nightLabel = localization.t('events.campaigns.nightLabel', { night: step.night }) || `Nacht ${step.night}`;
      li.innerHTML = `<strong>${escapeHtml(nightLabel)}</strong>: ${escapeHtml(localizedTitle)}${localizedDescription ? ` – ${escapeHtml(localizedDescription)}` : ''}`;
      campaignPreviewListEl.appendChild(li);
    });
  }

  let deferInitialEventEnablement = false;

  if (eventsEnabledCheckbox) {
    const savedEventsEnabled = getPersistedValue('eventsEnabled');
    if (savedEventsEnabled !== null) {
      eventsEnabledCheckbox.checked = savedEventsEnabled === 'true';
    }
    deferInitialEventEnablement = true;
    eventsEnabledCheckbox.addEventListener('change', () => {
      persistValue('eventsEnabled', eventsEnabledCheckbox.checked);
      applyGlobalEventsEnabledState();
      renderNarratorDashboard();
    });
  } else {
    deferInitialEventEnablement = true;
  }

  renderEventDeckControls();
  renderEventCardPreview();
  renderCampaignSelect();
  renderCampaignPreview();

  if (bloodMoonEnabledCheckbox) {
    bloodMoonEnabledCheckbox.addEventListener('change', () => {
      eventConfig.bloodMoonEnabled = bloodMoonEnabledCheckbox.checked;
      saveEventConfig();
      if (!eventConfig.bloodMoonEnabled) {
        clearBloodMoonState();
      }
      refreshEventUI();
      renderNarratorDashboard();
    });
  }

  if (firstNightShieldCheckbox) {
    firstNightShieldCheckbox.addEventListener('change', () => {
      eventConfig.firstNightShield = firstNightShieldCheckbox.checked;
      saveEventConfig();
      renderNarratorDashboard();
    });
  }

  if (phoenixPulseEnabledCheckbox) {
    phoenixPulseEnabledCheckbox.addEventListener('change', () => {
      eventConfig.phoenixPulseEnabled = phoenixPulseEnabledCheckbox.checked;
      saveEventConfig();
      if (!eventConfig.phoenixPulseEnabled) {
        clearPhoenixPulseState();
      }
      refreshEventUI();
      renderNarratorDashboard();
    });
  }

  if (campaignSelectEl) {
    campaignSelectEl.addEventListener('change', () => {
      const newId = campaignSelectEl.value || null;
      const normalizedId = newId && newId.length > 0 ? newId : null;
      if (eventConfig.campaignId !== normalizedId) {
        eventConfig.campaignId = normalizedId;
        saveEventConfig();
        resetCampaignProgress(normalizedId);
      } else {
        eventConfig.campaignId = normalizedId;
        saveEventConfig();
      }
      renderCampaignPreview();
    });
  }

  // Load reveal dead roles state
  const savedRevealDeadRoles = getPersistedValue('revealDeadRoles');
  if (savedRevealDeadRoles !== null) {
    revealDeadRolesCheckbox.checked = savedRevealDeadRoles === 'true';
  }

  // Save reveal dead roles state
  revealDeadRolesCheckbox.addEventListener('change', () => {
    persistValue('revealDeadRoles', revealDeadRolesCheckbox.checked);
  });

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

  const jobDisplayNames = {
    Bodyguard: 'Bodyguard',
    Doctor: 'Arzt'
  };

  function getJobDisplayName(job) {
    const translated = localization.getJobDisplayName(job);
    if (translated) {
      const fallbackLabel = jobDisplayNames[job];
      if (fallbackLabel && !translated.includes(fallbackLabel)) {
        return `${translated} (${fallbackLabel})`;
      }
      return translated;
    }
    return jobDisplayNames[job] || job;
  }

  function formatRoleWithJobs(role, jobs) {
    if (!role) {
      if (!Array.isArray(jobs) || jobs.length === 0) {
        return '';
      }
      const displayJobs = jobs.map(getJobDisplayName).filter(Boolean);
      return displayJobs.join(' & ');
    }
    const roleLabel = localization.getRoleDisplayName(role) || role;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return roleLabel;
    }
    const displayJobs = jobs.map(getJobDisplayName).filter(Boolean);
    if (displayJobs.length === 0) {
      return roleLabel;
    }
    return `${roleLabel} & ${displayJobs.join(' & ')}`;
  }

  function getJobClassModifier(job) {
    if (typeof job !== 'string' || job.length === 0) {
      return '';
    }
    return job
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function renderRoleWithJobs(targetEl, role, jobs = []) {
    if (!targetEl) {
      return;
    }

    targetEl.innerHTML = '';

    const hasRole = typeof role === 'string' && role.length > 0;
    if (hasRole) {
      const roleLabel = document.createElement('span');
      roleLabel.className = 'role-label';
      roleLabel.textContent = role;
      targetEl.appendChild(roleLabel);
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return;
    }

    jobs.forEach(job => {
      const label = getJobDisplayName(job);
      if (!label) {
        return;
      }
      const modifier = getJobClassModifier(job);
      const badge = document.createElement('span');
      badge.className = modifier ? `job-badge job-badge--${modifier}` : 'job-badge';
      badge.textContent = label;
      targetEl.appendChild(badge);
    });
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

  function findDoctorHolderIndex() {
    ensureJobsStructure();
    for (let i = 0; i < jobsAssigned.length; i += 1) {
      const jobs = jobsAssigned[i];
      if (Array.isArray(jobs) && jobs.includes('Doctor')) {
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
    updateDoctorPlayers();
    return true;
  }

  function assignDoctorJobToIndex(index) {
    if (typeof index !== 'number' || index < 0 || index >= players.length) {
      return false;
    }
    ensureJobsStructure();
    const currentIndex = findDoctorHolderIndex();
    if (currentIndex === index) {
      updateDoctorPlayers();
      return true;
    }
    if (currentIndex !== -1) {
      const currentJobs = jobsAssigned[currentIndex];
      const pos = currentJobs.indexOf('Doctor');
      if (pos !== -1) {
        currentJobs.splice(pos, 1);
      }
    }
    const jobs = getPlayerJobs(index);
    if (!jobs.includes('Doctor')) {
      jobs.push('Doctor');
    }
    updateDoctorPlayers();
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

  function assignDoctorJobByChance() {
    if (!jobConfig || typeof jobConfig.doctorChance !== 'number') {
      return null;
    }
    const chance = Math.min(Math.max(jobConfig.doctorChance, 0), 1);
    if (chance <= 0) {
      return null;
    }
    const existingIndex = findDoctorHolderIndex();
    if (existingIndex !== -1) {
      return players[existingIndex] || null;
    }
    if (Math.random() >= chance) {
      return null;
    }
    const eligible = players
      .map((player, index) => ({ player, index }))
      .filter(({ index }) => doctorEligibleRoles.has(rolesAssigned[index]));
    if (eligible.length === 0) {
      return null;
    }
    const choice = eligible[Math.floor(Math.random() * eligible.length)];
    assignDoctorJobToIndex(choice.index);
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
    updateDoctorPlayers();
  }

  function removeDoctorJobFromIndex(index) {
    ensureJobsStructure();
    if (typeof index !== 'number' || index < 0 || index >= jobsAssigned.length) {
      return;
    }
    const jobs = jobsAssigned[index];
    if (!Array.isArray(jobs)) {
      return;
    }
    const pos = jobs.indexOf('Doctor');
    if (pos !== -1) {
      jobs.splice(pos, 1);
    }
    updateDoctorPlayers();
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

  function hasActiveDoctor() {
    ensureJobsStructure();
    return players.some((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Doctor');
    });
  }

  function getDoctorAvailableTargets() {
    return doctorPendingTargets.filter(name => deadPlayers.includes(name));
  }

  function clearDoctorPending() {
    doctorPendingTargets = [];
    doctorPendingNight = null;
    doctorTriggerSourceNight = null;
  }

  function updateDoctorPlayers() {
    ensureJobsStructure();
    doctorPlayers = players.filter((player, index) => {
      if (deadPlayers.includes(player)) {
        return false;
      }
      const jobs = jobsAssigned[index];
      return Array.isArray(jobs) && jobs.includes('Doctor');
    });
    const availableTargets = getDoctorAvailableTargets();
    if (doctorPlayers.length === 0 && doctorPendingNight !== null && doctorPendingNight <= nightCounter) {
      clearDoctorPending();
      return;
    }
    if (availableTargets.length === 0 && doctorPendingNight !== null && doctorPendingNight <= nightCounter) {
      clearDoctorPending();
    } else if (availableTargets.length !== doctorPendingTargets.length) {
      doctorPendingTargets = availableTargets;
    }
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
    updateDoctorPlayers();
  }


  let players = [];
  let rolesAssigned = [];
  let jobsAssigned = [];
  let currentIndex = 0;
  let revealed = false;
  let currentlyFlippedCard = null;
  let revealTurnOrder = [];
  let revealTurnIndex = -1;
  let revealCards = [];
  let revealCurrentPlayerHasFlipped = false;

  let roleLayoutCustomized = false;
  let lastSuggestionSnapshot = null;
  let suppressCustomizationTracking = false;

  function markLayoutCustomized() {
    if (!suppressCustomizationTracking) {
      roleLayoutCustomized = true;
    }
  }

  function setRowQuantity(row, qty) {
    const display = row.querySelector(".qty-display");
    if (display) {
      display.textContent = qty;
    }
  }

  function findRoleRow(container, roleName) {
    return Array.from(container.querySelectorAll(".role-row")).find((row) => {
      const inputEl = row.querySelector('input[type="text"]');
      return inputEl && inputEl.value.trim() === roleName;
    }) || null;
  }

  function getRoleLayoutSnapshot() {
    const readContainer = (container) => {
      const result = {};
      Array.from(container.querySelectorAll(".role-row")).forEach((row) => {
        const inputEl = row.querySelector('input[type="text"]');
        const qtyEl = row.querySelector(".qty-display");
        if (!inputEl) {
          return;
        }
        const name = inputEl.value.trim();
        if (!name) {
          return;
        }
        const qty = parseInt(qtyEl && qtyEl.textContent, 10);
        result[name] = Number.isFinite(qty) ? qty : 0;
      });
      return result;
    };

    return {
      village: readContainer(rolesContainerVillage),
      werwolf: readContainer(rolesContainerWerwolf),
      special: readContainer(rolesContainerSpecial)
    };
  }

  function buildSuggestionSnapshot(suggestion) {
    const snapshot = { village: {}, werwolf: {}, special: {} };

    categorizedRoles.village.forEach((role) => {
      snapshot.village[role] = suggestion[role] || 0;
    });
    categorizedRoles.werwolf.forEach((role) => {
      snapshot.werwolf[role] = suggestion[role] || 0;
    });
    categorizedRoles.special.forEach((role) => {
      snapshot.special[role] = suggestion[role] || 0;
    });

    return snapshot;
  }

  function snapshotsEqual(a, b) {
    if (!a || !b) {
      return false;
    }

    const categories = ["village", "werwolf", "special"];
    return categories.every((category) => {
      const rolesA = a[category] || {};
      const rolesB = b[category] || {};
      const keysA = Object.keys(rolesA);
      const keysB = Object.keys(rolesB);
      if (keysA.length !== keysB.length) {
        return false;
      }
      return keysA.every((roleName) => {
        return rolesB.hasOwnProperty(roleName) && rolesA[roleName] === rolesB[roleName];
      });
    });
  }

  function layoutMatchesLastSuggestion() {
    if (!lastSuggestionSnapshot) {
      return false;
    }
    return snapshotsEqual(getRoleLayoutSnapshot(), lastSuggestionSnapshot);
  }

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
        markLayoutCustomized();
      }
    });

    plusBtn.addEventListener("click", () => {
      let current = parseInt(qtyDisplay.textContent, 10);
      qtyDisplay.textContent = current + 1;
      markLayoutCustomized();
    });

    input.addEventListener("input", () => {
      markLayoutCustomized();
    });

    qtyControls.appendChild(minusBtn);
    qtyControls.appendChild(qtyDisplay);
    qtyControls.appendChild(plusBtn);

    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.textContent = "ℹ";
    infoBtn.className = "role-info-btn";
    infoBtn.addEventListener("click", () => {
      showRoleInfo(input.value || value);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✖";
    removeBtn.className = "remove-role";
    removeBtn.addEventListener("click", () => {
      container.removeChild(row);
      markLayoutCustomized();
    });

    row.appendChild(infoBtn);
    row.appendChild(input);
    row.appendChild(qtyControls);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }

  const AUDIO_BASE64 = {
    day: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubzQMABNCf7zr/vLKj1AdAgYoX5/W+Pzhrm80DAATQn+86/7yyo9QHQIGKF+f1vj84a5vNAwAE0J/vOv+8sqPUB0CBihfn9b4/OGubw==`.replace(/\s+/g, ''),
    night: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/o8Pf8v399OHHpoNfPiINAgAIGjRUd5u82e/7/vfmza6LZ0UoEQQABhYuTG+TtdPr+f/569O1k29MLhYGAAQRKEVni67N5vf+++/ZvJt3VDQaCAACDSI+X4Omx+H0/f3y38Ojf1s7HwwBAQodN1h7n8Dc8fz+9uTKqodjQiUPAwAHGDFQc5e51u36/vjo0LKPa0krEwUABRMrSWuPstDo+P767da5l3NQMRgHAAMPJUJjh6rK5Pb+/PHcwJ97WDcdCgEBDB87W3+jw9/y/f304cemg18+Ig0CAAgaNFR3m7zZ7/v+9+bNrotnRSgRBAAGFi5Mb5O10+v5//nr07WTb0wuFgYABBEoRWeLrs3m9/7779m8m3dUNBoIAAINIj5fg6bH4fT9/fLfw6N/WzsfDAEBCh03WHufwNzx/P725A==`.replace(/\s+/g, ''),
    blood: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/kaOzw9Lf6vL5/f79+vTs4dXHt6aVg3FfTj4vIhcNBgIAAAMIEBomNENUZXeJm6y8zNnl7/b7/v789/Dm282+rp2LeWdWRTYoGxEJBAAAAQYNFiEuPExdb4GTpLXF0+Dr8/n9//358+vg08W1pJOBb11MPC4hFg0GAQAABAkRGyg2RVZneYudrr7N2+bw9/z+/vv27+XZzLysm4l3ZVRDNCYaEAgDAAACBg0XIi8+Tl9xg5Wmt8fV4ez0+v3+/fny6t/Sw7OjkX9tW0s7LB8UDAUBAAEEChIdKTdHWGl7jZ+wwM/c5/H4/P7++/bu5NjKu6qZh3VjUkIyJRkPCAMAAAIHDhgjMUBQYXOFl6i5yNbj7fX6/v79+PHo3dDCsqGPfWtaSTkrHhMLBQEAAQULEx4rOUlaa32PobLC0N3o8Q==`.replace(/\s+/g, ''),
    phoenix: `UklGRmQBAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YUABAAB/3P7QbxgCO5/v+LVQCAxYvPrrlzQBHXfW/9Z3HQE0l+v6vFgMCFC1+O+fOwIYb9D+3H8iAC6P5vzDXw8GSa728qZCBBNnyv3hhygAKIfh/cpnEwRCpvL2rkkGD1/D/OaPLgAif9z+0G8YAjuf7/i1UAgMWLz665c0AR131v/Wdx0BNJfr+rxYDAhQtfjvnzsCGG/Q/tx/IgAuj+b8w18PBkmu9vKmQgQTZ8r94YcoACiH4f3KZxMEQqby9q5JBg9fw/zmjy4AIn/c/tBvGAI7n+/4tVAIDFi8+uuXNAEdd9b/1ncdATSX6/q8WAwIULX47587Ahhv0P7cfyIALo/m/MNfDwZJrvbypkIEE2fK/eGHKAAoh+H9ymcTBEKm8vauSQYPX8P85o8uACJ/3P7QbxgCO5/v+LVQCAxYvPrrlw==`.replace(/\s+/g, '')
  };

  const narratorAudioLibrary = {
    playlists: {
      daybreak: { id: 'daybreak', label: '🌅 Morgendämmerung', src: `data:audio/wav;base64,${AUDIO_BASE64.day}`, loop: true, volume: 0.55 },
      nightwatch: { id: 'nightwatch', label: '🌙 Nachtwache', src: `data:audio/wav;base64,${AUDIO_BASE64.night}`, loop: true, volume: 0.5 },
      bloodmoon: { id: 'bloodmoon', label: '🩸 Blutmond-Dröhnen', src: `data:audio/wav;base64,${AUDIO_BASE64.blood}`, loop: true, volume: 0.58 },
      phoenix: { id: 'phoenix', label: '🔥 Phoenix-Aufgang', src: `data:audio/wav;base64,${AUDIO_BASE64.phoenix}`, loop: true, volume: 0.6 }
    },
    stingers: {
      bloodStrike: { id: 'bloodStrike', label: 'Werwolf-Heulen', src: `data:audio/wav;base64,${AUDIO_BASE64.blood}`, volume: 0.85 },
      phoenixRise: { id: 'phoenixRise', label: 'Phoenix-Aufstieg', src: `data:audio/wav;base64,${AUDIO_BASE64.phoenix}`, volume: 0.9 }
    }
  };

  const lightingPresets = {
    day: { label: 'Tageslicht', particles: 'motes' },
    night: { label: 'Nachtwache', particles: 'embers' },
    ritual: { label: 'Ritualglut', particles: 'embers' },
    witch: { label: 'Hexenglut', particles: 'aurora' },
    seer: { label: 'Seherblick', particles: 'aurora' },
    hunter: { label: 'Jägerfeuer', particles: 'sparks' },
    'blood-moon': { label: 'Blutmond', particles: 'embers', overlay: ['blood-moon'] },
    phoenix: { label: 'Phoenix Pulse', particles: 'phoenix', overlay: ['phoenix'] },
    victory: { label: 'Triumphlicht', particles: 'sparks' }
  };

  const phaseAmbiencePresets = {
    setup: { playlist: null, lighting: null, particles: null },
    night: { playlist: 'nightwatch', lighting: 'night', particles: 'embers' },
    day: { playlist: 'daybreak', lighting: 'day', particles: 'motes' },
    victory: { playlist: 'daybreak', lighting: 'victory', particles: 'sparks' }
  };

  const nightStepAmbience = {
    Werwolf: { lighting: 'ritual', particles: 'embers' },
    Hexe: { lighting: 'witch', particles: 'aurora' },
    Seer: { lighting: 'seer', particles: 'aurora' },
    Inquisitor: { lighting: 'seer', particles: 'aurora' },
    Jäger: { lighting: 'hunter', particles: 'sparks' },
    Amor: { lighting: 'ritual', particles: 'motes' },
    Doctor: { lighting: 'day', particles: 'motes' },
    Bodyguard: { lighting: 'night', particles: 'embers' },
    'Stumme Jule': { lighting: 'witch', particles: 'aurora' },
    Geschwister: { lighting: 'night', particles: 'motes' }
  };

  const sourceLabels = {
    manual: 'Manuell',
    event: 'Event',
    step: 'Schritt',
    phase: 'Phase'
  };

  const overlayLabels = {
    'blood-moon': 'Blutmond-Schleier',
    phoenix: 'Phoenix-Resonanz'
  };

  /* -------------------- Erste Nacht Logik -------------------- */

  let nightMode = false;
  let dayMode = false;
  let nightSteps = [];
  let nightIndex = 0;
  let nightStepHistory = [];
  
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

  const timerEventHistory = [];
  let timerEventCounter = 0;

  function recordTimerEvent(kind, payload = {}) {
    timerEventCounter += 1;
    const timestamp = Date.now();
    const event = {
      id: `timer-${timestamp}-${timerEventCounter}`,
      sequence: timerEventCounter,
      kind,
      timestamp,
      metadata: {
        ...payload,
        dayCount,
        nightCounter,
        phase: nightMode ? 'night' : (dayMode ? 'day' : 'setup')
      }
    };
    timerEventHistory.push(event);
    if (timerEventHistory.length > 200) {
      timerEventHistory.shift();
    }
    return event;
  }

  function resetTimerEventHistory() {
    timerEventHistory.length = 0;
    timerEventCounter = 0;
  }

