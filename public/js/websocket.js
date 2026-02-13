/* websocket.js — WebSocket client with auto-reconnect */
 
const WS = {
  _ws: null,
  _reconnectTimer: null,
  _handlers: {},

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${proto}//${location.host}`);

    this._ws.onopen = () => {
      const dot = document.getElementById('wsStatus');
      if (dot) dot.classList.add('connected');
    };

    this._ws.onclose = () => {
      const dot = document.getElementById('wsStatus');
      if (dot) dot.classList.remove('connected');
      this._reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this._ws.onerror = () => {};

    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._dispatch(msg.event, msg.data);
      } catch (_err) { /* ignore */ }
    };
  },

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  },

  _dispatch(event, data) {
    (this._handlers[event] || []).forEach(fn => fn(data));
  }
};
