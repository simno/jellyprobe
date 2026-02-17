# API Reference

JellyProbe exposes a REST API and a WebSocket endpoint. All endpoints return JSON.

## Base URL

```
http://localhost:3000
```

---

## Configuration

### `GET /api/config`

Returns the current server configuration. The API key is masked.

### `POST /api/config`

Update configuration fields. Only recognised fields are applied.

**Body (example):**
```json
{
  "jellyfinUrl": "http://jellyfin:8096",
  "apiKey": "your-api-key",
  "scanInterval": 300,
  "testDuration": 30,
  "maxParallelTests": 2,
  "showPreviews": 1,
  "maxParallelPreviews": 6
}
```

### `POST /api/config/test`

Test a Jellyfin connection without saving.

**Body:**
```json
{ "jellyfinUrl": "http://jellyfin:8096", "apiKey": "your-api-key" }
```

**Response:**
```json
{ "success": true, "serverName": "My Jellyfin", "version": "10.9.0" }
```

---

## Libraries

### `GET /api/libraries`

List all Jellyfin libraries (virtual folders).

### `GET /api/libraries/:libraryId/items`

List items in a library.

| Query param   | Type   | Default | Description                |
|---------------|--------|---------|----------------------------|
| `limit`       | number | 100     | Max items (1-1000)         |
| `startIndex`  | number | 0       | Pagination offset          |
| `searchTerm`  | string | —       | Filter by name (max 200ch) |

### `GET /api/libraries/:libraryId/count`

Get the total item count for a library.

| Query param | Type    | Default | Description                      |
|-------------|---------|---------|----------------------------------|
| `recent`    | boolean | false   | Count only recently added items  |
| `days`      | number  | 7       | Lookback window (1-365)          |

### `GET /api/libraries/:id/items/recent`

Fetch recently added items.

| Query param | Type   | Default | Description        |
|-------------|--------|---------|--------------------|
| `days`      | number | 7       | Lookback (1-365)   |
| `limit`     | number | 1000    | Max items (1-10000)|

---

## Device Profiles

### `GET /api/devices`

List all device profiles.

### `POST /api/devices`

Create a new device profile.

**Body:**
```json
{
  "name": "Smart TV - 4K HEVC",
  "deviceId": "jellyprobe-tv-4k",
  "videoCodec": "hevc",
  "audioCodec": "aac",
  "maxBitrate": 80000000,
  "maxWidth": 3840,
  "maxHeight": 2160
}
```

### `PUT /api/devices/:id`

Update an existing device profile. Send only the fields you want to change.

### `DELETE /api/devices/:id`

Delete a device profile.

---

## Single Tests

### `POST /api/tests/run`

Queue a single playback test.

**Body:**
```json
{ "itemId": "abc123", "deviceId": 1, "duration": 30 }
```

### `GET /api/tests/queue`

Get queue status (`queueLength`, `isRunning`).

### `POST /api/tests/pause`

Pause the test queue.

### `POST /api/tests/resume`

Resume a paused queue.

### `POST /api/tests/cancel`

Cancel all queued and running tests.

### `GET /api/tests`

Get test history.

| Query param | Type   | Default | Description          |
|-------------|--------|---------|----------------------|
| `limit`     | number | 100     | Max results (1-1000) |
| `offset`    | number | 0       | Pagination offset    |

### `GET /api/tests/stats`

Get aggregate stats (`total`, `passed`, `failed`).

---

## Test Runs

A test run is a batch of tests across multiple media items and device profiles.

### `POST /api/test-runs`

Create a new test run.

**Body:**
```json
{
  "devices": [{ "id": 1, "name": "Web", "deviceId": "jellyprobe-web-1080p", "maxBitrate": 10000000, "videoCodec": "h264", "audioCodec": "aac" }],
  "mediaScope": { "type": "recent", "libraryIds": ["lib-1"], "days": 7 },
  "testConfig": { "duration": 30 },
  "totalTests": 50
}
```

`mediaScope.type` can be `all`, `recent`, or `custom` (with `itemIds` array).
Alternatively, pass `mediaItems` directly for legacy support.

