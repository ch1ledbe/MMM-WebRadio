# MMM-WebRadio
A MagicMirror² module that plays web radio streams using mpv and provides a web-based control interface.
It supports station switching, volume control, scheduling, sleep timers, persistence across restarts, and displays the current song title when available.

## Features
- Play web radio streams via `mpv`
- Fancy card-style Mirror UI
- Station switching (next / previous / direct selection)
- Volume control **without restarting playback** (mpv IPC)
- Station logos:
  - manual URL / local path, or
  - automatic lookup via the Radio-Browser directory (best-effort)
- Current song title via ICY metadata (endless scrolling in the UI)
- Web UI for remote control (phone / tablet / PC)
- REST API for external control
- Optional API token authentication
- Persistence: last station + volume (and scheduler config if changed via API)
- Scheduler with configurable time windows (supports overnight windows)
- Sleep timer (stop after N minutes)
- Multilanguage support (EN/DE/FR/IT)

## Screenshots
### Mirror UI

### Web UI

### Scheduler Configuration

## Requirements
- MagicMirror²
- Node.js: recommended >= 18 (works with older versions if `node-fetch` is installed)
- `mpv` installed:
```bash
  sudo apt-get update
  sudo apt-get install -y mpv
```

## Installation
```bash
cd ~/MagicMirror/modules
git clone https://github.com/ch1ledbe/MMM-WebRadio
cd MMM-WebRadio
npm install
```

## Configuration example
Add to config/config.js:
```js
{
  module: "MMM-WebRadio",
  position: "top_left",
  config: {
    // Optional: mpv binary (default: /usr/bin/mpv)
    player: "/usr/bin/mpv",

    // Optional: initial volume (0–100)
    volume: 60,

    // Optional: initial station index
    startStationIndex: 0,

    // Optional: start playback on MagicMirror boot
    autoStart: false,

    // Station list
    stations: [
      {
        name: "SRF 3",
        url: "https://stream.srg-ssr.ch/m/drs3/aacp_96",
        // Can be a URL or local path served by MagicMirror:
        logo: "/modules/MMM-WebRadio/public/logos/srf3.png",
        // Optional:
        homepage: "https://www.srf.ch"
      }
    ],

    // Optional: Web UI + REST API
    web: {
      enabled: true,
      port: 8787,
      token: "" // set a token to protect the API
    },

    // Optional: persistence across restarts
    persist: {
      enabled: true,
      file: "webradio-state.json"
    },
    resumeLast: true,

    // Optional: scheduler (time windows)
    schedule: {
      enabled: true,
      windows: [
        { days: [1,2,3,4,5], start: "07:00", end: "22:00" }, // Mon–Fri
        { days: [0,6],       start: "09:00", end: "23:30" }  // Sat/Sun
      ],
      autoStartInsideWindow: true,
      stopOutsideWindow: true,
      sleepAt: "" // optional fixed daily stop time ("HH:MM")
    },

    // Optional: fade in/out (used by scheduler stop/start)
    fade: {
      enabled: true,
      ms: 1200,
      stepMs: 80,
      startVol: 0
    }
  }
}
```
## Configuration options

### Global options

| Option              | Type / Values         | Default             | Description |
|--------------------|-----------------------|---------------------|-------------|
| `player`            | string (path)          | `/usr/bin/mpv`      | Path to `mpv` binary. |
| `volume`            | number `0–100`         | `60`                | Initial volume. |
| `startStationIndex` | number                 | `0`                 | Station index on startup. |
| `autoStart`         | boolean                | `false`             | Auto-start playback on boot. |
| `showLogo`          | boolean                | `true`              | Show station logo on the Mirror UI. |
| `showTitle`         | boolean                | `true`              | Show current song title (if available). |
| `updateIntervalMs`  | number (ms)            | `2000`              | How often the module requests state updates from `node_helper`. |
| `resumeLast`        | boolean                | `true`              | If persistence is enabled, resume last station & volume. |

### Stations

| Option                | Type | Default | Description |
|---------------------|------|---------|-------------|
| `stations`            | array | `[]` | List of stations. |
| `stations[].name`     | string | — | Station name. |
| `stations[].url`      | string | — | Stream URL. |
| `stations[].logo`     | string | `""` | Logo URL or local path. If empty, the module attempts an automatic lookup via Radio-Browser. |
| `stations[].homepage` | string | `""` | Optional homepage URL (currently informational). |

