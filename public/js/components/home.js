const HomePage = {
  render() {
    return `
      <div class="home-hero">
        <div class="home-hero-text">
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle" id="homeServerLine">
            <span class="text-2">Loading server status…</span>
          </p>
        </div>
        <a href="#/new" class="btn btn-primary btn-lg">
          <i data-lucide="play-circle"></i> New Test Run
        </a>
      </div>

      <div id="homeActive"></div>

      <div class="stats-row" id="homeStats">
        ${this._statCardSkeleton('Media items', 'film')}
        ${this._statCardSkeleton('Test runs', 'list-checks')}
        ${this._statCardSkeleton('Tests run', 'activity')}
        ${this._statCardSkeleton('Pass rate', 'target')}
      </div>

      <div class="dash-grid">
        <section class="dash-col-main">
          <div class="flex align-center gap-12 mb-16">
            <div class="section-title" style="margin-bottom:0"><i data-lucide="history"></i> Recent runs</div>
            <a href="#/history" class="text-sm text-accent ml-auto">View all →</a>
          </div>
          <div id="homeRecent"><div class="spinner"></div></div>
        </section>

        <aside class="dash-col-side">
          <div class="section-title"><i data-lucide="library"></i> Libraries</div>
          <div id="homeLibraries" class="dash-panel"><div class="spinner"></div></div>

          <div class="section-title mt-24"><i data-lucide="calendar-clock"></i> Schedules</div>
          <div id="homeSchedules" class="dash-panel"><div class="spinner"></div></div>
        </aside>
      </div>`;
  },

  async init() {
    this._loadStats();
    this._loadSchedules();
  },

  _statCardSkeleton(label, icon) {
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-label">${label}</span>
          <i data-lucide="${icon}" class="stat-icon"></i>
        </div>
        <div class="stat-value">—</div>
      </div>`;
  },

  _statCard(label, icon, value, opts = {}) {
    const cls = opts.variant ? ` ${opts.variant}` : '';
    const sub = opts.sub ? `<div class="stat-sub">${opts.sub}</div>` : '';
    return `
      <div class="stat-card${cls}">
        <div class="stat-card-head">
          <span class="stat-label">${label}</span>
          <i data-lucide="${icon}" class="stat-icon"></i>
        </div>
        <div class="stat-value">${value}</div>
        ${sub}
      </div>`;
  },

  async _loadStats() {
    let s;
    try {
      s = await Api.getStats();
    } catch (e) {
      const line = document.getElementById('homeServerLine');
      if (line) line.innerHTML = `<span class="text-danger">Failed to load stats: ${Utils.escapeHtml(e.message)}</span>`;
      return;
    }

    this._renderServerLine(s.server);
    this._renderActive(s.activeRun);
    this._renderStatCards(s);
    this._renderRecent(s.runs.recent);
    this._renderLibraries(s.libraries, s.totalItems);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _renderServerLine(server) {
    const line = document.getElementById('homeServerLine');
    if (!line) return;
    if (server && server.online) {
      const ver = server.version ? ` · v${Utils.escapeHtml(server.version)}` : '';
      line.innerHTML = `
        <span class="server-pill online">
          <span class="server-dot"></span>
          ${Utils.escapeHtml(server.name || 'Jellyfin')}${ver}
        </span>`;
    } else {
      const err = server && server.error ? ` — ${Utils.escapeHtml(server.error)}` : '';
      line.innerHTML = `
        <span class="server-pill offline">
          <span class="server-dot"></span>
          Jellyfin unreachable${err}
        </span>`;
    }
  },

  _renderActive(run) {
    const wrap = document.getElementById('homeActive');
    if (!wrap) return;
    if (!run) { wrap.innerHTML = ''; return; }

    const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
    wrap.innerHTML = `
      <a href="#/run" class="active-banner">
        <div class="active-banner-pulse"></div>
        <div class="active-banner-body">
          <div class="active-banner-title">
            <span class="badge badge-info">${run.status}</span>
            ${Utils.escapeHtml(run.name || 'Test Run')}
          </div>
          <div class="active-banner-meta">${run.completedTests || 0} / ${run.totalTests || 0} tests · ${pct}%</div>
          <div class="progress-track mt-8"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="active-banner-cta"><i data-lucide="arrow-right"></i></div>
      </a>`;
  },

  _renderStatCards(s) {
    const row = document.getElementById('homeStats');
    if (!row) return;
    const r = s.runs;
    const passRate = r.passRate == null ? '—' : r.passRate + '%';
    const passVariant = r.passRate == null ? '' : (r.passRate >= 90 ? 'success' : r.passRate >= 60 ? 'warn' : 'danger');
    const lastRun = r.lastRunAt ? `Last run ${Utils.relativeTime(r.lastRunAt)}` : 'No runs yet';

    row.innerHTML = [
      this._statCard('Media items', 'film',
        s.server.online ? this._num(s.totalItems) : '—',
        { variant: 'accent', sub: `${s.librariesConfigured} ${s.librariesConfigured === 1 ? 'library' : 'libraries'} · ${s.devicesConfigured} ${s.devicesConfigured === 1 ? 'device' : 'devices'}` }),
      this._statCard('Test runs', 'list-checks', this._num(r.total), { sub: lastRun }),
      this._statCard('Tests run', 'activity', this._num(r.testsRun),
        { sub: `${this._num(r.passed)} passed · ${this._num(r.failed)} failed` }),
      this._statCard('Pass rate', 'target', passRate, { variant: passVariant })
    ].join('');
  },

  _renderRecent(runs) {
    const wrap = document.getElementById('homeRecent');
    if (!wrap) return;

    if (!runs || runs.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <i data-lucide="inbox"></i>
          <p>No test runs yet.<br><a href="#/new" class="text-accent">Create your first test run →</a></p>
        </div>`;
      return;
    }

    const badges = { running: 'badge-info', paused: 'badge-warning', completed: 'badge-success', failed: 'badge-danger', cancelled: 'badge-danger', pending: 'badge-neutral' };
    wrap.innerHTML = runs.map(run => {
      const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
      const errTitle = run.status === 'failed' && run.error ? ` title="${Utils.escapeHtml(run.error)}"` : '';
      return `
        <div class="run-list-item" data-rid="${run.id}">
          <div class="run-list-info">
            <div class="run-list-name">${Utils.escapeHtml(run.name || 'Test Run')}</div>
            <div class="run-list-meta">${Utils.relativeTime(run.createdAt)} · ${run.totalTests} tests · ${pct}%</div>
          </div>
          <div class="run-list-stats">
            <span class="badge badge-success">${run.successfulTests || 0} ✓</span>
            <span class="badge badge-danger">${run.failedTests || 0} ✗</span>
            <span class="badge ${badges[run.status] || 'badge-neutral'}"${errTitle}>${run.status}</span>
          </div>
        </div>`;
    }).join('');

    // A run row routes to History, which knows how to render run detail.
    wrap.querySelectorAll('.run-list-item').forEach(el => {
      el.addEventListener('click', () => {
        Store.set('historyOpenRunId', parseInt(el.dataset.rid));
        location.hash = '#/history';
      });
    });
  },

  _renderLibraries(libs, totalItems) {
    const wrap = document.getElementById('homeLibraries');
    if (!wrap) return;

    if (!libs || libs.length === 0) {
      wrap.innerHTML = `
        <div class="dash-empty">
          <p class="text-sm text-2">No libraries configured.</p>
          <a href="#/settings" class="text-sm text-accent">Configure in Settings →</a>
        </div>`;
      return;
    }

    const icon = (type) => {
      const t = (type || '').toLowerCase();
      if (t.includes('movie')) return 'clapperboard';
      if (t.includes('tv') || t.includes('show')) return 'tv';
      if (t.includes('music')) return 'music';
      return 'folder';
    };

    wrap.innerHTML = `
      <div class="dash-list">
        ${libs.map(l => `
          <div class="dash-list-row">
            <i data-lucide="${icon(l.type)}" class="dash-list-icon"></i>
            <span class="dash-list-name">${Utils.escapeHtml(l.name)}</span>
            <span class="dash-list-value">${this._num(l.count)}</span>
          </div>`).join('')}
      </div>
      <div class="dash-list-total">
        <span>Total media</span>
        <span>${this._num(totalItems)}</span>
      </div>`;
  },

  async _loadSchedules() {
    const wrap = document.getElementById('homeSchedules');
    if (!wrap) return;
    let schedules;
    try {
      schedules = await Api.getSchedules();
    } catch (_e) {
      wrap.innerHTML = '<p class="text-sm text-2 dash-empty">Failed to load schedules.</p>';
      return;
    }

    if (!schedules || schedules.length === 0) {
      wrap.innerHTML = `
        <div class="dash-empty">
          <p class="text-sm text-2">No schedules set up.</p>
          <a href="#/schedules" class="text-sm text-accent">Create a schedule →</a>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const freqLabel = { every6h: 'Every 6h', every12h: 'Every 12h', daily: 'Daily', weekly: 'Weekly' };
    wrap.innerHTML = `
      <div class="dash-list">
        ${schedules.slice(0, 5).map(s => `
          <div class="dash-list-row">
            <span class="sched-dot ${s.enabled ? 'on' : 'off'}"></span>
            <span class="dash-list-name">${Utils.escapeHtml(s.name)}</span>
            <span class="dash-list-value text-sm">${freqLabel[s.frequency] || s.frequency}</span>
          </div>`).join('')}
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _num(n) {
    return (n || 0).toLocaleString();
  }
};
