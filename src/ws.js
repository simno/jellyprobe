const WebSocket = require('ws');
const log = require('./utils/logger');

const HEARTBEAT_INTERVAL_MS = 30_000;
// Bound the per-client send buffer. Hit when a client stalls or its TCP window
// shrinks; we'd rather drop messages than let memory grow unboundedly under
// parallel test load (each test emits frequent progress/bandwidth events).
const MAX_BUFFERED_BYTES = 1_000_000;

function createBroadcaster(server) {
  const wss = new WebSocket.Server({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (err) => log.error('WebSocket client error:', err.message));
  });

  // Detect half-open connections (no FIN, no RST). A client that never replies
  // to a ping gets terminated so we stop sending into a black hole.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        log.debug('Terminating unresponsive WebSocket client');
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_e) { /* terminated next tick */ }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));

  function broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Drop messages for clients that can't keep up rather than buffering
      // unboundedly. A reconnect will resync state via the REST endpoints.
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        log.warn(`Dropping WS message for slow client (buffered=${client.bufferedAmount})`);
        continue;
      }
      try {
        client.send(message);
      } catch (err) {
        log.error('WebSocket send failed:', err);
      }
    }
  }

  function forwardEvents(emitter, events) {
    for (const event of events) {
      emitter.on(event, (data) => broadcast(event, data));
    }
  }

  return { wss, broadcast, forwardEvents };
}

module.exports = { createBroadcaster };
