const SchedulesPage = {
  render() {
    return `
      <h1 class="page-title">Scheduled Runs</h1>
      <p class="page-subtitle">Automated test runs on a recurring schedule</p>
      <div id="schedulesContent"><div class="spinner"></div></div>`;
  },

  async init() {
    await this._load();
  },

  async _load() {
    const container = document.getElementById('schedulesContent');
    try {
      const schedules = await Api.getSchedules();
      const devices = await Api.getDevices();
      Store.set('devices', devices);

      if (!schedules || schedules.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i data-lucide="calendar-off"></i>
            <p>No scheduled runs yet.<br><a href="#/" class="text-accent">Create one from the wizard →</a></p>
          </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const devMap = {};
      devices.forEach(d => { devMap[d.id] = d.name; });

      container.innerHTML = schedules.map(s => {
        const freqLabel = { daily: 'Daily', weekly: 'Weekly', every6h: 'Every 6h', every12h: 'Every 12h' }[s.frequency] || s.frequency;
        const when = s.frequency === 'weekly'
          ? `${dayNames[s.dayOfWeek ?? 0]}s at ${s.timeOfDay}`
          : `at ${s.timeOfDay}`;
        const scopeLabel = s.mediaScope === 'recent'
          ? `Last ${s.mediaDays === 1 ? '24h' : s.mediaDays === 2 ? '48h' : s.mediaDays + 'd'}`
          : 'All media';
        const devNames = s.deviceIds.map(id => devMap[id] || `#${id}`).join(', ');
        const nextLabel = s.nextRunAt ? Utils.relativeTime(s.nextRunAt) : '—';

        return `
          <div class="schedule-card${s.enabled ? '' : ' schedule-disabled'}" data-sid="${s.id}">
            <div class="schedule-card-header">
              <div class="schedule-card-title">
                <span class="schedule-name">${Utils.escapeHtml(s.name)}</span>
                <span class="badge ${s.enabled ? 'badge-success' : 'badge-neutral'}">${s.enabled ? 'Active' : 'Paused'}</span>
              </div>
              <div class="schedule-card-actions">
                <button class="btn btn-ghost btn-sm sched-toggle" data-sid="${s.id}" data-enabled="${s.enabled ? '1' : '0'}" title="${s.enabled ? 'Pause' : 'Enable'}">
                  <i data-lucide="${s.enabled ? 'pause' : 'play'}"></i>
                </button>
                <button class="btn btn-ghost btn-sm sched-run" data-sid="${s.id}" title="Run now">
                  <i data-lucide="rocket"></i>
                </button>
                <button class="btn btn-ghost btn-sm sched-delete" data-sid="${s.id}" title="Delete">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </div>
            <div class="schedule-card-body">
              <div class="schedule-detail"><i data-lucide="clock"></i> ${freqLabel} ${when}</div>
              <div class="schedule-detail"><i data-lucide="monitor-smartphone"></i> ${Utils.escapeHtml(devNames)}</div>
              <div class="schedule-detail"><i data-lucide="film"></i> ${scopeLabel} · ${s.libraryIds.length} librar${s.libraryIds.length === 1 ? 'y' : 'ies'}</div>
              <div class="schedule-detail"><i data-lucide="timer"></i> ${s.testDuration}s per test · ${s.parallelTests} parallel</div>
              <div class="schedule-detail text-2"><i data-lucide="calendar-check"></i> Next: ${nextLabel}${s.lastRunAt ? ' · Last: ' + Utils.relativeTime(s.lastRunAt) : ''}</div>
            </div>
          </div>`;
      }).join('');

      container.querySelectorAll('.sched-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.sid);
          const nowEnabled = btn.dataset.enabled === '1';
          try {
            await Api.updateSchedule(id, { enabled: !nowEnabled });
            Utils.toast(nowEnabled ? 'Schedule paused' : 'Schedule enabled', 'success');
            this._load();
          } catch (err) { Utils.toast(err.message, 'error'); }
        });
      });

      container.querySelectorAll('.sched-run').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.sid);
          try {
            btn.disabled = true;
            await Api.runScheduleNow(id);
            Utils.toast('Schedule triggered — check Dashboard', 'success');
          } catch (err) { Utils.toast(err.message, 'error'); }
          btn.disabled = false;
        });
      });

      container.querySelectorAll('.sched-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this schedule?')) return;
          const id = parseInt(btn.dataset.sid);
          try {
            await Api.deleteSchedule(id);
            Utils.toast('Schedule deleted', 'success');
            this._load();
          } catch (err) { Utils.toast(err.message, 'error'); }
        });
      });

      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      container.innerHTML = `<p class="text-2">Failed to load schedules: ${Utils.escapeHtml(e.message)}</p>`;
    }
  }
};
