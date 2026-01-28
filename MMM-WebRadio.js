/* global Module */

Module.register("MMM-WebRadio", {
  defaults: {
    stations: [],
    startStationIndex: 0,
    autoStart: false,
    showLogo: true,
    showTitle: true,
    updateIntervalMs: 2000,
    web: { enabled: true, port: 8787, token: "" },
    volume: 60,
    player: "/usr/bin/mpv",
    persist: {
      enabled: true,
      file: "webradio-state.json" 
    },
    resumeLast: true,
  },

  updateMarquee: function () {
    var root = document.getElementById("wr-" + this.identifier);
    if (!root) return;

    var wrap = root.querySelector(".wr-song");
    var track = root.querySelector(".wr-marquee");
    if (!wrap || !track) return;

    var overflow = track.scrollWidth > wrap.clientWidth;
    wrap.classList.toggle("scroll", overflow);
  },

  getStyles: function () {
    return ["webradio.css"];
  },

  start: function () {
    this.state = {
      playing: false,
      stationIndex: Number.isFinite(Number(this.config.startStationIndex))
        ? Number(this.config.startStationIndex)
        : 0,
      volume: (typeof this.config.volume === "number") ? this.config.volume : 60,
      title: "",
      logoUrl: "",
      sleepTimerEndsAt: null
    };

    this.sendSocketNotification("MMM_WEBRADIO_INIT", { config: this.config });

    var self = this;
    var interval = (typeof this.config.updateIntervalMs === "number" && this.config.updateIntervalMs >= 500)
      ? this.config.updateIntervalMs
      : 2000;
    setInterval(function () {
      self.sendSocketNotification("MMM_WEBRADIO_GET_STATE", {});
    }, interval);
  },

  getTranslations: function () {
    return {
      en: "translations/en.json",
      de: "translations/de.json",
      fr: "translations/fr.json",
      it: "translations/it.json"
    };
  },

   socketNotificationReceived: function (notification, payload) {
    if (notification !== "MMM_WEBRADIO_STATE") return;

    var prev = this.state || {};
    var next = payload || {};

    // Merge state first
    this.state = Object.assign({}, prev, next);

    // Only redraw when it would otherwise reset marquee / layout
    var shouldRedraw =
      next.playing !== prev.playing ||
      next.stationIndex !== prev.stationIndex ||
      next.title !== prev.title ||
      next.logoUrl !== prev.logoUrl ||
      next.sleepTimerEndsAt !== prev.sleepTimerEndsAt;

    if (shouldRedraw) {
      this.updateDom();
      // After DOM updates, decide if marquee should scroll
      var self = this;
      requestAnimationFrame(function () { self.updateMarquee(); });
      return;
    }

    // Volume-only update: update bar/label in place (no updateDom)
    if (next.volume !== prev.volume) {
      var root = document.getElementById("wr-" + this.identifier);
      if (!root) return;

      var fill = root.querySelector(".wr-vol-fill");
      if (fill) fill.style.width = String(Math.max(0, Math.min(100, this.state.volume))) + "%";

      var label = root.querySelector(".wr-vol-label");
      if (label) label.innerText = this.translate("VOLUME") + " " + this.state.volume + "%";
    }
  },

  getDom: function () {
    var wrapper = document.createElement("div");
    wrapper.className = "wr-card";
    wrapper.id = "wr-" + this.identifier;

    var stations = this.config.stations || [];
    var station = stations[this.state.stationIndex];

    // Header row: logo + station
    var header = document.createElement("div");
    header.className = "wr-header";

    var logo = null;

    if (this.config.showLogo) {
      logo = document.createElement("div");
      logo.className = "wr-logo";

      if (this.state.logoUrl) {
        var img = document.createElement("img");
        img.src =
          this.state.logoUrl +
          (this.state.logoUrl.indexOf("?") === -1 ? "?" : "&") +
          "s=" + this.state.stationIndex;
        img.alt = (station && station.name) ? station.name : "logo";
        logo.appendChild(img);
      }
    }

    var meta = document.createElement("div");
    meta.className = "wr-meta";

    var title = document.createElement("div");
    title.className = "wr-station";
    title.innerText = station ? station.name : this.translate("NO_STATIONS");

    var status = document.createElement("div");
    status.className = "wr-status " + (this.state.playing ? "is-playing" : "is-stopped");
    status.innerText = this.state.playing ? this.translate("PLAYING") : this.translate("STOPPED");

    meta.appendChild(title);
    meta.appendChild(status);

    if (logo) header.appendChild(logo);
    header.appendChild(meta);

    // Compact view when stopped
    if (!this.state.playing) {
      wrapper.classList.add("wr-idle");
      wrapper.appendChild(header);
      return wrapper;
    }

    // Now Playing block
    var now = document.createElement("div");
    now.className = "wr-now";

    var label = document.createElement("div");
    label.className = "wr-label";
    label.innerText = this.translate("NOW_PLAYING");

    var songWrap = document.createElement("div");
    songWrap.className = "wr-song";

    // Marquee track (endless, no jump) – only when overflow
    var track = document.createElement("div");
    track.className = "wr-marquee";

    var text = this.state.title ? this.state.title : this.translate("NO_METADATA");

    var a = document.createElement("div");
    a.className = "wr-marquee-item";
    a.innerText = text;

    var b = document.createElement("div");
    b.className = "wr-marquee-item";
    b.innerText = text;

    track.appendChild(a);
    track.appendChild(b);
    songWrap.appendChild(track);

    now.appendChild(label);
    now.appendChild(songWrap);

    // Bottom row: volume + timer chip
    var bottom = document.createElement("div");
    bottom.className = "wr-bottom";

    var vol = document.createElement("div");
    vol.className = "wr-volume";

    var volLabel = document.createElement("div");
    volLabel.className = "wr-vol-label";
    volLabel.innerText = this.translate("VOLUME") + " " + this.state.volume + "%";

    var bar = document.createElement("div");
    bar.className = "wr-vol-bar";

    var fill = document.createElement("div");
    fill.className = "wr-vol-fill";
    fill.style.width = String(Math.max(0, Math.min(100, this.state.volume))) + "%";

    bar.appendChild(fill);
    vol.appendChild(volLabel);
    vol.appendChild(bar);

    bottom.appendChild(vol);

    if (this.state.sleepTimerEndsAt) {
      var chip = document.createElement("div");
      chip.className = "wr-chip";

      var remainingMs = Math.max(0, this.state.sleepTimerEndsAt - Date.now());
      var mins = Math.ceil(remainingMs / 60000);

      chip.innerText = this.translate("TIMER") + ": " + mins + " " + this.translate("MINUTES");
      bottom.appendChild(chip);
    }

    // Assemble card
    wrapper.appendChild(header);
    wrapper.appendChild(now);
    wrapper.appendChild(bottom);

    return wrapper;
  },

});