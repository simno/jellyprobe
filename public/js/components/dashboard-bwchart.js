/* global Chart */

// Bandwidth chart for the dashboard. Buckets bytes-per-second arrivals from
// WebSocket events into wall-clock seconds and renders a rolling line.
const DashboardBwChart = {
  _chart: null,
  _startTime: 0,
  _buckets: {},
  _totalBytes: 0,

  init() {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('bwChart');
    if (!canvas) return;
    this._totalBytes = 0;
    this._startTime = Date.now();
    this._buckets = {};
    this._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'MB/s',
          data: [],
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: 'Seconds', color: '#64748b' }, ticks: { color: '#64748b', maxTicksLimit: 20 }, grid: { color: 'rgba(148,163,184,0.08)' } },
          y: { title: { display: true, text: 'MB/s', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(148,163,184,0.08)' }, beginAtZero: true }
        },
        plugins: { legend: { display: false } }
      }
    });
  },

  update(d) {
    if (!this._chart) return;
    const sec = Math.floor((Date.now() - this._startTime) / 1000);
    if (!this._buckets[sec]) this._buckets[sec] = 0;
    this._buckets[sec] += d.bytesThisSecond;
    this._totalBytes += d.bytesThisSecond;

    const maxSec = Math.max(...Object.keys(this._buckets).map(Number));
    const labels = [];
    const data = [];
    for (let s = 0; s <= maxSec; s++) {
      labels.push(s);
      data.push(((this._buckets[s] || 0) / (1024 * 1024)).toFixed(2));
    }
    this._chart.data.labels = labels;
    this._chart.data.datasets[0].data = data;
    this._chart.update('none');
  },

  destroy() {
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }
};
