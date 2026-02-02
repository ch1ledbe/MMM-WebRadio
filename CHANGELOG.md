# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.2.0] – 2026-02-02

### Added
- MPV IPC–based metadata handling for song titles (`metadata`, `media-title`)
- Single-stream architecture: mpv is now the only consumer of the radio stream
- Keywords/tags in `package.json` for improved module list discovery
- `npm run upgrade` script for clean in-place module updates from Git
- Robust IPC command handling with proper JSON line parsing
- Improved process cleanup on player exit (exit/close handling)

### Changed
- Migrated title handling away from ICY HTTP polling to mpv IPC
- Volume changes are now applied instantly via mpv IPC (no stream restart)
- Scheduler start/stop uses fade-in / fade-out without restarting playback
- Web API authentication clarified and enforced only on `/api/*`
- Web UI defaults aligned with actual runtime behavior
- Reduced unnecessary network usage when playback is stopped

### Removed
- Removed ICY metadata streaming via `@music-metadata/icy`
- Removed secondary HTTP stream used only for title polling
- Removed unused and redundant mpv process exit handlers
- Removed unnecessary dependencies from `package.json` (when using Node ≥ 18)

### Fixed
- Fixed mpv IPC client never resolving due to waiting for socket close
- Fixed lingering background network streams after stopping playback
- Fixed incorrect process exit handling that could leave stale state
- Fixed persistence file mismatch between load and save paths
- Fixed type-safety issues with station index and polling intervals

---

## [1.1.0] – 2026-01-28

### Added
- MPV IPC integration for runtime control
- Smooth volume changes without restarting the stream
- Fade-in / fade-out support for scheduled start and stop
- Configurable update interval for song metadata
- Manual scheduler stop latch to prevent auto-restart
- Web UI improvements and better state sync

### Changed
- Volume handling now uses MPV IPC instead of restart-based control
- Web UI enabled by default
- Persistence enabled by default
- Scheduler evaluation interval fixed at 30 seconds

### Fixed
- Race conditions when switching stations rapidly
- Inconsistent state after MagicMirror restart
- Token handling edge cases in REST API

---

## [1.0.0] – 2026-01-25

### Added
- Initial public release of **MMM-WebRadio**
- Web radio playback using `mpv`
- Configurable station list
- Station switching (next / previous / direct selection)
- Volume control
- Station logos (manual URL or automatic lookup)
- Display of current song title via ICY metadata
- Endless scrolling song title in MagicMirror UI
- Web UI for remote control
- REST API for external control
- Optional API token authentication
- Persistence of last station and volume across restarts
- Scheduler with configurable time windows
- Sleep timer
- Multilanguage support
- Fancy card-style Mirror UI
