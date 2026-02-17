const WizardPage = {
  _step: 1,
  _configuredLibs: [],

  render() {
    return `
      <h1 class="page-title">Create Test Run</h1>
      <p class="page-subtitle">Select devices, media, and configure your test</p>

      <div class="stepper" id="stepper">
        <div class="stepper-step active" data-s="1">
          <div class="stepper-dot">1</div>
          <div class="stepper-label">Devices</div>
        </div>
        <div class="stepper-step" data-s="2">
          <div class="stepper-dot">2</div>
          <div class="stepper-label">Media</div>
        </div>
        <div class="stepper-step" data-s="3">
          <div class="stepper-dot">3</div>
          <div class="stepper-label">Review</div>
        </div>
      </div>

      <div class="wizard-body" id="wizardBody"></div>`;
  },

  async init() {
    this._step = 1;
    Store.set('selectedDevices', []);
    Store.set('selectedLibraries', []);
    Store.set('selectedMedia', []);
    Store.set('mediaFilter', 'all');
    Store.set('allMediaItems', []);
    Store.set('allMediaCount', 0);

    const devices = await Api.getDevices();
    Store.set('devices', devices);

    const config = Store.get('config');
    const libIds = config?.scanLibraryIds ? JSON.parse(config.scanLibraryIds) : [];
    try {
      const allLibs = await Api.getLibraries();
      this._configuredLibs = (Array.isArray(allLibs) ? allLibs : [])
        .filter(l => libIds.includes(l.ItemId || l.Id));
      Store.set('libraries', allLibs);
      Store.set('selectedLibraries', [...this._configuredLibs]);
    } catch (_e) { this._configuredLibs = []; }

    this._renderStep();
  },

  _updateStepper() {
    document.querySelectorAll('.stepper-step').forEach(el => {
      const s = parseInt(el.dataset.s);
      el.classList.remove('active', 'completed');
      if (s === this._step) el.classList.add('active');
      else if (s < this._step) el.classList.add('completed');
    });
  },

  _renderStep() {
    this._updateStepper();
    const body = document.getElementById('wizardBody');
    switch (this._step) {
    case 1: this._renderDevices(body); break;
    case 2: this._renderMedia(body); break;
    case 3: this._renderReview(body); break;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  /* --- Step 1: Devices --- */
  _renderDevices(body) {
    const devices = Store.get('devices');
    const selected = Store.get('selectedDevices');

    if (devices.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <i data-lucide="monitor-speaker"></i>
          <p>No device profiles configured yet.<br>Add one in <a href="#/settings" class="text-accent">Settings</a>.</p>
        </div>
        <div class="wizard-actions"><div></div></div>`;
      return;
    }

    body.innerHTML = `
      <div class="section-title"><i data-lucide="monitor-speaker"></i> Select Device Profiles</div>
      <div class="select-grid">
        ${devices.map(d => {
    const sel = selected.some(s => s.id === d.id);
    return `<div class="select-card${sel ? ' selected' : ''}" data-did="${d.id}">
            <div class="select-card-check">${sel ? '<i data-lucide="check"></i>' : ''}</div>
            <div class="select-card-title">${Utils.escapeHtml(d.name)}</div>
            <div class="select-card-meta">
              <span><i data-lucide="gauge"></i> ${Utils.formatBitrate(d.maxBitrate)}</span>
              <span><i data-lucide="film"></i> ${d.videoCodec} / ${d.audioCodec}</span>
            </div>
          </div>`;
  }).join('')}
      </div>
      <div class="wizard-actions">
        <div></div>
        <div class="wizard-actions-right">
          <button class="btn btn-primary" id="wizNext1"><i data-lucide="arrow-right"></i> Next: Media</button>
        </div>
      </div>`;

    body.querySelectorAll('.select-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.did);
        let sel = Store.get('selectedDevices');
        const idx = sel.findIndex(s => s.id === id);
        if (idx >= 0) sel.splice(idx, 1);
        else sel.push(devices.find(d => d.id === id));
        Store.set('selectedDevices', sel);
        this._renderStep();
      });
    });

    document.getElementById('wizNext1').addEventListener('click', () => {
      if (Store.get('selectedDevices').length === 0) { Utils.toast('Select at least one device', 'error'); return; }
      this._step = 2;
      this._renderStep();
    });
  },

  /* --- Step 2: Media (libraries + filter) --- */
  async _renderMedia(body) {
    const libs = this._configuredLibs;
    const selLibs = Store.get('selectedLibraries');
    const filter = Store.get('mediaFilter');

    body.innerHTML = `
      <div class="section-title"><i data-lucide="library"></i> Libraries</div>
      <div class="mb-24" id="libList">
        ${libs.map(l => {
    const id = l.ItemId || l.Id;
    const sel = selLibs.some(s => (s.ItemId || s.Id) === id);
    return `<div class="select-card select-card-compact${sel ? ' selected' : ''}" data-lid="${id}">
              <div class="select-card-check">${sel ? '<i data-lucide="check"></i>' : ''}</div>
              <div class="select-card-title">${Utils.escapeHtml(l.Name)}</div>
              <div class="select-card-meta">
                <span class="text-sm text-2">${l.CollectionType || 'Mixed'}</span>
              </div>
            </div>`;
  }).join('')}
      </div>

      <div class="section-title"><i data-lucide="filter"></i> Media Scope</div>
      <div class="filter-tabs mb-16" id="filterTabs">
        <button class="filter-tab${filter === 'all' ? ' active' : ''}" data-f="all">All media</button>
        <button class="filter-tab${filter === 'recent' ? ' active' : ''}" data-f="recent">Date range</button>
        <button class="filter-tab${filter === 'custom' ? ' active' : ''}" data-f="custom">Custom selection</button>
      </div>

      <div id="dateRangeWrap" class="${filter === 'recent' ? '' : 'hidden'} mb-16">
        <div class="form-group">
          <label class="form-label">Show media added in the last</label>
          <select class="form-select" id="dateRangeDays">
            <option value="1">24 hours</option>
            <option value="2">48 hours</option>
            <option value="7" selected>7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
      </div>

      <div id="mediaScopeInfo" class="text-sm text-2 mb-16"></div>
      <div id="mediaCustom" class="hidden"></div>

      <div class="wizard-actions">
        <button class="btn btn-ghost" id="wizPrev2"><i data-lucide="arrow-left"></i> Back</button>
        <div class="wizard-actions-right">
          <button class="btn btn-primary" id="wizNext2"><i data-lucide="arrow-right"></i> Next: Review</button>
        </div>
      </div>`;

    body.querySelectorAll('.select-card[data-lid]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.lid;
        const isSelected = el.classList.contains('selected');
        let sel = Store.get('selectedLibraries');

        if (isSelected) {
          sel = sel.filter(s => (s.ItemId || s.Id) !== id);
        } else {
          if (!sel.some(s => (s.ItemId || s.Id) === id)) {
            sel.push(libs.find(l => (l.ItemId || l.Id) === id));
          }
        }

        Store.set('selectedLibraries', sel);
        Store.set('allMediaItems', []);
        Store.set('selectedMedia', []);
        el.classList.toggle('selected');
        el.querySelector('.select-card-check').innerHTML = el.classList.contains('selected') ? '<i data-lucide="check"></i>' : '';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        this._loadMediaScope();
      });
    });

    document.getElementById('filterTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      Store.set('mediaFilter', tab.dataset.f);
      Store.set('allMediaItems', []);
      Store.set('selectedMedia', []);
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const drWrap = document.getElementById('dateRangeWrap');
      if (drWrap) drWrap.classList.toggle('hidden', tab.dataset.f !== 'recent');
      this._loadMediaScope();
    });

    const dateRangeEl = document.getElementById('dateRangeDays');
    if (dateRangeEl) {
      const savedDays = Store.get('mediaDays');
      if (savedDays) dateRangeEl.value = String(savedDays);
      dateRangeEl.addEventListener('change', () => {
        Store.set('mediaDays', parseInt(dateRangeEl.value));
        Store.set('allMediaItems', []);
        this._loadMediaScope();
      });
    }

    document.getElementById('wizPrev2').addEventListener('click', () => { this._step = 1; this._renderStep(); });
    document.getElementById('wizNext2').addEventListener('click', () => {
      if (Store.get('selectedLibraries').length === 0) { Utils.toast('Select at least one library', 'error'); return; }
      const f = Store.get('mediaFilter');
      if (f === 'custom' && Store.get('selectedMedia').length === 0) { Utils.toast('Select at least one media item', 'error'); return; }
      this._step = 3;
      this._renderStep();
    });

    await this._loadMediaScope();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async _loadMediaScope() {
    const info = document.getElementById('mediaScopeInfo');
    const custom = document.getElementById('mediaCustom');
    const filter = Store.get('mediaFilter');
    const selLibs = Store.get('selectedLibraries').filter(l => l && (l.ItemId || l.Id));

    if (selLibs.length === 0) {
      info.textContent = 'Select at least one library above.';
      custom.classList.add('hidden');
      return;
    }

    if (filter === 'all') {
      custom.classList.add('hidden');
      info.innerHTML = '<div class="spinner"></div>';
      let total = 0;
      for (const lib of selLibs) {
        try { const r = await Api.getLibraryCount(lib.ItemId || lib.Id); total += r.count || 0; } catch (_e) {/* */}
      }
      Store.set('allMediaCount', total);
      info.textContent = `All ${total} items from selected libraries will be tested.`;
    } else if (filter === 'recent') {
      custom.classList.add('hidden');
      info.innerHTML = '<div class="spinner"></div>';
      const days = Store.get('mediaDays') || 7;
      let items = [];
      for (const lib of selLibs) {
        try { const r = await Api.getRecentItems(lib.ItemId || lib.Id, days); if (r.items) items.push(...r.items); } catch (_e) {/* */}
      }
      Store.set('allMediaItems', items);
      const label = days === 1 ? '24 hours' : days === 2 ? '48 hours' : `${days} days`;
      info.textContent = items.length > 0
        ? `${items.length} items added in the last ${label} will be tested.`
        : `No media added in the last ${label}.`;
    } else {
      // Custom selection — search-first approach
      custom.classList.remove('hidden');
      const selected = Store.get('selectedMedia');
      info.textContent = `${selected.length} items selected`;

      custom.innerHTML = `
        <div class="search-wrap">
          <i data-lucide="search"></i>
          <input class="search-input" id="mediaSearch" placeholder="Type to search your libraries…" autofocus />
        </div>
        <div class="flex gap-8 mb-12 align-center">
          <button class="btn btn-sm btn-ghost" id="selNone">Clear selection</button>
          <span class="text-sm text-2 ml-auto" id="mediaCountLabel">${selected.length} selected</span>
        </div>
        <div class="media-list-compact" id="mediaGrid">
          ${selected.length > 0
    ? selected.map(item => this._renderMediaItem(item, true)).join('')
    : '<p class="text-sm text-2 text-center mt-16">Search above to find and select media items</p>'}
        </div>`;

      this._bindMediaGridClicks();

      const updateCount = () => {
        const sel = Store.get('selectedMedia');
        info.textContent = `${sel.length} items selected`;
        const lbl = document.getElementById('mediaCountLabel');
        if (lbl) lbl.textContent = `${sel.length} selected`;
      };

      let searchTimeout;
      document.getElementById('mediaSearch')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const q = e.target.value.trim();
        if (q.length < 2) {
          // Show only selected items when no search query
          this._renderMediaGrid('', true);
          return;
        }
        searchTimeout = setTimeout(() => this._searchMedia(q, selLibs, updateCount), 300);
      });

      document.getElementById('selNone')?.addEventListener('click', () => {
        Store.set('selectedMedia', []);
        this._renderMediaGrid('', true);
        updateCount();
      });

      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  async _searchMedia(query, selLibs, updateCount) {
    const grid = document.getElementById('mediaGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="text-center mt-16"><div class="spinner"></div></div>';

    let results = [];
    for (const lib of selLibs) {
      try {
        const r = await Api.searchLibraryItems(lib.ItemId || lib.Id, query, 50);
        if (r.items) results.push(...r.items);
      } catch (_e) { /* */ }
    }

    const selected = Store.get('selectedMedia');
    grid.innerHTML = results.length > 0
      ? results.map(item => {
        const sel = selected.some(m => m.Id === item.Id);
        return this._renderMediaItem(item, sel);
      }).join('')
      : '<p class="text-sm text-2 text-center mt-16">No results found</p>';

    this._bindMediaGridClicks(updateCount);
  },

  _renderMediaItem(item, sel) {
    const name = Utils.formatItemName(item);
    const type = item.Type === 'Episode' ? 'Episode' : item.Type === 'Movie' ? 'Movie' : 'Video';
    return `<label class="media-item${sel ? ' selected' : ''}" data-mid="${item.Id}">
      <input type="checkbox" ${sel ? 'checked' : ''} />
      <span class="media-item-name">${Utils.escapeHtml(name)}</span>
      <span class="media-item-type">${type}</span>
    </label>`;
  },

  _bindMediaGridClicks(updateCount) {
    const grid = document.getElementById('mediaGrid');
    if (!grid) return;
    const allItems = Store.get('allMediaItems');

    grid.querySelectorAll('.media-item').forEach(row => {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        const id = row.dataset.mid;
        let sel = Store.get('selectedMedia');
        const idx = sel.findIndex(m => m.Id === id);
        if (idx >= 0) {
          sel.splice(idx, 1);
        } else {
          // Find item from search results or allMediaItems cache
          const existing = allItems.find(i => i.Id === id);
          if (existing) sel.push(existing);
          else {
            // Item from search, build minimal object from the DOM
            const nameEl = row.querySelector('.media-item-name');
            sel.push({ Id: id, Name: nameEl ? nameEl.textContent : id });
          }
        }
        Store.set('selectedMedia', sel);
        const cb = row.querySelector('input');
        cb.checked = idx < 0;
        row.classList.toggle('selected', cb.checked);
        if (updateCount) updateCount();
        else {
          const info = document.getElementById('mediaScopeInfo');
          if (info) info.textContent = `${sel.length} items selected`;
          const lbl = document.getElementById('mediaCountLabel');
          if (lbl) lbl.textContent = `${sel.length} selected`;
        }
      });
    });
  },

  _renderMediaGrid(_query, selectedOnly) {
    const grid = document.getElementById('mediaGrid');
    if (!grid) return;
    const selected = Store.get('selectedMedia');

    if (selectedOnly || !_query) {
      grid.innerHTML = selected.length > 0
        ? selected.map(item => this._renderMediaItem(item, true)).join('')
        : '<p class="text-sm text-2 text-center mt-16">Search above to find and select media items</p>';
      this._bindMediaGridClicks();
    }
  },

  /* --- Step 3: Review & Launch --- */
  _renderReview(body) {
    const devices = Store.get('selectedDevices');
    const libs = Store.get('selectedLibraries');
    const filter = Store.get('mediaFilter');
    const config = Store.get('config');

    let mediaCount;
    if (filter === 'all') mediaCount = Store.get('allMediaCount');
    else if (filter === 'recent') mediaCount = Store.get('allMediaItems').length;
    else mediaCount = Store.get('selectedMedia').length;

    const totalTests = devices.length * mediaCount;
    const defDuration = config?.testDuration || 30;
    const defParallel = config?.maxParallelTests || 2;

    const days = Store.get('mediaDays') || 7;
    const scopeLabel = filter === 'all' ? 'All media'
      : filter === 'recent' ? `Last ${days === 1 ? '24 hours' : days === 2 ? '48 hours' : days + ' days'}`
        : 'Custom selection';

    body.innerHTML = `
      <div class="section-title"><i data-lucide="clipboard-check"></i> Review & Configure</div>

      <div class="review-block">
        <div class="review-block-title">Devices (${devices.length})</div>
        <div class="review-chips">
          ${devices.map(d => `<span class="review-chip">${Utils.escapeHtml(d.name)}</span>`).join('')}
        </div>
      </div>

      <div class="review-block">
        <div class="review-block-title">Libraries (${libs.length})</div>
        <div class="review-chips">
          ${libs.map(l => `<span class="review-chip">${Utils.escapeHtml(l.Name)}</span>`).join('')}
        </div>
      </div>

      <div class="review-block">
        <div class="review-block-title">Media</div>
        <div class="review-row"><span class="review-row-label">Scope</span><span class="review-row-value">${scopeLabel}</span></div>
        <div class="review-row"><span class="review-row-label">Items</span><span class="review-row-value">${mediaCount}</span></div>
      </div>

      <div class="review-block">
        <div class="review-block-title">Configuration</div>
        <div class="form-group">
          <label class="form-label">Test Duration (seconds)</label>
          <input class="form-input" type="number" id="revDuration" value="${defDuration}" min="5" max="300" />
        </div>
        <div class="form-group">
          <label class="form-label">Parallel Tests</label>
          <input class="form-input" type="number" id="revParallel" value="${defParallel}" min="1" max="10" />
        </div>
        </div>

      <div class="review-block">
        <div class="review-block-title">Summary</div>
        <div class="review-row"><span class="review-row-label">Total tests</span><span class="review-row-value">${totalTests}</span></div>
        <div class="review-row"><span class="review-row-label">Est. duration</span><span class="review-row-value" id="estDuration">${Utils.formatDuration(Math.ceil(totalTests / defParallel * (defDuration + 10)))}</span></div>
      </div>

      <div class="review-block">
        <div class="review-block-title">Schedule (optional)</div>
        <p class="text-sm text-2 mb-12">Schedule this test to run automatically, or launch it now.</p>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Frequency</label>
            <select class="form-select" id="schedFreq">
              <option value="">Don't schedule</option>
              <option value="every6h">Every 6 hours</option>
              <option value="every12h">Every 12 hours</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div class="form-group hidden" id="schedDayWrap" style="flex:1">
            <label class="form-label">Day of week</label>
            <select class="form-select" id="schedDay">
              <option value="0">Sunday</option><option value="1">Monday</option>
              <option value="2">Tuesday</option><option value="3">Wednesday</option>
              <option value="4">Thursday</option><option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
          </div>
          <div class="form-group hidden" id="schedTimeWrap" style="flex:1">
            <label class="form-label">Time</label>
            <input class="form-input" type="time" id="schedTime" value="02:00" />
          </div>
        </div>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-ghost" id="wizPrev3"><i data-lucide="arrow-left"></i> Back</button>
        <div class="wizard-actions-right">
          <button class="btn btn-accent btn-lg hidden" id="schedBtn"><i data-lucide="calendar-clock"></i> Save Schedule</button>
          <button class="btn btn-success btn-lg" id="launchBtn"><i data-lucide="rocket"></i> Launch Now</button>
        </div>
      </div>`;

    const updateEstimate = () => {
      const dur = parseInt(document.getElementById('revDuration').value) || 30;
      const par = parseInt(document.getElementById('revParallel').value) || 1;
      const el = document.getElementById('estDuration');
      if (el) el.textContent = Utils.formatDuration(Math.ceil(totalTests / par * (dur + 10)));
    };
    document.getElementById('revDuration').addEventListener('input', updateEstimate);
    document.getElementById('revParallel').addEventListener('input', updateEstimate);

    const schedFreq = document.getElementById('schedFreq');
    const schedDayWrap = document.getElementById('schedDayWrap');
    const schedTimeWrap = document.getElementById('schedTimeWrap');
    const schedBtn = document.getElementById('schedBtn');
    schedFreq.addEventListener('change', () => {
      const freq = schedFreq.value;
      schedDayWrap.classList.toggle('hidden', freq !== 'weekly');
      schedTimeWrap.classList.toggle('hidden', !freq);
      schedBtn.classList.toggle('hidden', !freq);
    });

    document.getElementById('wizPrev3').addEventListener('click', () => { this._step = 2; this._renderStep(); });
    document.getElementById('launchBtn').addEventListener('click', () => this._launch());
    document.getElementById('schedBtn').addEventListener('click', () => this._saveSchedule());
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async _launch() {
    const btn = document.getElementById('launchBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></div> Launching…';

    try {
      const duration = parseInt(document.getElementById('revDuration').value) || 30;
      const parallel = parseInt(document.getElementById('revParallel').value) || 2;

      // Build compact media scope instead of gathering all items
      const filter = Store.get('mediaFilter');
      const libs = Store.get('selectedLibraries');
      const libIds = libs.map(l => l.ItemId || l.Id);
      
      let mediaScope = { type: filter, libraryIds: libIds };
      let estimatedCount = 0;

      if (filter === 'all') {
        estimatedCount = Store.get('allMediaCount');
      } else if (filter === 'recent') {
        const days = Store.get('mediaDays') || 7;
        const items = Store.get('allMediaItems');
        mediaScope.days = days;
        // Pin to the exact item IDs the user previewed so the run
        // tests precisely what was shown, not a re-fetch from Jellyfin
        mediaScope.itemIds = items.map(m => m.Id);
        estimatedCount = items.length;
      } else {
        const selected = Store.get('selectedMedia');
        mediaScope.itemIds = selected.map(m => m.Id);
        estimatedCount = selected.length;
      }

      if (estimatedCount === 0) { 
        Utils.toast('No media items to test', 'error'); 
        btn.disabled = false; 
        btn.innerHTML = '<i data-lucide="rocket"></i> Launch Now'; 
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return; 
      }

      await Api.saveConfig({ maxParallelTests: parallel });
      const updatedConfig = Store.get('config') || {};
      updatedConfig.maxParallelTests = parallel;
      Store.set('config', updatedConfig);

      const result = await Api.createTestRun({
        devices: Store.get('selectedDevices'),
        mediaScope,
        totalTests: Store.get('selectedDevices').length * estimatedCount,
        testConfig: { duration }
      });

      if (result.success) {
        Store.set('currentTestRun', {
          id: result.testRun.id,
          name: result.testRun.name,
          status: 'pending',
          totalTests: result.testRun.totalTests,
          completedTests: 0,
          successfulTests: 0,
          failedTests: 0
        });
        Store.set('logEntries', []);
        Store.set('testResults', []);
        Store.set('activeStreams', []);

        // Navigate to dashboard and scroll to top
        location.hash = '#/dashboard';
        window.scrollTo(0, 0);

        // Start the run (fire without blocking — server returns immediately)
        Api.startTestRun(result.testRun.id).then(() => {
          const run = Store.get('currentTestRun');
          if (run) { run.status = 'running'; Store.set('currentTestRun', run); }
        }).catch(() => {});
      }
    } catch (e) {
      Utils.toast('Launch failed: ' + e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="rocket"></i> Launch Now';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  async _saveSchedule() {
    const btn = document.getElementById('schedBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></div> Saving…';

    try {
      const frequency = document.getElementById('schedFreq').value;
      if (!frequency) { Utils.toast('Select a frequency', 'error'); return; }

      const devices = Store.get('selectedDevices');
      const libs = Store.get('selectedLibraries');
      const filter = Store.get('mediaFilter');
      const days = Store.get('mediaDays') || 7;

      const data = {
        name: `${frequency === 'weekly' ? 'Weekly' : frequency === 'daily' ? 'Daily' : frequency} test`,
        enabled: true,
        frequency,
        dayOfWeek: frequency === 'weekly' ? parseInt(document.getElementById('schedDay').value) : null,
        timeOfDay: document.getElementById('schedTime').value || '02:00',
        deviceIds: devices.map(d => d.id),
        libraryIds: libs.map(l => l.ItemId || l.Id),
        mediaScope: filter === 'recent' ? 'recent' : 'all',
        mediaDays: filter === 'recent' ? days : 7,
        testDuration: parseInt(document.getElementById('revDuration').value) || 30,
        parallelTests: parseInt(document.getElementById('revParallel').value) || 2
      };

      await Api.createSchedule(data);
      Utils.toast('Schedule saved!', 'success');
      location.hash = '#/schedules';
    } catch (e) {
      Utils.toast('Failed to save schedule: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="calendar-clock"></i> Save Schedule';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
};
