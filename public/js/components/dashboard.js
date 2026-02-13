/* dashboard.js — Live test run dashboard with video preview */
 
const DashboardPage = {
  _pollTimer: null,

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
          <p>No active test run.<br><a href="#/" class="text-accent">Create one →</a></p>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
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
        if (run.status === 'completed' || run.status === 'cancelled') {
          this._showCompletedView(run);
        }
      });
    }

    const isFinished = run.status === 'completed' || run.status === 'cancelled';
    if (isFinished) {
      this._showCompletedView(run);
    } else {
      this._initPreviewSlots(run);
      this._loadResults(run.id);
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _setupWS() {
    WS.on('testRunProgress', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.id !== run.id) return;
      run.completedTests = d.completed;
      run.successfulTests = d.successful;
      run.failedTests = d.failed;
      Store.set('currentTestRun', run);
      this._updateUI(run);
    });

    WS.on('testRunCompleted', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.id !== run.id) return;
      run.status = 'completed';
      Store.set('currentTestRun', run);
      this._updateUI(run);
      this._clearPreviews();
      this._showCompletedView(run);
    });

    WS.on('testRunPaused', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.id !== run.id) return;
      run.status = 'paused';
      Store.set('currentTestRun', run);
      this._updateUI(run);
      this._addLog('Test run paused', '');
    });

    WS.on('testRunResumed', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.id !== run.id) return;
      run.status = 'running';
      Store.set('currentTestRun', run);
      this._updateUI(run);
      this._addLog('Test run resumed', '');
    });

    WS.on('testRunCancelled', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.id !== run.id) return;
      run.status = 'cancelled';
      Store.set('currentTestRun', run);
      this._updateUI(run);
      this._clearPreviews();
      this._showCompletedView(run);
    });

    WS.on('testCompleted', (d) => {
      const run = Store.get('currentTestRun');
      if (!run || d.testRunId !== run.id) return;
      const status = d.success ? 'success' : 'error';
      this._addLog(`${d.itemName || 'Unknown'} — ${d.success ? 'passed' : 'FAILED'}`, status);
      this._loadResults(run.id);
      this._removePreview(d.itemId, d.deviceId);
    });

    WS.on('testProgress', (d) => {
      if (d.stage) this._addLog(`${d.itemName || ''}: ${d.stage}`, '');
    });

    WS.on('testStreamReady', (d) => {
      const run = Store.get('currentTestRun');
      const config = Store.get('config');
      if (!run || d.testRunId !== run.id || config?.showPreviews === 0) return;
      this._addPreview(d);
    });
  },

  _updateUI(run) {
    const title = document.getElementById('dashTitle');
    const status = document.getElementById('dashStatus');
    const actions = document.getElementById('dashActions');
    if (title) title.textContent = run.name || 'Test Run';

    const badges = { running: 'badge-info', paused: 'badge-warning', completed: 'badge-success', cancelled: 'badge-danger', pending: 'badge-neutral' };
    if (status) status.innerHTML = `<span class="badge ${badges[run.status] || 'badge-neutral'}">${run.status}</span>`;

    // Stats
    const el = (id) => document.getElementById(id);
    if (el('sTotal')) el('sTotal').textContent = run.totalTests || 0;
    if (el('sCompleted')) el('sCompleted').textContent = run.completedTests || 0;
    if (el('sPassed')) el('sPassed').textContent = run.successfulTests || 0;
    if (el('sFailed')) el('sFailed').textContent = run.failedTests || 0;

    // Progress
    const pct = run.totalTests > 0 ? Math.round((run.completedTests / run.totalTests) * 100) : 0;
    if (el('progFill')) el('progFill').style.width = pct + '%';
    if (el('progPct')) el('progPct').textContent = pct + '%';
    if (el('progEta')) el('progEta').textContent = `${run.completedTests || 0} / ${run.totalTests || 0}`;

    // Actions
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
        actions.innerHTML += '<a href="#/" class="btn btn-primary btn-sm"><i data-lucide="plus"></i> New Run</a>';
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

  /* --- Live Preview --- */
  _maxPreviewSlots() {
    const config = Store.get('config');
    return config?.maxParallelPreviews ?? 6;
  },

  _initPreviewSlots(_run) {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    const config = Store.get('config');
    if (config?.showPreviews === 0) return;

    const maxSlots = this._maxPreviewSlots();
    const cols = Math.min(config?.maxParallelTests || 2, maxSlots);
    grid.dataset.cols = Math.min(cols, 4);
    grid.innerHTML = '';
    for (let i = 0; i < cols; i++) {
      grid.innerHTML += `<div class="preview-cell idle" id="preview-${i}"></div>`;
    }
  },

  _addPreview(streamInfo) {
    const config = Store.get('config');
    if (config?.showPreviews === 0) return;

    const grid = document.getElementById('previewGrid');
    if (!grid) return;

    // Find an idle slot
    let slot = grid.querySelector('.preview-cell.idle');

    // No idle slot — add a new one if under max
    if (!slot) {
      const count = grid.querySelectorAll('.preview-cell').length;
      const maxSlots = this._maxPreviewSlots();
      if (count >= maxSlots) return;
      const cell = document.createElement('div');
      cell.className = 'preview-cell';
      cell.id = `preview-${count}`;
      grid.appendChild(cell);
      // Update grid cols if needed
      const cols = Math.min(count + 1, 4);
      if (parseInt(grid.dataset.cols) < cols) grid.dataset.cols = cols;
      slot = cell;
    } else {
      slot.classList.remove('idle');
    }
    slot.dataset.itemId = streamInfo.itemId;
    slot.dataset.deviceId = streamInfo.deviceId;

    // Build proxy URL (now returns an HLS master.m3u8)
    const params = new URLSearchParams({
      mediaSourceId: streamInfo.mediaSourceId,
      deviceId: streamInfo.deviceConfig?.deviceId || `jellyprobe-${streamInfo.deviceId}`,
      playSessionId: streamInfo.playSessionId || '',
      videoCodec: streamInfo.deviceConfig?.videoCodec || 'h264',
      audioCodec: streamInfo.deviceConfig?.audioCodec || 'aac',
      maxBitrate: streamInfo.deviceConfig?.maxBitrate || 20000000,
      maxWidth: streamInfo.deviceConfig?.maxWidth || 1920,
      maxHeight: streamInfo.deviceConfig?.maxHeight || 1080
    });
    const streamUrl = `/api/stream/${streamInfo.itemId}?${params.toString()}`;

    slot.innerHTML = `
      <video autoplay muted playsinline></video>
      <div class="preview-cell-overlay">
        <span class="preview-cell-label" title="${Utils.escapeHtml(streamInfo.itemName || '')}">${Utils.escapeHtml(streamInfo.itemName || 'Testing…')}</span>
        <span class="preview-cell-badge">${streamInfo.deviceConfig?.videoCodec || ''}</span>
      </div>`;

    const video = slot.querySelector('video');

    // Use HLS.js if available, otherwise try native HLS (Safari)
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 10, maxMaxBufferLength: 15 });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, () => { /* Silently handle — test validates transcoding */ });
      slot._hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
    }

    video.addEventListener('error', () => {
      // Silently handle video errors — the test itself validates transcoding
    });
  },

  _removePreview(itemId, deviceId) {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    const slots = grid.querySelectorAll('.preview-cell');
    for (const s of slots) {
      if (s.dataset.itemId === itemId && (!deviceId || String(s.dataset.deviceId) === String(deviceId))) {
        if (s._hls) { s._hls.destroy(); s._hls = null; }
        const video = s.querySelector('video');
        if (video) { video.pause(); video.src = ''; }
        s.innerHTML = '';
        s.classList.add('idle');
        delete s.dataset.itemId;
        delete s.dataset.deviceId;
        break;
      }
    }
  },

  _clearPreviews() {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    grid.querySelectorAll('.preview-cell').forEach(s => {
      if (s._hls) { s._hls.destroy(); s._hls = null; }
      const video = s.querySelector('video');
      if (video) { video.pause(); video.src = ''; }
      s.innerHTML = '';
      s.classList.add('idle');
    });
  },

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
      const results = await Api.getTestRunResults(run.id);
      if (!results || results.length === 0) {
        completedSection.innerHTML = '<div class="empty-state"><p>No results recorded.</p></div>';
        return;
      }

      const showPassed = Store.get('showPassed') || false;
      let html = `
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

      const checkCompleted = document.getElementById('showPassedCheckCompleted');
      if (checkCompleted) {
        checkCompleted.addEventListener('change', (e) => {
          Store.set('showPassed', e.target.checked);
          this._showCompletedView(run);
        });
      }

      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (_e) {
      completedSection.innerHTML = '<p class="text-2">Failed to load results.</p>';
    }
  },

  _buildResultsMatrix(results) {
    // Group results by media item, preserving insertion order
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

    // Summary counts
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

  destroy() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._clearPreviews();
  }
};
