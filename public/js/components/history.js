const HistoryPage = {
  render() {
    return `
      <h1 class="page-title">Test History</h1>
      <p class="page-subtitle">Browse past test runs and results</p>
      <div id="historyContent"><div class="spinner"></div></div>`;
  },

  async init() {
    const container = document.getElementById('historyContent');
    try {
      const runs = await Api.getTestRuns();
      if (!runs || runs.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i data-lucide="history"></i>
            <p>No test runs yet.<br><a href="#/" class="text-accent">Create your first test run →</a></p>
          </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      container.innerHTML = runs.map(run => {
        const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
        const badges = { running: 'badge-info', paused: 'badge-warning', completed: 'badge-success', cancelled: 'badge-danger', pending: 'badge-neutral' };
        return `
          <div class="run-list-item" data-rid="${run.id}">
            <div class="run-list-info">
              <div class="run-list-name">${Utils.escapeHtml(run.name || 'Test Run')}</div>
              <div class="run-list-meta">${Utils.relativeTime(run.createdAt)} · ${run.totalTests} tests · ${pct}%</div>
            </div>
            <div class="run-list-stats">
              <span class="badge badge-success">${run.successfulTests || 0} ✓</span>
              <span class="badge badge-danger">${run.failedTests || 0} ✗</span>
              <span class="badge ${badges[run.status] || 'badge-neutral'}">${run.status}</span>
            </div>
          </div>`;
      }).join('');

      container.querySelectorAll('.run-list-item').forEach(el => {
        el.addEventListener('click', () => this._showRun(parseInt(el.dataset.rid)));
      });
    } catch (e) {
      container.innerHTML = `<p class="text-2">Failed to load history: ${Utils.escapeHtml(e.message)}</p>`;
    }
  },

  async _showRun(runId) {
    const container = document.getElementById('historyContent');
    container.innerHTML = '<div class="spinner"></div>';

    try {
      const [run, results] = await Promise.all([
        Api.getTestRun(runId),
        Api.getTestRunResults(runId)
      ]);

      const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
      const runTime = (run.startedAt && run.completedAt)
        ? Utils.formatDuration(Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000))
        : null;

      container.innerHTML = `
        <button class="btn btn-ghost btn-sm mb-16" id="histBack"><i data-lucide="arrow-left"></i> Back to list</button>

        <h2 class="page-title" style="font-size:1.3rem">${Utils.escapeHtml(run.name || 'Test Run')}</h2>
        <p class="text-sm text-2 mb-24">${Utils.relativeTime(run.createdAt)}</p>

        <div class="stats-row mb-24">
          <div class="stat-card accent"><div class="stat-label">Total</div><div class="stat-value">${run.totalTests}</div></div>
          <div class="stat-card success"><div class="stat-label">Passed</div><div class="stat-value">${run.successfulTests || 0}</div></div>
          <div class="stat-card danger"><div class="stat-label">Failed</div><div class="stat-value">${run.failedTests || 0}</div></div>
          <div class="stat-card"><div class="stat-label">Progress</div><div class="stat-value">${pct}%</div></div>
          ${runTime ? `<div class="stat-card"><div class="stat-label">Run Time</div><div class="stat-value">${runTime}</div></div>` : ''}
        </div>

        <div class="flex align-center gap-12 mb-12">
          <label class="toggle-check ml-auto">
            <input type="checkbox" id="showPassedCheckHist" />
            <span>Show passed</span>
          </label>
        </div>

        <div id="resultsWrapHist">
          ${results && results.length > 0
    ? DashboardPage._buildResultsMatrix(results)
    : '<div class="empty-state"><p>No results recorded.</p></div>'}
        </div>`;

      document.getElementById('histBack').addEventListener('click', () => this.init());
      
      const check = document.getElementById('showPassedCheckHist');
      if (check) {
        check.checked = Store.get('showPassed') || false;
        check.addEventListener('change', (e) => {
          Store.set('showPassed', e.target.checked);
          const wrap = document.getElementById('resultsWrapHist');
          if (wrap && results) wrap.innerHTML = DashboardPage._buildResultsMatrix(results);
          if (typeof lucide !== 'undefined') lucide.createIcons();
        });
      }

      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      container.innerHTML = `<p class="text-2">Failed to load run: ${Utils.escapeHtml(e.message)}</p>`;
    }
  }
};
