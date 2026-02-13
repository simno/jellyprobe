/* router.js — Simple hash-based router */
 
const Router = {
  _routes: {
    '/':          { page: 'wizard',    component: WizardPage },
    '/dashboard': { page: 'dashboard', component: DashboardPage },
    '/history':   { page: 'history',   component: HistoryPage },
    '/schedules': { page: 'schedules', component: SchedulesPage },
    '/settings':  { page: 'settings',  component: SettingsPage }
  },

  _current: null,

  init() {
    window.addEventListener('hashchange', () => this._navigate());
    this._navigate();
  },

  _navigate() {
    const hash = (location.hash || '#/').replace('#', '');
    const route = this._routes[hash] || this._routes['/'];

    // Cleanup previous
    if (this._current && this._current.destroy) this._current.destroy();

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.route === hash);
    });

    // Render
    const app = document.getElementById('app');
    app.innerHTML = route.component.render();
    this._current = route.component;

    // Init icons then component
    if (typeof lucide !== 'undefined') lucide.createIcons();
    route.component.init();
  },

  showSetup() {
    if (this._current && this._current.destroy) this._current.destroy();
    const app = document.getElementById('app');
    app.innerHTML = SetupPage.render();
    this._current = SetupPage;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    SetupPage.init();
  }
};
