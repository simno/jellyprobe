const Utils = {
  formatBitrate(bps) {
    if (!bps) return '0 Mbps';
    return (bps / 1_000_000).toFixed(1) + ' Mbps';
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  },

  formatDuration(seconds) {
    if (!seconds) return '0s';
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  },

  formatItemName(item) {
    if (!item) return 'Unknown';
    if (item.Type === 'Episode' && item.SeriesName) {
      const s = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
      const e = item.IndexNumber ? `E${item.IndexNumber}` : '';
      const num = s || e ? ` ${s}${e}` : '';
      return `${item.SeriesName}${num} — ${item.Name}`;
    }
    return item.Name || 'Unknown';
  },

  relativeTime(dateStr) {
    if (!dateStr) return '';
    // SQLite CURRENT_TIMESTAMP is UTC but lacks a Z suffix
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = {
      success: 'check-circle',
      error: 'alert-circle',
      info: 'info'
    };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i> ${this.escapeHtml(message)}`;
    container.appendChild(el);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }
};
