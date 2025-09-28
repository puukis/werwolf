(function (global) {
  const decks = [
    {
      id: 'legacy',
      name: 'Klassisches Deck',
      description: 'Erhält die bekannten Ereignisse Blutmond und Phoenix Pulse.'
    }
  ];

  const cards = [
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
      effect(args) {
        const { scheduler, helpers, meta, nightNumber } = args;
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
  ];

  const campaigns = [
    {
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
    }
  ];

  global.WERWOLF_EVENT_DECKS = decks;
  global.WERWOLF_EVENT_DEFINITIONS = cards;
  global.WERWOLF_CAMPAIGNS = campaigns;
})(typeof window !== 'undefined' ? window : globalThis);
