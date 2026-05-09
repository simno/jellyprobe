/* global Hls, VideoCodecRegistry */

// Live-preview grid for the dashboard. Owns the previewGrid DOM element,
// HLS.js instances, and slot lifecycle. Decoupled from DashboardPage so
// the dashboard controller doesn't have to track player state.
const DashboardPreviewGrid = {
  _maxSlots() {
    const config = Store.get('config');
    return config?.maxParallelPreviews ?? 6;
  },

  init() {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    const config = Store.get('config');
    if (config?.showPreviews === 0) return;

    const maxSlots = this._maxSlots();
    const cols = Math.min(config?.maxParallelTests || 2, maxSlots);
    grid.dataset.cols = Math.min(cols, 4);
    grid.innerHTML = '';
    for (let i = 0; i < cols; i++) {
      grid.innerHTML += `<div class="preview-cell idle" id="preview-${i}"></div>`;
    }
  },

  add(streamInfo) {
    const config = Store.get('config');
    if (config?.showPreviews === 0) return;

    const grid = document.getElementById('previewGrid');
    if (!grid) return;

    let slot = grid.querySelector('.preview-cell.idle');

    if (!slot) {
      const count = grid.querySelectorAll('.preview-cell').length;
      const maxSlots = Math.min(this._maxSlots(), config?.maxParallelTests || 2);
      if (count >= maxSlots) return;
      const cell = document.createElement('div');
      cell.className = 'preview-cell';
      cell.id = `preview-${count}`;
      grid.appendChild(cell);
      const cols = Math.min(count + 1, 4);
      if (parseInt(grid.dataset.cols) < cols) grid.dataset.cols = cols;
      slot = cell;
    } else {
      slot.classList.remove('idle');
    }
    slot.dataset.itemId = streamInfo.itemId;
    slot.dataset.deviceId = streamInfo.deviceId;

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
        <span class="preview-cell-badge">${VideoCodecRegistry.getVideoCodecLabel(streamInfo.deviceConfig?.videoCodec)}</span>
      </div>`;

    const video = slot.querySelector('video');

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 10, maxMaxBufferLength: 15 });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, () => { /* test result is the source of truth, not the embedded preview */ });
      slot._hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
    }

    video.addEventListener('error', () => { /* see above */ });
  },

  remove(itemId, deviceId) {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    const slots = grid.querySelectorAll('.preview-cell');
    for (const s of slots) {
      if (s.dataset.itemId === itemId && (!deviceId || String(s.dataset.deviceId) === String(deviceId))) {
        this._teardownSlot(s);
        break;
      }
    }
  },

  clear() {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    grid.querySelectorAll('.preview-cell').forEach((s) => this._teardownSlot(s));
  },

  _teardownSlot(s) {
    if (s._hls) { s._hls.destroy(); s._hls = null; }
    const video = s.querySelector('video');
    if (video) { video.pause(); video.src = ''; }
    s.innerHTML = '';
    s.classList.add('idle');
    delete s.dataset.itemId;
    delete s.dataset.deviceId;
  }
};
