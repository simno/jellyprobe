/* app.js — Main entry point */
const JellyProbe = {
  async init() {
    try {
      const config = await Api.getConfig();
      Store.set('config', config);

      if (!config || !config.jellyfinUrl || !config._hasApiKey) {
        Router.showSetup();
        return;
      }

      // Load devices upfront
      const devices = await Api.getDevices();
      Store.set('devices', devices);

      // Check for active test run
      try {
        const active = await Api.getActiveTestRun();
        if (active) {
          Store.set('currentTestRun', active);
          // Auto-navigate to dashboard if there's an active run
          if (!location.hash || location.hash === '#/') {
            location.hash = '#/dashboard';
          }
        }
      } catch (_e) {/* */}

      // Start router
      WS.connect();
      Router.init();
    } catch (e) {
      console.error('Init failed:', e);
      Router.showSetup();
    }
  }
};

// Make accessible globally for setup page callback
window.JellyProbe = JellyProbe;

document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
  JellyProbe.init();
});
