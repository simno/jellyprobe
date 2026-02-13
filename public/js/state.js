/* state.js — Simple reactive state store */
 
const Store = {
  _state: {
    config: null,
    devices: [],
    libraries: [],

    // Wizard
    selectedDevices: [],
    selectedLibraries: [],
    selectedMedia: [],
    mediaFilter: 'all',
    allMediaItems: [],
    allMediaCount: 0,
    wizardStep: 1,

    // Dashboard
    currentTestRun: null,
    testResults: [],
    logEntries: [],
    activeStreams: [],   // {itemId, deviceId, mediaSourceId, playSessionId, ...}

    // History
    testRuns: []
  },

  _listeners: {},

  get(key) { return this._state[key]; },

  set(key, value) {
    this._state[key] = value;
    (this._listeners[key] || []).forEach(fn => fn(value));
  },

  on(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
  },

  off(key, fn) {
    if (!this._listeners[key]) return;
    this._listeners[key] = this._listeners[key].filter(f => f !== fn);
  }
};
