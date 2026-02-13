/* settings.js — Full-page settings */
 
const SettingsPage = {
  _section: 'connection',

  render() {
    return `
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage your Jellyfin connection, devices, and scan preferences</p>

      <div class="settings-grid">
        <nav class="settings-nav" id="settingsNav">
          <button class="settings-nav-item active" data-sec="connection"><i data-lucide="link"></i> Connection</button>
          <button class="settings-nav-item" data-sec="libraries"><i data-lucide="library"></i> Libraries</button>
          <button class="settings-nav-item" data-sec="devices"><i data-lucide="monitor-speaker"></i> Devices</button>
          <button class="settings-nav-item" data-sec="testing"><i data-lucide="radar"></i> Testing</button>
          <button class="settings-nav-item" data-sec="about"><i data-lucide="info"></i> About</button>
        </nav>
        <div id="settingsBody"></div>
      </div>`;
  },

  async init() {
    this._section = 'connection';
    const nav = document.getElementById('settingsNav');
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-nav-item');
      if (!item) return;
      nav.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      this._section = item.dataset.sec;
      this._renderSection();
    });
    await this._renderSection();
  },

  async _renderSection() {
    const body = document.getElementById('settingsBody');
    switch (this._section) {
    case 'connection': this._renderConnection(body); break;
    case 'libraries': await this._renderLibraries(body); break;
    case 'devices': await this._renderDevices(body); break;
    case 'testing': this._renderTesting(body); break;
    case 'about': await this._renderAbout(body); break;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  /* --- Connection --- */
  _renderConnection(body) {
    const config = Store.get('config') || {};
    body.innerHTML = `
      <div class="settings-section">
        <div class="section-title"><i data-lucide="link"></i> Jellyfin Connection</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">Server URL</label>
            <input class="form-input" id="setUrl" type="url" value="${Utils.escapeHtml(config.jellyfinUrl || '')}" placeholder="http://jellyfin:8096" />
          </div>
          <div class="form-group">
            <label class="form-label">API Key</label>
            <input class="form-input" id="setKey" type="password" value="" placeholder="${config._hasApiKey ? 'Key configured (enter new to change)' : 'Enter API key'}" />
          </div>
          <div class="flex gap-8">
            <button class="btn btn-secondary" id="setTestConn"><i data-lucide="wifi"></i> Test</button>
            <button class="btn btn-primary" id="setConnSave"><i data-lucide="save"></i> Save</button>
          </div>
          <div id="setConnResult" class="text-sm mt-8"></div>
        </div>
      </div>`;

    document.getElementById('setTestConn').addEventListener('click', async () => {
      const res = document.getElementById('setConnResult');
      res.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:4px 0"></div>';
      try {
        const r = await Api.testConnection({
          jellyfinUrl: document.getElementById('setUrl').value.trim(),
          apiKey: document.getElementById('setKey').value.trim()
        });
        res.innerHTML = r.success
          ? `<span style="color:var(--green-400)">Connected to ${Utils.escapeHtml(r.serverName)}</span>`
          : `<span style="color:var(--red-400)">${Utils.escapeHtml(r.error)}</span>`;
      } catch (e) { res.innerHTML = `<span style="color:var(--red-400)">${Utils.escapeHtml(e.message)}</span>`; }
    });

    document.getElementById('setConnSave').addEventListener('click', async () => {
      try {
        const updates = { jellyfinUrl: document.getElementById('setUrl').value.trim() };
        const newKey = document.getElementById('setKey').value.trim();
        if (newKey) updates.apiKey = newKey;
        await Api.saveConfig(updates);
        const newConfig = await Api.getConfig();
        Store.set('config', newConfig);
        Utils.toast('Connection settings saved', 'success');
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  /* --- Libraries --- */
  async _renderLibraries(body) {
    body.innerHTML = '<div class="spinner"></div>';
    const config = Store.get('config') || {};
    const selectedIds = config.scanLibraryIds ? JSON.parse(config.scanLibraryIds) : [];

    let libs = [];
    try { libs = await Api.getLibraries(); if (!Array.isArray(libs)) libs = []; } catch (_e) {/* */}

    body.innerHTML = `
      <div class="settings-section">
        <div class="section-title"><i data-lucide="library"></i> Monitored Libraries</div>
        <div class="card">
          <p class="text-sm text-2 mb-16">Select which libraries to scan for new media</p>
          <div id="libSettings">
            ${libs.length === 0 ? '<p class="text-2">No libraries found. Check your connection.</p>' :
    libs.map(lib => {
      const id = lib.ItemId || lib.Id;
      const sel = selectedIds.includes(id);
      return `<label class="lib-check${sel ? ' selected' : ''}">
                  <input type="checkbox" value="${id}" ${sel ? 'checked' : ''} />
                  ${Utils.escapeHtml(lib.Name)}
                  <span class="text-sm text-2" style="margin-left:auto">${lib.CollectionType || 'Mixed'}</span>
                </label>`;
    }).join('')}
          </div>
          <button class="btn btn-primary mt-16" id="saveLibs"><i data-lucide="save"></i> Save</button>
        </div>
      </div>`;

    // Toggle handler — clicking anywhere on the row toggles the checkbox
    body.querySelectorAll('.lib-check').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const cb = el.querySelector('input');
        if (e.target !== cb) {
          cb.checked = !cb.checked;
        }
        el.classList.toggle('selected', cb.checked);
      });
    });

    document.getElementById('saveLibs')?.addEventListener('click', async () => {
      const ids = Array.from(document.querySelectorAll('#libSettings input:checked')).map(c => c.value);
      try {
        await Api.saveConfig({ scanLibraryIds: JSON.stringify(ids) });
        const newConfig = await Api.getConfig();
        Store.set('config', newConfig);
        Utils.toast('Libraries saved', 'success');
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  /* --- Devices --- */
  async _renderDevices(body) {
    const devices = await Api.getDevices();
    Store.set('devices', devices);

    body.innerHTML = `
      <div class="settings-section">
        <div class="section-title"><i data-lucide="monitor-speaker"></i> Device Profiles</div>
        <div id="deviceSettingsList">
          ${devices.length === 0 ? '<p class="text-2 mb-16">No devices configured.</p>' :
    devices.map(d => `
              <div class="device-row">
                <div class="device-row-info">
                  <div class="device-row-name">${Utils.escapeHtml(d.name)}</div>
                  <div class="device-row-meta">${d.maxHeight || 1080}p · ${Utils.formatBitrate(d.maxBitrate)} · ${d.videoCodec} / ${d.audioCodec}</div>
                </div>
                <div class="device-row-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${d.id}"><i data-lucide="pencil"></i></button>
                  <button class="btn btn-ghost btn-sm" data-del="${d.id}" style="color:var(--red-400)"><i data-lucide="trash-2"></i></button>
                </div>
              </div>`).join('')}
        </div>
        <button class="btn btn-secondary mt-16" id="addDeviceBtn"><i data-lucide="plus"></i> Add Device</button>
      </div>`;

    document.getElementById('addDeviceBtn')?.addEventListener('click', () => this._showDeviceModal());

    body.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = devices.find(x => x.id === parseInt(btn.dataset.edit));
        if (d) this._showDeviceModal(d);
      });
    });

    body.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this device?')) return;
        try {
          await Api.deleteDevice(parseInt(btn.dataset.del));
          Utils.toast('Device deleted', 'success');
          await this._renderDevices(body);
        } catch (e) { Utils.toast(e.message, 'error'); }
      });
    });
  },

  _showDeviceModal(device = null) {
    const existing = document.getElementById('deviceModalBackdrop');
    if (existing) existing.remove();

    const isEdit = !!device;
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'deviceModalBackdrop';
    el.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">
          <span>${isEdit ? 'Edit' : 'Add'} Device</span>
          <button class="btn btn-ghost btn-sm" id="closeDeviceModal"><i data-lucide="x"></i></button>
        </div>
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="mdName" value="${Utils.escapeHtml(device?.name || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">Video Codec</label>
          <select class="form-select" id="mdVideo">
            ${['h264','hevc','vp9','av1','mpeg2video','vc1','vp8'].map(c => `<option value="${c}" ${device?.videoCodec === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Audio Codec</label>
          <select class="form-select" id="mdAudio">
            ${['aac','mp3','opus','ac3','vorbis'].map(c => `<option value="${c}" ${device?.audioCodec === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Max Bitrate</label>
          <select class="form-select" id="mdBitrate">
            <option value="4000000" ${device?.maxBitrate === 4000000 ? 'selected' : ''}>720p — 4 Mbps</option>
            <option value="5000000" ${device?.maxBitrate === 5000000 ? 'selected' : ''}>720p — 5 Mbps</option>
            <option value="8000000" ${device?.maxBitrate === 8000000 ? 'selected' : ''}>DVD — 8 Mbps</option>
            <option value="10000000" ${(!device || device?.maxBitrate === 10000000) ? 'selected' : ''}>1080p — 10 Mbps</option>
            <option value="20000000" ${device?.maxBitrate === 20000000 ? 'selected' : ''}>1080p — 20 Mbps</option>
            <option value="25000000" ${device?.maxBitrate === 25000000 ? 'selected' : ''}>Blu-ray — 25 Mbps</option>
            <option value="35000000" ${device?.maxBitrate === 35000000 ? 'selected' : ''}>4K — 35 Mbps</option>
            <option value="40000000" ${device?.maxBitrate === 40000000 ? 'selected' : ''}>4K — 40 Mbps</option>
            <option value="45000000" ${device?.maxBitrate === 45000000 ? 'selected' : ''}>4K — 45 Mbps</option>
            <option value="50000000" ${device?.maxBitrate === 50000000 ? 'selected' : ''}>4K HDR — 50 Mbps</option>
            <option value="55000000" ${device?.maxBitrate === 55000000 ? 'selected' : ''}>4K HDR — 55 Mbps</option>
            <option value="60000000" ${device?.maxBitrate === 60000000 ? 'selected' : ''}>4K HDR — 60 Mbps</option>
            <option value="80000000" ${device?.maxBitrate === 80000000 ? 'selected' : ''}>4K Pro — 80 Mbps</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Max Resolution</label>
          <select class="form-select" id="mdResolution">
            <option value="480" ${device?.maxHeight === 480 ? 'selected' : ''}>480p (SD)</option>
            <option value="720" ${(!device || device?.maxHeight === 720) ? 'selected' : ''}>720p (HD)</option>
            <option value="1080" ${device?.maxHeight === 1080 ? 'selected' : ''}>1080p (Full HD)</option>
            <option value="2160" ${device?.maxHeight === 2160 ? 'selected' : ''}>4K (2160p)</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelDeviceModal">Cancel</button>
          <button class="btn btn-primary" id="saveDeviceModal"><i data-lucide="save"></i> Save</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const close = () => el.remove();
    document.getElementById('closeDeviceModal').addEventListener('click', close);
    document.getElementById('cancelDeviceModal').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });

    document.getElementById('saveDeviceModal').addEventListener('click', async () => {
      const name = document.getElementById('mdName').value.trim();
      if (!name) { Utils.toast('Name is required', 'error'); return; }

      const resMap = { 480: 854, 720: 1280, 1080: 1920, 2160: 3840 };
      const maxHeight = parseInt(document.getElementById('mdResolution').value);
      const data = {
        name,
        deviceId: `jellyprobe-${name.toLowerCase().replace(/\s+/g, '-')}`,
        videoCodec: document.getElementById('mdVideo').value,
        audioCodec: document.getElementById('mdAudio').value,
        maxBitrate: parseInt(document.getElementById('mdBitrate').value),
        maxWidth: resMap[maxHeight] || 1920,
        maxHeight: maxHeight || 1080
      };

      try {
        if (isEdit) await Api.updateDevice(device.id, data);
        else await Api.addDevice(data);
        Utils.toast(`Device ${isEdit ? 'updated' : 'added'}`, 'success');
        close();
        await this._renderDevices(document.getElementById('settingsBody'));
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  /* --- Testing --- */
  _renderTesting(body) {
    const config = Store.get('config') || {};
    body.innerHTML = `
      <div class="settings-section">
        <div class="section-title"><i data-lucide="radar"></i> Testing & Scan Settings</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">Scan Interval (seconds)</label>
            <input class="form-input" id="setScanInt" type="number" value="${config.scanInterval || 300}" min="60" max="86400" />
            <p class="form-hint">How often to check for new media (minimum 60 seconds)</p>
          </div>
          <div class="form-group">
            <label class="form-label">Default Test Duration (seconds)</label>
            <input class="form-input" id="setTestDur" type="number" value="${config.testDuration || 30}" min="5" max="300" />
          </div>
          <div class="form-group">
            <label class="form-label">Default Parallel Tests</label>
            <input class="form-input" id="setParallel" type="number" value="${config.maxParallelTests || 2}" min="1" max="10" />
          </div>
          
          <div class="section-divider"></div>
          <div class="section-subtitle mb-12">Dashboard Previews</div>
          
          <label class="form-check mb-12">
            <input type="checkbox" id="setShowPreviews" ${config.showPreviews !== 0 ? 'checked' : ''} />
            <span>Show live previews on dashboard</span>
          </label>
          
          <div class="form-group">
            <label class="form-label">Max Parallel Previews</label>
            <input class="form-input" id="setMaxPreviews" type="number" value="${config.maxParallelPreviews ?? 6}" min="1" max="20" />
            <p class="form-hint">Maximum number of video streams to show simultaneously. Higher values may impact browser performance.</p>
          </div>
          
          <button class="btn btn-primary" id="saveTesting"><i data-lucide="save"></i> Save</button>
        </div>
      </div>`;

    document.getElementById('saveTesting')?.addEventListener('click', async () => {
      try {
        await Api.saveConfig({
          scanInterval: parseInt(document.getElementById('setScanInt').value),
          testDuration: parseInt(document.getElementById('setTestDur').value),
          maxParallelTests: parseInt(document.getElementById('setParallel').value),
          showPreviews: document.getElementById('setShowPreviews').checked ? 1 : 0,
          maxParallelPreviews: parseInt(document.getElementById('setMaxPreviews').value)
        });
        const newConfig = await Api.getConfig();
        Store.set('config', newConfig);
        Utils.toast('Testing settings saved', 'success');
      } catch (e) { Utils.toast(e.message, 'error'); }
    });
  },

  /* --- About --- */
  async _renderAbout(body) {
    let version;
    try {
      const versionData = await Api.getVersion();
      version = versionData.version;
    } catch (_e) {
      version = 'Unknown';
    }

    body.innerHTML = `
      <div class="settings-section">
        <div class="section-title"><i data-lucide="info"></i> About JellyProbe</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">Version</label>
            <div style="padding: 10px; background: var(--surface-3); border-radius: 6px; font-family: monospace; font-weight: 500;">v${Utils.escapeHtml(version)}</div>
          </div>
          <p class="text-sm text-2" style="margin-top: 16px;">An automated testing tool for Jellyfin servers. Simulates real-world client playback by triggering transcoding and validating HLS stream delivery across multiple device profiles.</p>
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--surface-2);">
            <p class="text-sm text-2 mb-8">Resources:</p>
            <div class="flex" style="gap: 8px; flex-wrap: wrap;">
              <a href="https://github.com/simno/jellyprobe" target="_blank" class="btn btn-secondary btn-sm"><i data-lucide="github"></i> GitHub</a>
              <a href="https://github.com/simno/jellyprobe/issues" target="_blank" class="btn btn-secondary btn-sm"><i data-lucide="bug"></i> Report Issue</a>
            </div>
          </div>
        </div>
      </div>`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};
