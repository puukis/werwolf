/* Werwolf Client Loader */

(function loader(global) {
  const scriptFiles = [
    'scripts/core.js',
    'scripts/bootstrap.js',
    'scripts/lobbies.js',
    'scripts/ambience.js',
    'scripts/phases.js',
    'scripts/events.js',
    'scripts/dashboard.js'
  ];

  if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
    const scope = global || (typeof globalThis !== 'undefined' ? globalThis : {});
    if (!scope.__WERWOLF_COMBINED_SCRIPTS_LOADED__) {
      require('./scripts/bundle.js');
      scope.__WERWOLF_COMBINED_SCRIPTS_LOADED__ = true;
    }
    return;
  }

  if (typeof window !== 'undefined' && window.document) {
    const currentScript = document.currentScript;
    const baseHref = currentScript ? currentScript.src : window.location.href;
    const pending = scriptFiles.slice();

    function loadNext() {
      if (pending.length === 0) {
        return;
      }
      const next = pending.shift();
      const script = document.createElement('script');
      script.async = false;
      script.defer = false;
      script.src = new URL(next, baseHref).toString();
      script.addEventListener('error', (event) => {
        console.error(`Fehler beim Laden von ${next}`, event);
      });
      script.addEventListener('load', loadNext);
      (document.head || document.documentElement).appendChild(script);
    }

    loadNext();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