### Web UI & REST API

| Option        | Type / Values | Default | Description |
|-------------|---------------|---------|-------------|
| `web.enabled` | boolean | `true` | Enable Web UI & REST API. Set to `false` to run “Mirror-only”. |
| `web.port`    | number  | `8787` | Port for Web UI & API. |
| `web.token`   | string  | `""`   | Optional API access token. |

Open the Web UI:

```text
http://<MAGICMIRROR-IP>:8787/
```

If a token is set, you can pass it to the Web UI via query parameter:

```text
http://<MAGICMIRROR-IP>:8787/?token=YOUR_TOKEN
```

### Persistence

| Option              | Type / Values | Default | Description |
|-------------------|---------------|---------|-------------|
| `persist.enabled`  | boolean | `true` | Enable persistence. |
| `persist.file`     | string  | `webradio-state.json` | File name (stored in the module directory). |

When enabled, the module stores:
- `stationIndex`
- `volume`
- `schedule` (only if you update it through the API)

### Scheduler

The scheduler controls when playback is allowed.

| Option                           | Type / Values  | Default | Description |
|----------------------------------|----------------|---------|-------------|
| `schedule.enabled`               | boolean        | `false` | Enable scheduler. |
| `schedule.windows`               | array          | `[]`    | Allowed playback windows. |
| `schedule.windows[].days`        | array of `0–6` | —       | Days (0=Sun … 6=Sat). Empty means “every day”. |
| `schedule.windows[].start`       | `"HH:MM"`      | —       | Window start time. |
| `schedule.windows[].end`         | `"HH:MM"`      | —       | Window end time. Supports overnight windows (e.g. 22:00 → 06:00). |
| `schedule.autoStartInsideWindow` | boolean        | `true`  | If `true`, the scheduler can start playback when entering a window. Set to `false` if you only want “auto-stop”. |
| `schedule.stopOutsideWindow`     | boolean        | `false` | Stop playback when outside all windows. |
| `schedule.sleepAt`               | `"HH:MM"`      | `""`    | Optional fixed daily stop time. |

Notes:
- The scheduler checks every ~30 seconds.
- If you press **Stop** in the Web UI, the scheduler will not immediately restart playback until you leave the window and re-enter it (or you press Play).

### Fade (scheduler start/stop)

Fade is used when the scheduler starts playback (fade in) and when it stops playback (fade out).

| Option          | Type / Values | Default | Description |
|----------------|---------------|---------|-------------|
| `fade.enabled` | boolean | `true`  | Enable fade. |
| `fade.ms`      | number  | `1200`  | Total fade duration in milliseconds. |
| `fade.stepMs`  | number  | `80`    | Step interval in milliseconds (smaller = smoother). |
| `fade.startVol`| number `0–100`| `0`    | Starting volume for fade-in. |

## API authentication

If `web.token` is set, all API requests require either:
- Header `X-MMM-WebRadio-Token: YOUR_TOKEN`, or
- Query parameter `?token=YOUR_TOKEN`

## API endpoints

| Method | Endpoint        | Description |
|-------:|-----------------|-------------|
| GET    | `/api/state`    | Get current player state |
| GET    | `/api/stations` | List configured stations |
| POST   | `/api/play`     | Play station `{ index }` (optional, defaults to current) |
| POST   | `/api/stop`     | Stop playback |
| POST   | `/api/next`     | Next station |
| POST   | `/api/prev`     | Previous station |
| POST   | `/api/volume`   | Set volume `{ volume }` (0–100) |
| POST   | `/api/timer`    | Set sleep timer `{ minutes }` (0–1440) |
| GET    | `/api/schedule` | Get scheduler config |
| POST   | `/api/schedule` | Update scheduler `{ schedule: { ... } }` |

## Troubleshooting

```bash
# test a stream directly
mpv --no-video <STREAM_URL>

# check mpv is running
pgrep -a mpv || echo "NO MPV PROCESS"

# check the Web UI port (default 8787)
ss -ltnp | grep 8787

# MagicMirror logs (pm2 default)
pm2 logs --lines 200
```

## Known limitations

- Not all streams provide ICY metadata (song titles may stay empty).
- Some AAC streams update titles slowly.

## License

MIT