# Contributing to JellyProbe

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/simno/jellyprobe.git
   cd jellyprobe
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Jellyfin server details
   ```

4. **Start in dev mode** (auto-restarts on changes)
   ```bash
   npm run dev
   ```

5. **Open the dashboard** at `http://localhost:3000`

## Project Structure

```
src/
├── index.js              # Express server, routes, WebSocket, shutdown
├── api/
│   └── jellyfin.js       # Jellyfin API client (playback, HLS, libraries)
├── db/
│   └── schema.js         # SQLite schema, migrations, CRUD operations
└── services/
    ├── scanner.js         # Library scanner (periodic new-media detection)
    ├── scheduler.js       # Scheduled test run executor
    ├── testRunner.js      # Test queue, parallel execution, HLS download
    └── testRunManager.js  # Test run lifecycle (create, start, complete)

public/
├── index.html            # SPA shell
├── css/style.css         # All styles
└── js/
    ├── app.js            # Entry point
    ├── router.js         # Hash-based SPA router
    ├── api.js            # HTTP client wrapper
    ├── state.js          # Simple in-memory store
    ├── utils.js          # Formatting helpers
    ├── websocket.js      # WebSocket event dispatcher
    └── components/       # Page components (dashboard, settings, wizard)
```

## Code Style

- **Linting:** ESLint is configured. Run `npm run lint` before committing.
- **Formatting:** 2-space indent, single quotes, semicolons.
- **Naming:** camelCase for variables/functions, PascalCase for classes.
- **Unused parameters:** Prefix with `_` (e.g., `_error`) to satisfy the linter.
- **Frontend globals:** The SPA loads scripts in order; components reference `Store`, `Api`, `Utils`, `WS` as globals.

## Running Tests

```bash
npm test              # Run all tests with coverage
npm run test:watch    # Watch mode
npm run test:debug    # Verbose output
npm run check         # Lint + test (same as CI)
```

Tests use Jest and are located in `__tests__/`. Coverage reports are generated in `coverage/`.

## Pull Request Process

1. Fork the repo and create a branch from `main`.
2. Make your changes in focused, well-scoped commits.
3. Ensure `npm run check` passes (lint + tests).
4. Open a PR against `main` with a clear description of what changed and why.
5. PRs are squash-merged to keep a clean history.

## Reporting Issues

Use [GitHub Issues](https://github.com/simno/jellyprobe/issues) to report bugs or request features. Please include:

- Steps to reproduce (for bugs)
- Expected vs actual behaviour
- JellyProbe version and deployment method (Docker / manual)
- Jellyfin server version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
