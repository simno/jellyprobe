/* api.js — API client */
 
const Api = {
  _timeout: 30000,

  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this._timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${res.status}`);
      }
      return res.json();
    } finally {
      clearTimeout(id);
    }
  },

  get(url) { return this._fetch(url); },
  post(url, body) {
    return this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  },
  put(url, body) {
    return this._fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  },
  del(url) { return this._fetch(url, { method: 'DELETE' }); },

  // Specific endpoints
  getConfig()        { return this.get('/api/config'); },
  saveConfig(data)   { return this.post('/api/config', data); },
  testConnection(d)  { return this.post('/api/config/test', d); },
  getLibraries()     { return this.get('/api/libraries'); },
  getLibraryItems(id, limit = 1000, start = 0) {
    return this.get(`/api/libraries/${id}/items?limit=${limit}&startIndex=${start}`);
  },
  searchLibraryItems(id, query, limit = 50) {
    return this.get(`/api/libraries/${id}/items?limit=${limit}&searchTerm=${encodeURIComponent(query)}`);
  },
  getLibraryCount(id, recent = false, days = 7) {
    return this.get(`/api/libraries/${id}/count?recent=${recent}&days=${days}`);
  },
  getRecentItems(id, days = 7, limit = 1000) {
    return this.get(`/api/libraries/${id}/items/recent?days=${days}&limit=${limit}`);
  },
  getDevices()       { return this.get('/api/devices'); },
  addDevice(d)       { return this.post('/api/devices', d); },
  updateDevice(id, d){ return this.put(`/api/devices/${id}`, d); },
  deleteDevice(id)   { return this.del(`/api/devices/${id}`); },
  getTestRuns()      { return this.get('/api/test-runs'); },
  getTestRun(id)     { return this.get(`/api/test-runs/${id}`); },
  getActiveTestRun() { return this.get('/api/test-runs/active'); },
  getTestRunResults(id) { return this.get(`/api/test-runs/${id}/results`); },
  createTestRun(d)   { return this.post('/api/test-runs', d); },
  startTestRun(id)   { return this.post(`/api/test-runs/${id}/start`); },
  pauseTestRun(id)   { return this.post(`/api/test-runs/${id}/pause`); },
  resumeTestRun(id)  { return this.post(`/api/test-runs/${id}/resume`); },
  cancelTestRun(id)  { return this.post(`/api/test-runs/${id}/cancel`); },
  getSchedules()     { return this.get('/api/schedules'); },
  createSchedule(d)  { return this.post('/api/schedules', d); },
  updateSchedule(id, d) { return this.put(`/api/schedules/${id}`, d); },
  deleteSchedule(id) { return this.del(`/api/schedules/${id}`); },
  runScheduleNow(id) { return this.post(`/api/schedules/${id}/run`); }
};
