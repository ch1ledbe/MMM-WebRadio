# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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