### `GET /api/test-runs`

List all test runs (most recent first, limit 50).

### `GET /api/test-runs/active`

Get the currently running or paused test run (or `null`).

### `GET /api/test-runs/:id`

Get a specific test run by ID.

### `GET /api/test-runs/:id/results`

Get all test results for a run.

### `POST /api/test-runs/:id/start`

Start a pending test run. Queues all tests and begins execution.

### `POST /api/test-runs/:id/pause`

Pause a running test run.

### `POST /api/test-runs/:id/resume`

Resume a paused test run.

### `POST /api/test-runs/:id/cancel`

Cancel a test run and discard remaining tests.

---

## Scheduled Runs

### `GET /api/schedules`

List all scheduled runs.

### `POST /api/schedules`

Create a new schedule.

**Body:**
```json
{
  "name": "Nightly Full Scan",
  "frequency": "daily",
  "timeOfDay": "02:00",
  "deviceIds": [1, 2],
  "libraryIds": ["lib-1"],
  "mediaScope": "all",
  "testDuration": 30,
  "parallelTests": 2
}
```

`frequency`: `daily`, `weekly`, `every12h`, `every6h`.
For `weekly`, include `dayOfWeek` (0 = Sunday, 6 = Saturday).

### `PUT /api/schedules/:id`

Update a schedule. Send only the fields you want to change.

### `DELETE /api/schedules/:id`

Delete a schedule.

### `POST /api/schedules/:id/run`

Trigger a schedule immediately (creates and starts a test run).

---

## Scanner

### `POST /api/scan/trigger`

Trigger a library scan now.

### `GET /api/scan/status`

Get scanner status and last scan time.

---

## Streaming

### `GET /api/stream/:itemId`

HLS stream entry point for live preview. Returns a rewritten `master.m3u8` playlist that routes segments through the `/jf/` proxy.

| Query param     | Type   | Required | Description           |
|-----------------|--------|----------|-----------------------|
| `mediaSourceId` | string | yes      | Jellyfin media source |
| `deviceId`      | string | yes      | Device identifier     |
| `playSessionId` | string | no       | Play session ID       |
| `videoCodec`    | string | no       | Default: `h264`       |
| `audioCodec`    | string | no       | Default: `aac`        |
| `maxBitrate`    | number | no       | Default: 20000000     |
| `maxWidth`      | number | no       | Default: 1920         |
| `maxHeight`     | number | no       | Default: 1080         |

---

## Utility

### `GET /api/version`

```json
{ "version": "0.1.0" }
```

### `GET /health`

```json
{ "status": "healthy", "timestamp": "...", "uptime": 12345 }
```

---

## WebSocket Events

Connect to `ws://localhost:3000` to receive real-time events. Messages are JSON:

```json
{ "event": "eventName", "data": { } }
```

### Events

| Event                 | Description                                  |
|-----------------------|----------------------------------------------|
| `testStarted`         | A test began executing                       |
| `testProgress`        | Test stage update (starting, downloading...) |
| `testStreamReady`     | HLS stream URL available for preview         |
| `testStreamEnding`    | Stream about to stop — tear down preview     |
| `testCompleted`       | Test finished (success or failure)           |
| `bandwidthUpdate`     | Per-second download byte count               |
| `queueUpdated`        | Queue length / active test count changed     |
| `testRunCreated`      | A new test run was created                   |
| `testRunStarted`      | Test run began executing                     |
| `testRunProgress`     | Completed / total count updated              |
| `testRunPaused`       | Test run was paused                          |
| `testRunResumed`      | Test run was resumed                         |
| `testRunCancelled`    | Test run was cancelled                       |
| `testRunCompleted`    | All tests in a run finished                  |
| `scanStarted`         | Library scan began                           |
| `scanCompleted`       | Library scan finished                        |
| `scanError`           | Library scan encountered an error            |
| `configUpdated`       | Server config was changed                    |
| `scheduledRunStarted` | A scheduled run was triggered                |
