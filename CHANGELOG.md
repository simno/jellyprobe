# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-16

### Added

- Automated HLS playback testing against Jellyfin servers
- Device profile management (H.264, HEVC, VP9, AV1, and more)
- Test run wizard with three media scopes: All, Recent, and Custom
- Live dashboard with real-time video preview grid and bandwidth chart
- Parallel test execution with configurable concurrency (1-10)
- Spread/jitter start to avoid overwhelming the server
- Scheduled test runs (daily, weekly, every 6h/12h)
- Library scanning for automatic new-media detection
- Results matrix grouped by media item and device profile
- AES-256-CBC encryption for API keys at rest
- Docker image with multi-arch support (amd64, arm64)
- Interactive `deploy.sh` for Docker Compose setup
- WebSocket-based live event streaming to the dashboard
- SSRF-protected Jellyfin proxy for HLS preview playback
- CI/CD with GitHub Actions (lint, test, Docker build)

[0.1.0]: https://github.com/simno/jellyprobe/releases/tag/v0.1.0
