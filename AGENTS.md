Werwolf Agents Guide
Repository layout
index.html is the single-page shell; it declares every interactive panel (setup, night/day overlays, admin tools) and loads styles.css and script.js directly.
All gameplay logic lives in the single, large script.js, which bootstraps on DOMContentLoaded, queries needed DOM nodes once, and initializes persisted configuration before wiring listeners.
Visual design and theming are handled in styles.css, which relies on CSS custom properties and [data-theme="dark"] overrides for light/dark support.
Automated regression coverage resides in __tests__/dashboard.test.js, driving the UI through window.__WERWOLF_TEST__ hooks under Jest + jsdom.
Package scripts are minimal (npm test), so keep the repo runnable without additional build steps.
JavaScript (script.js)
Bootstrapping & configuration
Theme handling (setTheme, initTheme) and the toggle button are initialized before other listeners; reuse these helpers rather than duplicating theme logic.
Configuration dialogs and persisted toggles (events, Blood Moon, Phoenix Pulse, job chance) share storage helpers; extend or new settings should follow the same pattern and storage keys defined near the top of the handler.
State management
Core state arrays (players, rolesAssigned, jobsAssigned, etc.) and customization flags (roleLayoutCustomized, lastSuggestionSnapshot) are module-level variables inside the DOMContentLoaded closure. Any new state should live alongside them and be included in snapshots/persistence routines.
Role metadata (categorizedRoles, roleDescriptions, jobDescriptions) centralize available roles/jobs; update them when introducing new factions or abilities so UI builders pick them up automatically.
Night/day control variables and phaseTimerManager power progression; schedule timers via phaseTimerManager.schedule (exposed as queuePhaseTimer) and remember to pause/cancel when phases change.
Jobs & bodyguard system
Always call ensureJobsStructure() before touching jobsAssigned. Use assignBodyguardJobToIndex, removeBodyguardJobFromIndex, and updateBodyguardPlayers helpers to keep data, UI, and dashboard synchronized.
Role layout & suggestions
Role rows must be created through addRoleRow, which wires quantity controls and info buttons; mark manual edits via markLayoutCustomized(). Snapshots (getRoleLayoutSnapshot, buildSuggestionSnapshot, snapshotsEqual) drive auto-suggestions—honor these when expanding role logic.
Dynamic suggestions and local-storage flows (applyRoleSuggestion, save/load buttons) rely on consistent event dispatch; emit input events after programmatic changes so downstream listeners run.
Modal & messaging utilities
Reuse showConfirmation/showInfoMessage for dialogs; they already integrate logging hooks and focus management. Pass log descriptors instead of calling logAction separately when possible.
Logging, undo/redo & dashboard
Mutations that affect gameplay should log through logAction or recordAction so the admin timeline, undo stack, and dashboard stay current. If an action can be reversed, supply paired undo/redo callbacks to recordAction.
After significant state changes call renderNarratorDashboard() (or rely on existing helpers that already do) to refresh counts, events, timers, and controls.
Night/day events & checkpoints
Random events (triggerRandomEvents) govern Blood Moon and Phoenix Pulse; update pity timers and UI via provided helpers (updateBloodMoonOdds, setPhoenixPulseCharged, updatePhoenixPulseStatus, syncBloodMoonUI). New events should follow the same pattern: reset state, write to resultOutput, and log actions.
Use captureGameCheckpoint, createStateSnapshot, and applyStateSnapshot when introducing new state so undo/restore and saved sessions include it.
Admin panel & macros
Add narrator tools via adminMacros and the existing wiring for select/run buttons. Each macro should log intent, use recordAction for undoability, and update UI/populators after execution.
Admin quick-actions (skip step, step back, rollback, sandbox, undo/redo, change role) already log and call helpers; extend them rather than bypassing to preserve analytics and replay safety.
Persistence & sessions
Saved sessions, manual name/role storage, and “last used” snapshots all persist to localStorage with defined keys; keep schemas backwards-compatible and sanitize/validate data when loading.
When adding new state, update saveSession, applySession, and related localStorage payloads to include it, plus window.__WERWOLF_TEST__ serialization hooks.
Testing hooks
Maintain the window.__WERWOLF_TEST__ API (get/set state, dashboard snapshot, macros, timers) whenever changing internals; Jest tests depend on it for DOM orchestration.
Extend or add Jest cases alongside new features so automation covers narrator dashboard, modals, and admin actions.
HTML (index.html)
Keep UI text in German and reuse existing semantic structure (cards, sections, modals). Many elements include aria-label/aria-live attributes—preserve or extend them for accessibility when altering layout.
New components should follow existing patterns (e.g., wrap content in .card, add buttons with .primary-btn/.secondary-btn, and wire to IDs referenced in script.js).
CSS (styles.css)
Define theme-aware colors via root variables and their dark-mode overrides; avoid hardcoding colors outside of documented exceptions (e.g., .primary-btn.night).
Reuse utility classes (.card, .primary-btn, .secondary-btn, .config-section, etc.) to maintain consistent spacing, shadows, and transitions. Add new styles alongside these blocks instead of introducing divergent patterns.
Localization & accessibility
Maintain the German voice for UI copy and logs (strings live throughout index.html and script.js). When adding text, mirror the tone and emoji usage already in place.
Preserve live-region updates (aria-live="polite") and keyboard focus management used in modals and dashboards; test with keyboard navigation after changes.
Testing expectations
Run npm test (Jest) after modifying logic. Tests execute in a jsdom environment configured by jest.setup.js, so prefer DOM APIs compatible with that setup.
Add or update Jest suites in __tests__ to cover new UI flows, ensuring window.__WERWOLF_TEST__ exposes any new helpers needed for automation.