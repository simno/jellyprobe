<div align="center">
<img src="./docs/jellyprobe.png" alt="JellyProbe" width="256" height="256" style="vertical-align: middle;">
</div>

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Test](https://github.com/simno/jellyprobe/actions/workflows/test.yml/badge.svg)](https://github.com/simno/jellyprobe/actions/workflows/test.yml)
[![Docker](https://github.com/simno/jellyprobe/actions/workflows/docker.yml/badge.svg)](https://github.com/simno/jellyprobe/actions/workflows/docker.yml)
[![Docker Version](https://ghcr-badge.egpl.dev/simno/jellyprobe/tags?label=version&n=1&ignore=sha256*,latest)](https://github.com/simno/jellyprobe/pkgs/container/jellyprobe)
[![Node](https://img.shields.io/badge/node-%3E%3D25-brightgreen.svg)](https://nodejs.org)

Have you ever had a media file that fails to play in Jellyfin, or that a user says won't play on their device.
JellyProbe is an automated testing tool for Jellyfin servers. It simulates real-world client playback by triggering 
transcoding and validating HLS stream delivery across multiple device profiles, making it easier to identify and 
troubleshoot playback issues in your media library or transcoding settings.

This helps server admins verify that their transcoding hardware (QuickSync, NVENC, etc.) and software configuration can 
handle various codecs and bitrates without manual testing.

## Key Features

-   **Automated Playback Tests:** Simulates real HLS streaming sessions to verify transcoding.
-   **Device Profiles:** Define custom profiles (H.264, HEVC, AV1) with specific bitrate and resolution constraints.
-   **Intelligent Library Scanning:** Can detect new media and can create custom media test runs.
-   **Live Dashboard:** Watch parallel transcoding in real-time with a live video preview grid.
-   **Scheduling:** Set up recurring daily or weekly test runs for your libraries.
-   **SSRF Protection:** Built-in security proxy for Jellyfin media paths.

## Tech Stack

-   **Backend:** Node.js, Express, better-sqlite3.
-   **Frontend:** Vanilla JS (SPA architecture), Lucide Icons, Hls.js.
-   **Database:** SQLite with WAL mode for high-concurrency logging.

## Installation

### Using Docker (Recommended)

```bash
docker run -d \
  --name jellyprobe \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  -e ENCRYPTION_KEY=your_secret_key \
  ghcr.io/simno/jellyprobe:latest
```

### Manual Installation

1.  Clone the repository.
2.  Install dependencies: `npm install`.
3.  Copy `.env.example` to `.env` and configure your keys.
4.  Start the server: `npm start`.

## Usage

1.  **Setup:** Enter your Jellyfin URL and API Key in the Settings.
2.  **Profiles:** Create device profiles for the codecs you want to test (e.g., a "4K HEVC" profile and a "720p H.264" profile).
3.  **Wizard:** Click "New Run" to start a test. You can choose:
    -   **All Media:** Tests every item in selected libraries.
    -   **Recent:** Tests only media added in the last X days.
    -   **Custom:** Search and select specific movies or episodes.
4.  **Monitor:** Use the Dashboard to view progress. Use the **"Show passed"** toggle to hide successful tests and quickly identify playback errors.

## Development

-   **Run tests:** `npm test`
-   **Lint code:** `npm run lint`
-   **Dev mode:** `npm run dev` (requires nodemon)

## License

MIT License. See [LICENSE](LICENSE) for details.
