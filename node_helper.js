const NodeHelper = require("node_helper");
const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");

// fetch() compatibility (Node < 18)
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}
const fetch = (...args) => fetchFn(...args);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeStation(st) {
  return {
    name: (st && st.name) ? st.name : "",
    url: (st && st.url) ? st.url : "",
    homepage: (st && st.homepage) ? st.homepage : "",
    logo: (st && st.logo) ? st.logo : ""
  };
}

async function tryRadioBrowserLogo(stationUrl) {
  try {
    const encoded = encodeURIComponent(stationUrl);
    const endpoint = `https://de1.api.radio-browser.info/json/stations/byurl/${encoded}`;
    const res = await fetch(endpoint);
    if (!res.ok) return "";
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const favicon = hit && hit.favicon ? hit.favicon : "";
    return (typeof favicon === "string" && favicon.length > 4) ? favicon : "";
  } catch (e) {
    return "";
  }
}

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.ipcPath = null;
  
    this.state = {
      playing: false,
      stationIndex: 0,
      volume: 60,
      title: "",
      logoUrl: "",
      sleepTimerEndsAt: null
    };

    this.playLock = Promise.resolve();
    this.playerProc = null;
    this.titleGen = 0;
    this.titleStopper = null;
    this.sleepTimer = null;

    this.app = null;
    this.server = null;

    this.manualStopLatch = false;
    this.lastInsideScheduleWindow = null;

    // Persistence
    this.persistTimer = null;
    this.persistPath = null;
    this.persisted = null;

    // timer
    this.scheduleTimer = null;

    console.log("[MMM-WebRadio] node_helper started");
  },

  getIpcPath() {
    // Unique per play() to avoid stale sockets
    return path.join("/tmp", `mmm-webradio-mpv-${process.pid}-${Date.now()}.sock`);
  },

  async waitForSocket(ipcPath, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 2000);
    while (Date.now() < deadline) {
      try {
        if (fs.existsSync(ipcPath)) return true;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  },

  sendMpvCommand(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.ipcPath) return reject(new Error("No IPC socket path"));
      const sock = this.ipcPath;
      const client = net.createConnection(sock);
      let buf = "";
      let finished = false;

      const done = (err, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { client.end(); } catch (_) {}
        try { client.destroy(); } catch (_) {}
        if (err) return reject(err);
        resolve(result);
      };

      client.on("connect", () => {
        try {
          client.write(JSON.stringify(cmd) + "\n");
        } catch (e) {
          done(e);
        }
      });

      client.on("data", (chunk) => {
        buf += chunk.toString("utf8");

        // mpv replies with JSON objects separated by '\n'
        const nl = buf.indexOf("\n");
        if (nl === -1) return;

        const line = buf.slice(0, nl).trim();
        if (!line) return;

        try {
          const obj = JSON.parse(line);
          done(null, obj);
        } catch (e) {
          done(e);
        }
      });

      client.on("error", (err) => done(err));

      // safety timeout
      const timer = setTimeout(() => {
        done(new Error("IPC timeout"));
      }, 1500);
    
    });
  },

  async mpvGetProperty(name) {
    // Example: { "command": ["get_property", "metadata"] }
    try {
      const res = await this.sendMpvCommand({ command: ["get_property", name] });
      if (res && res.error === "success") return res.data;
    } catch (_) {}
    return null;
  },

  async mpvSetProperty(name, value) {
    // Example: { "command": ["set_property", "volume", 50] }
    try {
      await this.sendMpvCommand({ command: ["set_property", name, value] });
    } catch (e) {
      // Ignore if mpv is starting/stopping
    }
  },

  async mpvQuit() {
    try {
      await this.sendMpvCommand({ command: ["quit"] });
    } catch (e) {
      // Ignore and fall back to SIGTERM in stop()
    }
  },

  queuePersist() {
    if (!this.config || !this.config.persist || !this.config.persist.enabled) return;

    // resolve file path from config if provided
    const fileName = (this.config.persist && this.config.persist.file) ? this.config.persist.file : "webradio-state.json";
    this.persistPath = path.join(__dirname, fileName);

    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        // Deep-clone schedule to avoid odd serialization edge cases
        const schedule = this.config && this.config.schedule
          ? JSON.parse(JSON.stringify(this.config.schedule))
          : undefined;

        const payload = {
          stationIndex: this.state.stationIndex,
          volume: this.state.volume,
          schedule: schedule
        };
        fs.writeFileSync(this.persistPath, JSON.stringify(payload, null, 2), "utf8");
        // console.log("[MMM-WebRadio] Persisted:", payload);
      } catch (e) {
        console.warn("[MMM-WebRadio] Persist write failed:", e.message);
      }
    }, 250);
  },

  loadPersistedFromConfig() {
    try {
      if (!this.config || !this.config.persist || !this.config.persist.enabled) {
        this.persisted = null;
        return;
      }

      const fileName = (this.config.persist && this.config.persist.file) ? this.config.persist.file : "webradio-state.json";
      this.persistPath = path.join(__dirname, fileName);

      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, "utf8");
        this.persisted = JSON.parse(raw);
        console.log("[MMM-WebRadio] Loaded persisted state:", this.persisted);
      } else {
        this.persisted = null;
      }
    } catch (e) {
      this.persisted = null;
      console.warn("[MMM-WebRadio] Failed to load persisted state:", e.message);
    }
  },

  applyPersistedIfEnabled() {
    if (!this.config || !this.config.persist || !this.config.persist.enabled) return;

    if (!this.config.resumeLast) return;
    if (!this.persisted) return;

    const stations = this.config.stations || [];
    if (stations.length) {
      const idx = clamp(parseInt(this.persisted.stationIndex, 10), 0, Math.max(0, stations.length - 1));
      if (Number.isFinite(idx)) this.state.stationIndex = idx;
    }

    const vol = clamp(parseInt(this.persisted.volume, 10), 0, 100);
    if (Number.isFinite(vol)) this.state.volume = vol;
  },

  applyPersistedScheduleIfEnabled() {
    if (!this.config || !this.config.persist || !this.config.persist.enabled) return;
    if (!this.persisted || !this.persisted.schedule) return;

    // If schedule exists in persisted state, override config.schedule
    this.config.schedule = Object.assign({}, this.config.schedule || {}, this.persisted.schedule);
  },

  startScheduler() {
    if (!this.config || !this.config.schedule || !this.config.schedule.enabled) {
      this.stopScheduler();
      return;
    }

    // run once immediately, then every 30s
    this.applyScheduleOnce(true);

    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => this.applyScheduleOnce(false), 30 * 1000);
  },

  stopScheduler() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
  },

  applyScheduleOnce(isBoot) {
    const sch = this.config && this.config.schedule ? this.config.schedule : null;
    if (!sch || !sch.enabled) return;

    const d = new Date();
    const day = d.getDay(); // 0=Sun..6=Sat
    const minNow = d.getHours() * 60 + d.getMinutes();

    const parseHHMM = (s) => {
      if (!s || typeof s !== "string") return null;
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return hh * 60 + mm;
    };

    const inWindow = (nowMins, startM, endM) => {
      if (startM == null || endM == null) return false;
      if (startM === endM) return true;
      if (startM < endM) return nowMins >= startM && nowMins < endM;
      return nowMins >= startM || nowMins < endM; // crosses midnight
    };

    // Optional hard sleepAt stop
    if (sch.sleepAt) {
      const sleepMin = parseHHMM(sch.sleepAt);
      if (sleepMin != null && minNow === sleepMin) {
        if (this.state.playing) this.fadeOutThenStop();
        return;
      }
    }

    const windows = Array.isArray(sch.windows) ? sch.windows : [];
    let inside = false;

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const days = Array.isArray(w.days) ? w.days : [];
      if (days.length && days.indexOf(day) === -1) continue;

      const startMin = parseHHMM(w.start);
      const endMin = parseHHMM(w.end);

      if (inWindow(minNow, startMin, endMin)) {
        inside = true;
        break;
      }
    }

    if (inside) {
      if (isBoot && sch.autoStartInsideWindow === false) return;
      if (!this.state.playing && !this.manualStopLatch) {
        this.play(this.state.stationIndex, { fadeIn: true }); // scheduler-only fade in
      }
    } else {
      if (sch.stopOutsideWindow && this.state.playing) this.fadeOutThenStop();
    }

    if (!inside) {
      this.manualStopLatch = false;
    }
  },

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  getFadeCfg() {
    const f = (this.config && this.config.fade) ? this.config.fade : {};
    return {
      enabled: f.enabled !== false,
      ms: clamp(parseInt(f.ms, 10) || 1200, 0, 10000),
      stepMs: clamp(parseInt(f.stepMs, 10) || 80, 20, 500),   // <-- comma added
      startVol: clamp(parseInt(f.startVol, 10) || 0, 0, 100)
    };
  },

  async fadeTo(fromVol, toVol) {
    const f = this.getFadeCfg();
    if (!f.enabled || f.ms <= 0) {
      // single step
      this.state.volume = clamp(toVol, 0, 100);
      this.queuePersist();
      this.pushState();
      await this.mpvSetProperty("volume", this.state.volume);
      return;
    }

    // If mpv isn't ready yet, don't "fake fade" in UI.
    if (!this.state.playing || !this.playerProc || !this.ipcPath) return;

    const steps = Math.max(1, Math.floor(f.ms / f.stepMs));
    const a = clamp(fromVol, 0, 100);
    const b = clamp(toVol, 0, 100);

    for (let i = 1; i <= steps; i++) {
      // Stop fade if playback ended
      if (!this.state.playing || !this.playerProc) break;

      const v = Math.round(a + (b - a) * (i / steps));
      this.state.volume = clamp(v, 0, 100);
      this.pushState();                 // update bar in UI
      await this.mpvSetProperty("volume", this.state.volume); // update audio instantly
      await this.sleep(f.stepMs);
    }

    // End exactly on target volume and persist once
    this.state.volume = clamp(b, 0, 100);
    this.queuePersist();
    this.pushState();
    await this.mpvSetProperty("volume", this.state.volume);
  },

  socketNotificationReceived(notification, payload) {
   if (notification === "MMM_WEBRADIO_INIT") {
      console.log("[MMM-WebRadio] INIT received");
      this.config = payload.config;

      // Load persisted state (uses config.persist.file if configured)
      this.loadPersistedFromConfig();

      // Start web server (optional)
      if (this.config.web && this.config.web.enabled) {
        this.startWebServer();
      }

      const stations = this.config.stations || [];
      const maxIdx = Math.max(0, stations.length - 1);

      // Defaults from config
      this.state.stationIndex = clamp(this.config.startStationIndex || 0, 0, maxIdx);
      this.state.volume = clamp((typeof this.config.volume === "number" ? this.config.volume : 60), 0, 100);

      // Apply persisted station/volume (override defaults)
      this.applyPersistedIfEnabled();
      this.applyPersistedScheduleIfEnabled();
      this.startScheduler(); // restart/ensure scheduler uses the merged schedule

      // Clamp again in case station list changed since last run
      this.state.stationIndex = clamp(this.state.stationIndex, 0, maxIdx);

      // Optional: autostart (now uses persisted stationIndex)
      if (this.config.autoStart && stations.length > 0) {
        this.play(this.state.stationIndex);
      }

      this.refreshLogo().then(() => this.pushState());
      this.pushState();
      return;
    }

    if (notification === "MMM_WEBRADIO_GET_STATE") {
      this.pushState();
    }
  },

  pushState() {
    this.sendSocketNotification("MMM_WEBRADIO_STATE", this.state);
  },

  startWebServer() {
    if (this.server) return;

    const port = (this.config.web && this.config.web.port) ? this.config.web.port : 8787;
    const token = (this.config.web && this.config.web.token) ? this.config.web.token : "";

    this.app = express();
    this.app.use(express.json());

    const auth = (req, res, next) => {
      if (!token) return next();
      const got = req.headers["x-mmm-webradio-token"] || req.query.token || "";
      if (got !== token) return res.status(401).json({ ok: false, error: "unauthorized" });
      next();
    };

    // Serve UI (protected if token is set)
    //this.app.use("/", auth, express.static(path.join(__dirname, "public")));

    // Serve UI (no auth; API remains protected)
    this.app.use("/", express.static(path.join(__dirname, "public")));

    this.app.get("/api/state", auth, (req, res) => {
      res.json({ ok: true, state: this.state });
    });

    this.app.get("/api/stations", auth, (req, res) => {
      const stations = (this.config.stations || []).map((s, i) => Object.assign({ index: i }, safeStation(s)));
      res.json({ ok: true, stations });
    });

    this.app.post("/api/play", auth, (req, res) => {
      const idx = (req.body && req.body.index !== undefined && req.body.index !== null)
        ? parseInt(req.body.index, 10)
        : this.state.stationIndex;
      this.manualStopLatch = false;         // user explicitly wants playback
      this.play(idx).then(() => res.json({ ok: true, state: this.state }));
    });


    this.app.post("/api/stop", auth, (req, res) => {
      this.manualStopLatch = true;          // prevent scheduler from restarting
      this.stop().then(() => res.json({ ok: true, state: this.state }));
    });


    this.app.post("/api/volume", auth, (req, res) => {
      const vol = clamp(parseInt(req.body && req.body.volume, 10), 0, 100);
      this.setVolume(vol).then(() => res.json({ ok: true, state: this.state }));
    });

    this.app.post("/api/next", auth, (req, res) => {
      this.manualStopLatch = false;
      this.play(this.state.stationIndex + 1).then(() => res.json({ ok: true, state: this.state }));
    });

    this.app.post("/api/prev", auth, (req, res) => {
      this.manualStopLatch = false;
      this.play(this.state.stationIndex - 1).then(() => res.json({ ok: true, state: this.state }));
    });

    this.app.post("/api/timer", auth, (req, res) => {
      const minutes = clamp(parseInt(req.body && req.body.minutes, 10), 0, 24 * 60);
      this.setSleepTimer(minutes);
      res.json({ ok: true, state: this.state });
    });

    this.server = this.app.listen(port, "0.0.0.0", () => {
      console.log(`[MMM-WebRadio] Web UI listening on port ${port}`);
    });

    this.server.on("error", (err) => {
      console.error("[MMM-WebRadio] Web UI server error:", err);
    });

    this.app.get("/api/schedule", auth, (req, res) => {
      res.json({ ok: true, schedule: (this.config && this.config.schedule) ? this.config.schedule : {} });
    });

    this.app.post("/api/schedule", auth, (req, res) => {
      const incoming = req.body && req.body.schedule ? req.body.schedule : null;
      if (!incoming || typeof incoming !== "object") {
        return res.status(400).json({ ok: false, error: "missing schedule" });
      }

      // Minimal validation (keep it permissive)
      const next = Object.assign({}, this.config.schedule || {}, incoming);

      // Ensure windows is an array if provided
      if (incoming.windows && !Array.isArray(incoming.windows)) {
        return res.status(400).json({ ok: false, error: "windows must be an array" });
      }

      this.config.schedule = next;

      // Restart scheduler with new rules
      this.startScheduler();

      // Persist schedule
      this.queuePersist();

      res.json({ ok: true, schedule: this.config.schedule });
    });

  },

  getStation(index) {
    const stations = (this.config && this.config.stations) ? this.config.stations : [];
    if (!stations.length) return null;
    const i = (index % stations.length + stations.length) % stations.length;
    return { station: stations[i], index: i };
  },

  async refreshLogo() {
    const stWrap = this.getStation(this.state.stationIndex);
    if (!stWrap) {
      this.state.logoUrl = "";
      return;
    }
    const st = stWrap.station;

    if (st.logo && String(st.logo).trim()) {
      this.state.logoUrl = String(st.logo).trim();
      return;
    }

    const rb = await tryRadioBrowserLogo(st.url);
    this.state.logoUrl = rb || "";

  },

 startTitlePolling(streamUrl) {
    this.stopTitlePolling();
    const myGen = this.titleGen;

    // clear title immediately (prevents stale display after station switch)
    this.state.title = "";
    this.pushState();

    let stopped = false;
    let loopTimer = null;
    let running = false;

    const runOnce = async () => {
      if (stopped) return;
      // ignore if a newer poller started
      if (myGen !== this.titleGen) return;
      if (running) return;
      running = true;

      try {
        // Prefer ICY title from mpv metadata (single stream: mpv only)
        const md = await this.mpvGetProperty("metadata");
        let t = "";

       if (md && typeof md === "object") {
          // mpv metadata keys vary by stream; check common ones
          t =
            (md["icy-title"] ?? md["ICY_TITLE"] ?? md["StreamTitle"] ?? md["streamtitle"] ?? md["title"] ?? "");
        }
       // Fallback: mpv's computed media-title (often includes ICY)
        if (!t) {
          const mt = await this.mpvGetProperty("media-title");
          t = mt || "";
        }

        t = String(t || "").trim();

        if (t && t !== this.state.title) {
          this.state.title = t;
          this.pushState();
        }
      } catch (_) {
        // ignore IPC errors
      } finally {
        running = false;

        if (!stopped && myGen === this.titleGen) {
          loopTimer = setTimeout(runOnce, 1500);
        }
      }
    };

    runOnce();

    this.titleStopper = () => {
      stopped = true;
      if (loopTimer) clearTimeout(loopTimer);
      loopTimer = null;
    };
  },

  async play(index, opts) {
    const self = this;

    this.playLock = this.playLock.then(async () => {
      const stWrap = self.getStation(index);
      if (!stWrap) return;

      // Stop previous stream fully
      self.stopTitlePolling();
      await self.stop();

      self.state.stationIndex = stWrap.index;
      self.queuePersist();
      self.state.playing = true;
      self.state.title = "";
      self.pushState();

      const url = stWrap.station.url;
      const cmd = (self.config && self.config.player) ? self.config.player : "/usr/bin/mpv";

      // set logo for this station
      self.state.logoUrl = (stWrap.station.logo && String(stWrap.station.logo).trim())
        ? String(stWrap.station.logo).trim()
        : "";

      // Create a fresh IPC socket path for this run
      self.ipcPath = self.getIpcPath();
      try { fs.unlinkSync(self.ipcPath); } catch (_) {}

      const args = [
        "--no-video",
        `--volume=${self.state.volume}`,
        `--input-ipc-server=${self.ipcPath}`,
        url
      ];

      self.playerProc = spawn(cmd, args, {
        stdio: ["ignore", "ignore", "ignore"]
      });

      const proc = self.playerProc;
      const targetVol = self.state.volume;
      const f = self.getFadeCfg();
      const doFadeIn = !!(opts && opts.fadeIn); // only scheduler will set this true

      self.waitForSocket(self.ipcPath, 2000).then(async (ok) => {
        if (!ok) return;

        if (doFadeIn && f.enabled && f.ms > 0) {
          await self.mpvSetProperty("volume", f.startVol);
          self.state.volume = f.startVol;
          self.pushState();

          await self.sleep(200);
          await self.fadeTo(f.startVol, targetVol);
        } else {
          // manual start & station switch = instant
          await self.mpvSetProperty("volume", targetVol);
        }
      });

      const onProcEnd = () => {
        // Ignore if a newer proc has been started since this handler was registered
        if (self.playerProc !== proc) return;

        self.playerProc = null;
        self.state.playing = false;

        // Best-effort cleanup
        self.stopTitlePolling();
        const oldSock = self.ipcPath;
        self.ipcPath = null;
        try { if (oldSock) fs.unlinkSync(oldSock); } catch (_) {}

        self.pushState();
      };
      proc.once("exit", onProcEnd);
      proc.once("close", onProcEnd);

      // Start metadata polling if you have it
      if (typeof self.startTitlePolling === "function") {
        self.startTitlePolling(url);
      }


    }).catch((e) => {
      console.error("[MMM-WebRadio] play() failed:", e);
    });

    return this.playLock;

  },
 
  async fadeOutThenStop() {
    const f = this.getFadeCfg();
    if (!this.state.playing) return;

    const startVol = this.state.volume;
    if (f.enabled && f.ms > 0 && this.playerProc && this.ipcPath) {
      await this.fadeTo(startVol, 0);
    }
    await this.stop(); // your existing stop (which calls mpvQuit + kills if needed)

    // restore remembered volume for next start
    this.state.volume = startVol;
    this.queuePersist();
    this.pushState();
  },

  async stop() {
    this.clearSleepTimer();

    if (this.titleStopper) {
      this.titleStopper();
      this.titleStopper = null;
    }
    this.stopTitlePolling();
    this.state.title = "";

    await this.mpvQuit();

    const proc = this.playerProc;
    this.playerProc = null;

    // Also clear state now (optional)
    this.state.playing = false;
    this.pushState();

    if (!proc) return Promise.resolve();

    return new Promise((resolve) => {
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;

        // cleanup ipc socket
        const oldSock = this.ipcPath;
        this.ipcPath = null;
        try { if (oldSock) fs.unlinkSync(oldSock); } catch (_) {}

        resolve();
      };

      // If it exits normally
      proc.once("exit", done);
      proc.once("close", done);

      // Ask nicely first
      try { proc.kill("SIGTERM"); } catch (_) {}

      // Then force kill if it refuses
      setTimeout(() => {
        if (finished) return;
        try { proc.kill("SIGKILL"); } catch (_) {}
        done();
      }, 1200);
    });
  },

  async setVolume(vol) {
    this.state.volume = clamp(vol, 0, 100);
    this.queuePersist();
    this.pushState();

    if (this.state.playing && this.playerProc && this.ipcPath) {
      // instant, no restart
      await this.mpvSetProperty("volume", this.state.volume);
    }
  },

  clearSleepTimer() {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    this.state.sleepTimerEndsAt = null;
  },

  setSleepTimer(minutes) {
    this.clearSleepTimer();
    if (!minutes || minutes <= 0) {
      this.pushState();
      return;
    }
    const ms = minutes * 60 * 1000;
    this.state.sleepTimerEndsAt = Date.now() + ms;

    this.sleepTimer = setTimeout(() => {
      this.stop();
    }, ms);

    this.pushState();
  },

  stopTitlePolling() {
  // invalidate any in-flight callbacks
    this.titleGen += 1;

    if (this.titleStopper) {
      try { this.titleStopper(); } catch (_) {}
    }
    this.titleStopper = null;
  }

});