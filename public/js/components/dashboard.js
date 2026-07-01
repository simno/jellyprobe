/* global DashboardPreviewGrid, DashboardBwChart, Chart */

const DashboardPage = {
  _pollTimer: null,
  _pieChart: null,
  _wsHandlers: [],

  _isFinished(status) {
    return status === 'completed' || status === 'cancelled' || status === 'failed';
  },

  render() {
    return `
      <div class="dash-header">
        <div class="dash-header-left">
          <h1 class="page-title" id="dashTitle">Test Run</h1>
          <span class="text-sm text-2" id="dashStatus"></span>
        </div>
        <div class="dash-header-right" id="dashActions"></div>
      </div>

      <div class="stats-row" id="dashStats">
        <div class="stat-card accent"><div class="stat-label">Total</div><div class="stat-value" id="sTotal">0</div></div>
        <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value" id="sCompleted">0</div></div>
        <div class="stat-card success"><div class="stat-label">Passed</div><div class="stat-value" id="sPassed">0</div></div>
        <div class="stat-card danger"><div class="stat-label">Failed</div><div class="stat-value" id="sFailed">0</div></div>
      </div>

      <div class="progress-wrap" id="progressWrap">
        <div class="progress-track"><div class="progress-fill" id="progFill" style="width:0%"></div></div>
        <div class="progress-label"><span id="progPct">0%</span><span id="progEta"></span></div>
      </div>

      <div id="liveSection">
        <div id="previewSection">
          <div class="section-title mb-16"><i data-lucide="monitor-play"></i> Live Preview</div>
          <div class="preview-grid" id="previewGrid" data-cols="2"></div>
        </div>

        <div id="bwChartSection">
          <div class="section-title mb-12"><i data-lucide="activity"></i> Bandwidth</div>
          <div class="bw-chart-wrap"><canvas id="bwChart"></canvas></div>
        </div>

        <div class="section-title mb-12"><i data-lucide="terminal"></i> Log</div>
        <div class="log-panel mb-24" id="logPanel"></div>

        <div class="flex align-center gap-12 mb-12">
          <div class="section-title" style="margin-bottom:0"><i data-lucide="table-2"></i> Results</div>
          <label class="toggle-check ml-auto">
            <input type="checkbox" id="showPassedCheck" />
            <span>Show passed</span>
          </label>
        </div>
        <div id="resultsWrap"></div>
      </div>

      <div id="completedSection" style="display:none"></div>`;
  },

  async init() {
    let run = Store.get('currentTestRun');
    if (!run) {
      try {
        const active = await Api.getActiveTestRun();
        if (active) { Store.set('currentTestRun', active); run = active; }
      } catch (_e) {/* */}
    }

    if (!run) {
      document.getElementById('app').innerHTML = `
        <div class="empty-state" style="margin-top:80px">
          <i data-lucide="inbox"></i>
          <p>No active test run.</p>
          <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px;">
            <a href="#/new" class="btn btn-primary"><i data-lucide="plus"></i> New Run</a>
            <button class="btn btn-ghost" id="dashRerunBtn"><i data-lucide="repeat"></i> Rerun</button>
          </div>
          <div id="rerunModal" style="display:none; margin-top: 24px;"></div>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();

      const rerunBtn = document.getElementById('dashRerunBtn');
      if (rerunBtn) {
        rerunBtn.addEventListener('click', async () => this._showRerunOptions());
      }
      return;
    }

    if (!this._isFinished(run.status)) {
      this._prepareForActiveRun();
    }

    this._updateUI(run);
    this._setupWS();

    const config = Store.get('config');
    const previewSec = document.getElementById('previewSection');
    if (previewSec && config && config.showPreviews === 0) {
      previewSec.style.display = 'none';
    }

    const showPassed = Store.get('showPassed') || false;
    const check = document.getElementById('showPassedCheck');
    if (check) {
      check.checked = showPassed;
      check.addEventListener('change', (e) => {
        Store.set('showPassed', e.target.checked);
        this._loadResults(run.id);
        if (this._isFinished(run.status)) {
          this._showCompletedView(run);
        }
      });
    }

    const isFinished = this._isFinished(run.status);
    if (isFinished) {
      this._showCompletedView(run);
    } else {
      DashboardPreviewGrid.init();
      DashboardBwChart.init();
      this._loadResults(run.id);
      this._startPolling(run.id);
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _wsOn(event, fn) {
    WS.on(event, fn);
    this._wsHandlers.push({ event, fn });
  },

  _teardownWS() {
    for (const { event, fn } of this._wsHandlers) WS.off(event, fn);
    this._wsHandlers = [];
  },

  _setupWS() {
    // Clean up any stale handlers from a previous dashboard visit
    this._teardownWS();

    // Capture the run ID at setup time so handlers always match
    const run = Store.get('currentTestRun');
    const runId = run?.id;

    this._wsOn('testRunStarted', (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      r.status = 'running';
      Store.set('currentTestRun', r);
      this._updateUI(r);
    });

    this._wsOn('testRunProgress', (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      r.completedTests = d.completed;
      r.successfulTests = d.successful;
      r.failedTests = d.failed;
      if (d.total) r.totalTests = d.total;
      Store.set('currentTestRun', r);
      this._updateUI(r);
    });

    this._wsOn('testRunCompleted', async (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      // Refetch the run — this event also fires for runs that ended as
      // 'failed', and the server has the authoritative status/counters.
      try {
        const fresh = await Api.getTestRun(runId);
        Object.assign(r, {
          status: fresh.status,
          totalTests: fresh.totalTests,
          completedTests: fresh.completedTests,
          successfulTests: fresh.successfulTests,
          failedTests: fresh.failedTests,
          error: fresh.error,
          startedAt: fresh.startedAt,
          completedAt: fresh.completedAt
        });
      } catch (_e) {
        r.status = 'completed';
      }
      Store.set('currentTestRun', r);
      this._updateUI(r);
      this._stopPolling();
      DashboardPreviewGrid.clear();
      DashboardBwChart.destroy();
      this._showCompletedView(r);
    });

    this._wsOn('testRunPaused', (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      r.status = 'paused';
      Store.set('currentTestRun', r);
      this._updateUI(r);
      this._addLog('Test run paused', '');
    });

    this._wsOn('testRunResumed', (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      r.status = 'running';
      Store.set('currentTestRun', r);
      this._updateUI(r);
      this._addLog('Test run resumed', '');
    });

    this._wsOn('testRunCancelled', (d) => {
      if (d.id !== runId) return;
      const r = Store.get('currentTestRun');
      if (!r) return;
      r.status = 'cancelled';
      Store.set('currentTestRun', r);
      this._updateUI(r);
      this._stopPolling();
      DashboardPreviewGrid.clear();
      DashboardBwChart.destroy();
      this._showCompletedView(r);
    });

    this._wsOn('testCompleted', (d) => {
      if (d.testRunId !== runId) return;
      const status = d.success ? 'success' : 'error';
      this._addLog(`${d.itemName || 'Unknown'} — ${d.success ? 'passed' : 'FAILED'}`, status);
      this._loadResults(runId);
      DashboardPreviewGrid.remove(d.itemId, d.deviceId);
    });

    this._wsOn('testProgress', (d) => {
      if (d.testRunId && d.testRunId !== runId) return;
      if (d.stage) this._addLog(`${d.itemName || ''}: ${d.stage}`, '');
    });

    this._wsOn('testStreamEnding', (d) => {
      if (d.testRunId !== runId) return;
      DashboardPreviewGrid.remove(d.itemId, d.deviceId);
    });

    this._wsOn('testStreamReady', (d) => {
      if (d.testRunId !== runId) return;
      const config = Store.get('config');
      if (config?.showPreviews === 0) return;
      DashboardPreviewGrid.add(d);
    });

    this._wsOn('bandwidthUpdate', (d) => {
      if (d.testRunId !== runId) return;
      DashboardBwChart.update(d);
    });
  },

  _updateUI(run) {
    const title = document.getElementById('dashTitle');
    const status = document.getElementById('dashStatus');
    const actions = document.getElementById('dashActions');
    if (title) title.textContent = run.name || 'Test Run';

    const badges = { running: 'badge-info', paused: 'badge-warning', completed: 'badge-success', cancelled: 'badge-danger', failed: 'badge-danger', pending: 'badge-neutral' };
    if (status) status.innerHTML = `<span class="badge ${badges[run.status] || 'badge-neutral'}">${run.status}</span>`;

    const el = (id) => document.getElementById(id);
    if (el('sTotal')) el('sTotal').textContent = run.totalTests || 0;
    if (el('sCompleted')) el('sCompleted').textContent = run.completedTests || 0;
    if (el('sPassed')) el('sPassed').textContent = run.successfulTests || 0;
    if (el('sFailed')) el('sFailed').textContent = run.failedTests || 0;

    const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
    if (el('progFill')) el('progFill').style.width = pct + '%';
    if (el('progPct')) el('progPct').textContent = pct + '%';
    if (el('progEta')) el('progEta').textContent = `${run.completedTests || 0} / ${run.totalTests || 0}`;

    const isActive = run.status === 'running' || run.status === 'paused';
    if (actions) {
      actions.innerHTML = '';
      if (run.status === 'running') {
        actions.innerHTML += '<button class="btn btn-warning btn-sm" id="pauseBtn"><i data-lucide="pause"></i> Pause</button>';
        actions.innerHTML += '<button class="btn btn-danger btn-sm" id="cancelBtn"><i data-lucide="x"></i> Cancel</button>';
      } else if (run.status === 'paused') {
        actions.innerHTML += '<button class="btn btn-success btn-sm" id="resumeBtn"><i data-lucide="play"></i> Resume</button>';
        actions.innerHTML += '<button class="btn btn-danger btn-sm" id="cancelBtn"><i data-lucide="x"></i> Cancel</button>';
      }
      if (!isActive) {
        actions.innerHTML += '<a href="#/new" class="btn btn-primary btn-sm"><i data-lucide="plus"></i> New Run</a>';
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();

      document.getElementById('pauseBtn')?.addEventListener('click', async () => {
        try { await Api.pauseTestRun(run.id); } catch (e) { Utils.toast(e.message, 'error'); }
      });
      document.getElementById('resumeBtn')?.addEventListener('click', async () => {
        try { await Api.resumeTestRun(run.id); } catch (e) { Utils.toast(e.message, 'error'); }
      });
      document.getElementById('cancelBtn')?.addEventListener('click', async () => {
        if (!confirm('Cancel this test run?')) return;
        try { await Api.cancelTestRun(run.id); } catch (e) { Utils.toast(e.message, 'error'); }
      });
    }
  },

  /* --- Polling fallback (in case WS events are lost) --- */
  _startPolling(runId) {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      try {
        const fresh = await Api.getTestRun(runId);
        if (!fresh) return;
        const r = Store.get('currentTestRun');
        if (!r || r.id !== runId) return;
        const changed = r.completedTests !== fresh.completedTests
          || r.status !== fresh.status
          || r.totalTests !== fresh.totalTests;
        if (!changed) return;
        r.completedTests = fresh.completedTests;
        r.successfulTests = fresh.successfulTests;
        r.failedTests = fresh.failedTests;
        r.totalTests = fresh.totalTests;
        r.status = fresh.status;
        r.error = fresh.error;
        Store.set('currentTestRun', r);
        this._updateUI(r);
        this._loadResults(runId);
        if (this._isFinished(fresh.status)) {
          this._stopPolling();
          DashboardPreviewGrid.clear();
          DashboardBwChart.destroy();
          this._showCompletedView(r);
        }
      } catch (_e) { /* ignore poll errors */ }
    }, 3000);
  },

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

  _prepareForActiveRun() {
    this._stopPolling();
    this._destroyPieChart();
    DashboardPreviewGrid.clear();
    DashboardBwChart.destroy();

    const liveSection = document.getElementById('liveSection');
    const completedSection = document.getElementById('completedSection');
    const progressWrap = document.getElementById('progressWrap');
    const logPanel = document.getElementById('logPanel');
    const resultsWrap = document.getElementById('resultsWrap');

    if (liveSection) liveSection.style.display = '';
    if (progressWrap) progressWrap.style.display = '';
    if (completedSection) {
      completedSection.style.display = 'none';
      completedSection.innerHTML = '';
    }
    if (logPanel) logPanel.innerHTML = '';
    if (resultsWrap) resultsWrap.innerHTML = '';
  },

  /* Live preview grid lives in DashboardPreviewGrid (dashboard-preview.js). */

  /* --- Log --- */
  _addLog(msg, type) {
    const panel = document.getElementById('logPanel');
    if (!panel) return;
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type || ''}`;
    line.innerHTML = `<span class="log-time">${time}</span>${Utils.escapeHtml(msg)}`;
    panel.insertBefore(line, panel.firstChild);
    while (panel.children.length > 150) panel.removeChild(panel.lastChild);
  },

  /* --- Live Results Table (during run) --- */
  async _loadResults(runId) {
    try {
      let results = await Api.getTestRunResults(runId);
      const wrap = document.getElementById('resultsWrap');
      if (!wrap) return;

      if (!results || results.length === 0) {
        wrap.innerHTML = '<div class="empty-state"><p>No results yet</p></div>';
        return;
      }

      const showPassed = Store.get('showPassed') || false;
      if (!showPassed) {
        results = results.filter(r => !r.success);
      }

      if (results.length === 0 && !showPassed) {
        wrap.innerHTML = '<div class="empty-state"><p>No failures recorded yet</p></div>';
        return;
      }

      const devices = Store.get('devices') || [];
      const getName = (id) => { const d = devices.find(x => x.id === id); return d ? d.name : `#${id}`; };

      wrap.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Status</th><th>Media</th><th>Device</th><th>Duration</th><th>Time</th>
            </tr></thead>
            <tbody>
              ${results.map(r => `
                <tr>
                  <td><span class="badge ${r.success ? 'badge-success' : 'badge-danger'}">${r.success ? 'Pass' : 'Fail'}</span></td>
                  <td>${Utils.escapeHtml(r.itemName || 'Unknown')}</td>
                  <td>${Utils.escapeHtml(getName(r.deviceId))}</td>
                  <td>${r.duration}s</td>
                  <td class="text-2">${Utils.relativeTime(r.timestamp)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (_e) {/* */}
  },

  /* Bandwidth chart lives in DashboardBwChart (dashboard-bwchart.js). */

  _destroyPieChart() {
    if (this._pieChart) { this._pieChart.destroy(); this._pieChart = null; }
    const pieTooltip = document.getElementById('pie-tooltip');
    if (pieTooltip) pieTooltip.remove();
  },

  /* --- Completed View --- */
  async _showCompletedView(run) {
    const liveSection = document.getElementById('liveSection');
    const completedSection = document.getElementById('completedSection');
    const progressWrap = document.getElementById('progressWrap');
    if (liveSection) liveSection.style.display = 'none';
    if (progressWrap) progressWrap.style.display = 'none';
    if (!completedSection) return;
    completedSection.style.display = '';
    completedSection.innerHTML = '<div class="spinner"></div>';

    try {
      this._destroyPieChart();
      const results = await Api.getTestRunResults(run.id);

      const failureBanner = (run.status === 'failed' && run.error)
        ? `<div class="alert alert-danger mb-24">
             <i data-lucide="alert-triangle"></i>
             <div><strong>Run failed:</strong> ${Utils.escapeHtml(run.error)}</div>
           </div>`
        : '';

      if (!results || results.length === 0) {
        completedSection.innerHTML = `${failureBanner}<div class="empty-state"><p>No results recorded.</p></div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      const totalBytes = results.reduce((sum, r) => sum + (r.bytesDownloaded || 0), 0);
      const passRate = results.length > 0 ? Math.round((results.filter(r => r.success).length / results.length) * 100) : 0;
      const avgDuration = results.length > 0 ? Math.round(results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length) : 0;

      const formatBytes = (bytes) => {
        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return bytes + ' B';
      };

      const deviceBytes = {};
      const deviceNames = {};
      for (const r of results) {
        const devName = r.deviceName || `Device #${r.deviceId}`;
        deviceNames[r.deviceId] = devName;
        deviceBytes[r.deviceId] = (deviceBytes[r.deviceId] || 0) + (r.bytesDownloaded || 0);
      }
      const deviceIds = Object.keys(deviceBytes);
      const showPie = deviceIds.length > 1 && totalBytes > 0;

      const runTime = (run.startedAt && run.completedAt)
        ? Utils.formatDuration(Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000))
        : null;

      let html = `
        ${failureBanner}
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <div class="section-title" style="margin-bottom: 0;"><i data-lucide="bar-chart-3"></i> Summary</div>
          <button class="btn btn-primary btn-sm ml-auto" id="completedRerunBtn"><i data-lucide="repeat"></i> Rerun</button>
        </div>
        <div class="bw-summary-row">
          <div class="stat-card accent"><div class="stat-label">Total Data</div><div class="stat-value" style="font-size:1.5rem">${formatBytes(totalBytes)}</div></div>
          <div class="stat-card success"><div class="stat-label">Pass Rate</div><div class="stat-value" style="font-size:1.5rem">${passRate}%</div></div>
          <div class="stat-card"><div class="stat-label">Avg Duration</div><div class="stat-value" style="font-size:1.5rem">${avgDuration}s</div></div>
          ${runTime ? `<div class="stat-card"><div class="stat-label">Run Time</div><div class="stat-value" style="font-size:1.5rem">${runTime}</div></div>` : ''}
          ${showPie ? '<div class="stat-card bw-pie-inline"><div class="stat-label">Per Profile</div><div class="bw-pie-content"><canvas id="bwPieChart" width="80" height="80"></canvas><div class="bw-legend" id="bwPieLegend"></div></div></div>' : ''}
        </div>
      `;

      const showPassed = Store.get('showPassed') || false;
      html += `
        <div class="flex align-center gap-12 mb-12">
          <div class="section-title" style="margin-bottom:0"><i data-lucide="table-2"></i> Results</div>
          <label class="toggle-check ml-auto">
            <input type="checkbox" id="showPassedCheckCompleted" ${showPassed ? 'checked' : ''} />
            <span>Show passed</span>
          </label>
        </div>
      `;
      html += DashboardPage._buildResultsMatrix(results);
      completedSection.innerHTML = html;

      if (showPie && typeof Chart !== 'undefined') {
        const pieCanvas = document.getElementById('bwPieChart');
        const legend = document.getElementById('bwPieLegend');
        const colors = ['#818cf8', '#4ade80', '#fbbf24', '#f87171', '#38bdf8', '#a78bfa', '#fb923c', '#34d399'];
        if (pieCanvas) {
          this._pieChart = new Chart(pieCanvas, {
            type: 'doughnut',
            data: {
              labels: deviceIds.map(id => deviceNames[id]),
              datasets: [{
                data: deviceIds.map(id => deviceBytes[id]),
                backgroundColor: deviceIds.map((_, i) => colors[i % colors.length]),
                borderWidth: 0
              }]
            },
            options: {
              animation: false,
              responsive: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  enabled: false,
                  external: (ctx) => {
                    let el = document.getElementById('pie-tooltip');
                    if (!el) {
                      el = document.createElement('div');
                      el.id = 'pie-tooltip';
                      el.style.cssText = 'position:fixed;pointer-events:none;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:6px;padding:6px 10px;font-size:.78rem;color:var(--text-1);z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:opacity .15s';
                      document.body.appendChild(el);
                    }
                    const tooltip = ctx.tooltip;
                    if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }
                    const i = tooltip.dataPoints?.[0]?.dataIndex;
                    if (i != null) {
                      const name = Utils.escapeHtml(deviceIds.map(id => deviceNames[id])[i]);
                      const bytes = formatBytes(deviceIds.map(id => deviceBytes[id])[i]);
                      el.innerHTML = `<strong>${name}</strong>: ${bytes}`;
                    }
                    const rect = pieCanvas.getBoundingClientRect();
                    el.style.opacity = '1';
                    el.style.left = (rect.left + tooltip.caretX) + 'px';
                    el.style.top = (rect.top + tooltip.caretY - 36) + 'px';
                  }
                }
              }
            }
          });
          if (legend) {
            legend.innerHTML = deviceIds.map((id, i) => `
              <div class="bw-legend-row">
                <span class="bw-legend-swatch" style="background:${colors[i % colors.length]}"></span>
                <span>${Utils.escapeHtml(deviceNames[id])}</span>
                <span style="margin-left:auto;color:var(--text-1);font-weight:600">${formatBytes(deviceBytes[id])}</span>
              </div>
            `).join('');
          }
        }
      }

      const checkCompleted = document.getElementById('showPassedCheckCompleted');
      if (checkCompleted) {
        checkCompleted.addEventListener('change', (e) => {
          Store.set('showPassed', e.target.checked);
          this._showCompletedView(run);
        });
      }

      const rerunBtn = document.getElementById('completedRerunBtn');
      if (rerunBtn) {
        rerunBtn.addEventListener('click', async () => {
          rerunBtn.disabled = true;
          rerunBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div>';
          try {
            const result = await Api.rerunTestRun(run.id);
            if (result.success && result.testRun) {
              // Start the test run immediately
              await Api.startTestRun(result.testRun.id);
              const activeRun = await Api.getTestRun(result.testRun.id);
              Store.set('currentTestRun', activeRun);
              await this.init();
            }
          } catch (error) {
            rerunBtn.disabled = false;
            rerunBtn.innerHTML = '<i data-lucide="repeat"></i> Rerun';
            alert(`Error: ${error.message}`);
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
        });
      }

      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (_e) {
      completedSection.innerHTML = '<p class="text-2">Failed to load results.</p>';
    }
  },

  _buildResultsMatrix(results) {
    const mediaMap = new Map();
    const deviceSet = new Map();

    for (const r of results) {
      const devName = r.deviceName || `Device #${r.deviceId}`;
      if (!deviceSet.has(r.deviceId)) deviceSet.set(r.deviceId, devName);
      if (!mediaMap.has(r.itemId)) {
        mediaMap.set(r.itemId, { name: r.itemName || 'Unknown', results: {} });
      }
      mediaMap.get(r.itemId).results[r.deviceId] = r;
    }

    const deviceIds = [...deviceSet.keys()];
    const deviceNames = [...deviceSet.values()];
    const showPassed = Store.get('showPassed') || false;

    const failedItems = [...mediaMap.values()].filter(m =>
      Object.values(m.results).some(r => !r.success)
    ).length;

    let html = '';

    if (failedItems > 0) {
      html += `<div class="results-summary results-summary-warn mb-16">
        <i data-lucide="alert-triangle"></i>
        <span>${failedItems} media item${failedItems > 1 ? 's' : ''} had failures</span>
      </div>`;
    } else {
      html += `<div class="results-summary results-summary-ok mb-16">
        <i data-lucide="check-circle"></i>
        <span>All ${mediaMap.size} media items passed on all profiles</span>
      </div>`;
    }

    html += `<div class="table-wrap"><table class="results-matrix">
      <thead><tr>
        <th class="matrix-media-col">Media</th>
        ${deviceNames.map(n => `<th class="matrix-device-col">${Utils.escapeHtml(n)}</th>`).join('')}
      </tr></thead>
      <tbody>`;

    let shownRowCount = 0;
    for (const [, media] of mediaMap) {
      const rowFailed = Object.values(media.results).some(r => !r.success);
      if (!showPassed && !rowFailed) continue;

      shownRowCount++;
      html += `<tr class="${rowFailed ? 'matrix-row-fail' : ''}">
        <td class="matrix-media-name">${Utils.escapeHtml(media.name)}</td>`;
      for (const devId of deviceIds) {
        const r = media.results[devId];
        if (!r) {
          html += '<td class="matrix-cell"><span class="matrix-na">—</span></td>';
        } else if (r.success) {
          html += `<td class="matrix-cell matrix-pass" title="${r.duration}s"><i data-lucide="check" class="matrix-icon"></i></td>`;
        } else {
          let errMsg;
          try { errMsg = r.errors ? JSON.parse(r.errors).join('; ') : ''; } catch (_e) { errMsg = r.errors || ''; }
          html += `<td class="matrix-cell matrix-fail" title="${Utils.escapeHtml(errMsg || 'Failed')}"><i data-lucide="x" class="matrix-icon"></i></td>`;
        }
      }
      html += '</tr>';
    }

    if (shownRowCount === 0 && !showPassed) {
      html += `<tr><td colspan="${deviceIds.length + 1}" class="text-center text-2 p-24">All items passed. Enable "Show passed" to see full details.</td></tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  },

  async _showRerunOptions() {
    const modal = document.getElementById('rerunModal');
    if (!modal) return;

    modal.innerHTML = '<div class="spinner"></div>';
    modal.style.display = 'block';

    try {
      const runs = await Api.getTestRuns();
      const completed = (runs || []).filter(r => r.status === 'completed' || r.status === 'cancelled').slice(0, 10);

      if (!completed.length) {
        modal.innerHTML = '<p class="text-2">No previous test runs to rerun.</p>';
        return;
      }

      modal.innerHTML = `
        <div style="border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px; background: var(--bg-card);">
          <p style="font-size: 0.875rem; color: var(--text-2); margin-bottom: 12px;">Select a test run to rerun:</p>
          ${completed.map(run => `
            <div class="run-option" data-rid="${run.id}" style="padding: 8px; border-radius: 4px; cursor: pointer; margin-bottom: 8px; border: 1px solid var(--border-subtle); transition: background 0.2s;">
              <div style="font-weight: 500; color: var(--text-1);">${Utils.escapeHtml(run.name || 'Test Run')}</div>
              <div style="font-size: 0.75rem; color: var(--text-2);">${run.totalTests} tests · ${Utils.relativeTime(run.createdAt)}</div>
            </div>
          `).join('')}
        </div>`;

      document.querySelectorAll('.run-option').forEach(el => {
        el.addEventListener('mouseover', () => el.style.background = 'var(--bg-hover)');
        el.addEventListener('mouseout', () => el.style.background = '');
        el.addEventListener('click', () => this._rerunFromDashboard(parseInt(el.dataset.rid)));
      });
    } catch (error) {
      modal.innerHTML = `<p class="text-2">Error loading test runs: ${Utils.escapeHtml(error.message)}</p>`;
    }
  },

  async _rerunFromDashboard(runId) {
    const modal = document.getElementById('rerunModal');
    if (!modal) return;

    modal.innerHTML = '<div class="spinner"></div>';

    try {
      const result = await Api.rerunTestRun(runId);
      if (result.success && result.testRun) {
        // Start the test run immediately
        await Api.startTestRun(result.testRun.id);
        const activeRun = await Api.getTestRun(result.testRun.id);
        modal.style.display = 'none';
        modal.innerHTML = '';
        Store.set('currentTestRun', activeRun);
        await this.init();
      }
    } catch (error) {
      modal.innerHTML = `<p class="text-2 text-danger">Error: ${Utils.escapeHtml(error.message)}</p>`;
    }
  },

  destroy() {
    this._stopPolling();
    this._teardownWS();
    DashboardPreviewGrid.clear();
    DashboardBwChart.destroy();
    this._destroyPieChart();
  }
};
