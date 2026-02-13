/* setup.js — First-run connection setup */
 
const SetupPage = {
  _libraries: [],

  render() {
    return `
      <div class="setup-wrap">
        <div class="setup-card">
          <div class="card">
            <div class="brand-lg">
              <div class="brand-icon"><i data-lucide="scan-search"></i></div>
              <span>JellyProbe</span>
            </div>
            <p class="text-center text-2 mb-32">Connect to your Jellyfin server to get started</p>

            <div class="form-group">
              <label class="form-label">Server URL</label>
              <input class="form-input" id="setupUrl" type="url" placeholder="http://jellyfin:8096" />
            </div>
            <div class="form-group">
              <label class="form-label">API Key</label>
              <input class="form-input" id="setupKey" type="password" placeholder="Your API key" />
            </div>

            <button class="btn btn-secondary w-full mb-16" id="testConnBtn">
              <i data-lucide="wifi"></i> Test Connection
            </button>
            <div id="connResult" class="text-sm text-center mb-16"></div>

            <div id="setupLibs" class="hidden mb-24"></div>

            <button class="btn btn-primary btn-lg w-full" id="setupSaveBtn" disabled>
              <i data-lucide="check"></i> Complete Setup
            </button>
          </div>
        </div>
      </div>`;
  },

  async init() {
    document.getElementById('testConnBtn').addEventListener('click', () => this._testConn());
    document.getElementById('setupSaveBtn').addEventListener('click', () => this._save());
  },

  async _testConn() {
    const url = document.getElementById('setupUrl').value.trim();
    const key = document.getElementById('setupKey').value.trim();
    const result = document.getElementById('connResult');
    if (!url || !key) { result.innerHTML = '<span style="color:var(--red-400)">Enter URL and API key</span>'; return; }

    result.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await Api.testConnection({ jellyfinUrl: url, apiKey: key });
      if (r.success) {
        result.innerHTML = `<span style="color:var(--green-400)">Connected to ${Utils.escapeHtml(r.serverName)} (v${Utils.escapeHtml(r.version)})</span>`;
        document.getElementById('setupSaveBtn').disabled = false;
        await this._loadLibs();
      } else {
        result.innerHTML = `<span style="color:var(--red-400)">${Utils.escapeHtml(r.error || 'Connection failed')}</span>`;
      }
    } catch (e) {
      result.innerHTML = `<span style="color:var(--red-400)">${Utils.escapeHtml(e.message)}</span>`;
    }
  },

  async _loadLibs() {
    try {
      const libs = await Api.getLibraries();
      this._libraries = Array.isArray(libs) ? libs : [];
      const container = document.getElementById('setupLibs');
      if (this._libraries.length === 0) {
        container.innerHTML = '<p class="text-sm text-2">No libraries found.</p>';
        container.classList.remove('hidden');
        return;
      }
      container.innerHTML = `
        <label class="form-label">Libraries to Monitor</label>
        ${this._libraries.map(lib => {
    const id = lib.ItemId || lib.Id;
    return `<label class="lib-check selected">
            <input type="checkbox" value="${id}" checked /> ${Utils.escapeHtml(lib.Name)}
            <span class="text-sm text-2">${lib.CollectionType || 'Mixed'}</span>
          </label>`;
  }).join('')}`;
      container.classList.remove('hidden');
      container.querySelectorAll('.lib-check').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const cb = el.querySelector('input');
          if (e.target !== cb) {
            cb.checked = !cb.checked;
          }
          el.classList.toggle('selected', cb.checked);
        });
      });
    } catch (_e) { /* ignore */ }
  },

  async _save() {
    const url = document.getElementById('setupUrl').value.trim();
    const key = document.getElementById('setupKey').value.trim();
    const libIds = Array.from(document.querySelectorAll('#setupLibs input:checked')).map(cb => cb.value);

    try {
      await Api.saveConfig({
        jellyfinUrl: url,
        apiKey: key,
        scanLibraryIds: JSON.stringify(libIds)
      });
      Utils.toast('Setup complete!', 'success');
      // Re-init app
      window.JellyProbe.init();
    } catch (e) {
      Utils.toast('Setup failed: ' + e.message, 'error');
    }
  }
};
