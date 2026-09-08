import { ASSETS, LOCATIONS, FX, SMILE_COLS } from "./config.js";
import { loadImage, loadSmiles, loadFxImage, playSound, pickSound } from "./assets.js";
import { renderBBCode, parseBBCode } from "./bbcode.js";
import { Chat } from "./chat.js";
import { RoomRenderer } from "./render.js";
import { Net } from "./net.js";
import { UI } from "./ui.js";

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    window.__errors = [];
    window.addEventListener("error", (e) => window.__errors.push(e.message || "err"));
    window.addEventListener("unhandledrejection", (e) =>
      window.__errors.push("rej:" + ((e.reason && (e.reason.message || e.reason)) || e.reason)));
    this.screen = "splash";
    this.user = null;
    this.roomId = null;
    this.smiles = [];
    this.net = new Net((ev) => this.onNet(ev));
    this.chat = null;
    this.renderer = null;
    this.fxInstance = null;
    this.bots = [];
    this.me = null;
    this.raf = 0;
    this.last = performance.now();
    this.clock = 0;
    this.privateLog = [];
    this.curFx = FX[0];

    this.ui = new UI({
      lobbyAvatar: $("#lobby-avatar"), lobbyNick: $("#lobby-nick"), lobbyLoc: $("#lobby-loc"),
      lobbyList: $("#lobby-list"), smilePopup: $("#smile-popup"), overlayMenu: $("#overlay-menu"),
      overlayPrivate: $("#overlay-private"), overlayContext: $("#overlay-context"), ctxPopup: $("#ctx-popup"),
      menuBody: $("#menu-body"), privateTitle: $("#private-title"), privateUsers: $("#private-users"),
      privateLog: $("#private-log"), privateInput: $("#private-input"),
    }, {
      showSettings: () => this.showSettings(),
      close: (n) => this.closeOverlay(n),
      smilePicked: (i) => this.onSmilePicked(i),
      fxPicked: (fx) => { this.curFx = fx; this.toast(`Подарок: ${fx.name}. Тапни по персонажу!`); },
      menu: (op) => this.onMenuOp(op),
      sendPrivate: (target, text) => this.onSendPrivate(target, text),
      renderText: (t) => this.chat && this.chat.renderText(t),
      roomUsers: () => this.roomUsers(),
    });

    this.bindRoom();
    this.boot();
  }

  async boot() {
    this.setScreen("splash");
    this.updateSplash("[b]Connecting...[/b]", 0.15);
    try {
      await Promise.all([
        this.loadCore(),
        this.loadSplashBg(),
      ]);
      this.smiles = await loadSmiles();
      this.ui.smiles = this.smiles;
      this.ui.setSmiles && this.ui.setSmiles(this.smiles);
      this.chat && this.chat.setSmiles(this.smiles);
      this.updateSplash("[b]Bubuta[/b] · [small]the most cheerful chat[/small]", 1);
    } catch (e) {
      console.error(e);
      this.updateSplash("[color=#880000][b]Ошибка загрузки[/b][/color]", 0);
    }
    setTimeout(() => this.setScreen("login"), 800);

    if (location.hash === "#smoke") {
      setTimeout(async () => {
        try {
          await this.onLogin(true);
          await this.enterRoom(LOCATIONS[0]);
          document.title = `Bubuta smoke:e${window.__errors.length || 0}:ready`;
        } catch (err) {
          window.__errors.push("smoke:" + err.message);
          document.title = `Bubuta smoke:e${window.__errors.length || 0}:fail`;
        }
      }, 500);
    }
  }

  async loadCore() {
    await playSound("sound/click1.mp3").catch(() => {});
  }

  async loadSplashBg() {
    this.splashCanvas = $("#splash-bg");
    this.splashCtx = this.splashCanvas.getContext("2d");
    this.splashTiles = [];
    for (const n of ["tile_splash_bg", "tile_splash_bg_night", "tile_splash_bg_shade"]) {
      const img = await loadImage(`graphics/${n}.png`);
      this.splashTiles.push(img);
    }
    $("#splash-logo").src = ASSETS + "graphics/title_logo.png";
    $("#splash-spinner").src = ASSETS + "graphics/load_spinner.png";
    this.splashRaf();
    this.resizeSplash();
    window.addEventListener("resize", () => this.resizeSplash());
  }

  resizeSplash() {
    const cv = this.splashCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    this.splashCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  splashRaf() {
    const tick = () => {
      if (this.screen !== "splash") return;
      const { ctx } = this.splashCtx;
      const W = window.innerWidth, H = window.innerHeight;
      const t = this.splashTiles[0];
      if (t) {
        const tw = W / 8;
        for (let y = 0; y < H; y += tw) {
          for (let x = 0; x < W; x += tw) {
            ctx.drawImage(t, 0, 0, t.width, t.height, x, y, tw + 1, tw + 1);
          }
        }
        // soft rays
        ctx.fillStyle = "rgba(255,255,255,.06)";
        const cx = W * 0.2, cy = H * 0.28;
        for (let i = 0; i < 6; i++) {
          const a = (performance.now() / 1200) + i * 1.1;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          ctx.fillRect(-W * 0.7, -2, W * 1.4, 3);
          ctx.restore();
        }
      }
      setTimeout(tick, 50);
    };
    tick();
  }

  updateSplash(text, prog) {
    $("#splash-status").innerHTML = ""; // renderBBCode
    const el = $("#splash-status");
    el.appendChild(this.renderBBCodeSafe(text));
  }

  renderBBCodeSafe(src) {
    if (this.smiles.length) return renderBBCode(src, (i) => this.smiles[i] || null, null, this.smiles.length);
    const span = document.createElement("span");
    span.textContent = src.replace(/\[\/?(b|i|u|s|small|xsmall|color|bgcolor)[^\]]*\]/gi, "");
    return span;
  }

  setScreen(name) {
    this.screen = name;
    ["splash", "login", "lobby", "room"].forEach((s) => {
      $("#screen-" + s).classList.toggle("active", s === name);
    });
    if (name === "room") {
      this.resizeCanvas();
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
    } else if (name !== "room") {
      cancelAnimationFrame(this.raf); this.raf = 0;
    }
    if (name === "lobby") this.renderLobby();
  }

  // ---------------- lobby ----------------
  renderLobby() {
    this.ui.setUser(this.me);
    this.ui.renderLobby(LOCATIONS, () => Math.floor(50 + Math.random() * 400), (loc) => this.enterRoom(loc));
  }

  // ---------------- login ----------------
  bindRoom() {
    $("#login-btn").addEventListener("click", () => this.onLogin(false));
    $("#login-guest").addEventListener("click", () => this.onLogin(true));
    $("#login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") this.onLogin(false); });
    $("#login-nick").addEventListener("keydown", (e) => { if (e.key === "Enter") this.onLogin(false); });

    $("#room-back").addEventListener("click", () => this.leaveRoom());
    $("#room-send").addEventListener("click", () => this.sendChat());
    $("#room-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendChat();
      if (e.key === "Tab") { e.preventDefault(); const t = $("#room-input").value; if (t.length) this.completeNick(t); }
    });
    document.querySelectorAll(".tb-btn[data-action]").forEach((b) =>
      b.addEventListener("click", () => this.onTool(b.dataset.action)));

    $("#room-canvas").addEventListener("click", (e) => this.onCanvasClick(e));
    $("#room-canvas").addEventListener("contextmenu", (e) => e.preventDefault());
  }

  async onLogin(guest) {
    const nick = ($("#login-nick").value.trim() || "") || (guest ? "Гость_" + Math.floor(1000 + Math.random() * 9000) : "");
    $("#login-error").textContent = "";
    if (!nick) { $("#login-error").textContent = "Введи ник"; return; }
    $("#login-btn").disabled = true;
    await this.net.connect(nick, guest);
    this.me = this.net.user;
    $("#login-btn").disabled = false;
    this.setScreen("lobby");
  }

  // ---------------- room ----------------
  async enterRoom(loc) {
    this.roomId = loc.id;
    this.chat = null;
    if (!this.renderer) this.renderer = new RoomRenderer($("#room-canvas"));
    $("#room-title").textContent = loc.name;
    await this.renderer.loadLocality(loc.id);
    await Promise.all(FX.map(async (f) => {
      await this.renderer.loadFx(f.id, f);
      if (f.overlay) await this.loadOverlay(f.overlay);
    }));
    this.chat = new Chat($("#chat-log"), {
      onNickTap: (e) => this.toast(e.nick || ""),
      onRemove: (e) => { e && this.chat.add({ type: "sys", text: "(удалено)" }); },
    });
    this.chat.setSmiles(this.smiles);
    this.chat.add({ type: "sys", text: `Открыт канал: [b]${loc.name}[/b]` });
    this.net.spawnBots(loc.id);
    this.setScreen("room");
    this.toast("Кликни по панораме, чтобы ходить. Тапни по персонажу — действия!");
    this.net.say(this.me, "[small]Все привет![/small]", false);
  }

  async loadOverlay(id) {
    if (!this.renderer.fxSheets.has("overlay:" + id)) {
      try {
        const img = await loadFxImage(id);
        const cells = [];
        const rows = [1, 2, 3, 4];
        for (const r of rows) {
          const cv = document.createElement("canvas");
          const ch = Math.floor(img.height / r);
          const cw = img.width;
          for (let i = 0; i < r; i++) {
            const c2 = document.createElement("canvas");
            c2.width = cw; c2.height = ch;
            const g = c2.getContext("2d");
            g.drawImage(img, 0, i * ch, cw, ch, 0, 0, cw, ch);
            cells.push(c2);
          }
        }
        this.renderer.fxSheets.set("overlay:" + id, { cells });
      } catch (e) { console.warn("overlay", id, e); }
    }
  }

  onNet(ev) {
    if (!ev) return;
    switch (ev.type) {
      case "message": {
        const m = ev.msg;
        if (this.chat) {
          this.chat.add({
            type: m.priv ? "sys" : "msg",
            nick: m.user.nick, text: m.text, color: m.user.color,
            me: m.user && m.user.id === this.me.id,
          });
        }
        if (m.priv) {
          if (m.user && m.user.id !== this.me.id) this.ui.addPrivate(m);
        } else if (m.user && m.user.id !== this.me.id) {
          this.soundMsg();
        }
        break;
      }
      case "session": {
        this.me = ev.user;
        break;
      }
      case "user_enter": {
        const u = ev.user;
        if (!this.renderer) break;
        if (u.id === this.me.id) this.me = u;
        this.renderer.upsert(u);
        if (this.chat) this.chat.add(ev.me
          ? { type: "sys", text: `Ты вошёл в [b]${this.roomLabel()}[/b]` }
          : { type: "sys", text: "Вошёл: [b]" + u.nick + "[/b]" });
        this.syncAvatar(u);
        break;
      }
      case "move": {
        this.renderer.upsert(ev.user);
        this.syncAvatar(ev.user);
        break;
      }
      case "smile": {
        if (this.chat) {
          this.chat.add({
            type: "msg", nick: ev.user.nick, color: ev.user.color, me: ev.user.id === this.me.id,
            text: ev.user.nick + " показал смайл ::S" + ev.smile + "::" + "" ,
          });
        }
        this.soundPoke();
        break;
      }
      case "effect": {
        const u = ev.user;
        const x = u.x; const y = 190;
        this.renderer.spawnFx(ev.fx.id, x, y, u, ev.fx.overlay);
        this.soundFx();
        break;
      }
    }
  }

  soundMsg() { this.autoSound(["sound/message_1.mp3", "sound/receive_1.mp3"]); }
  soundPoke() { this.autoSound(["sound/click2.mp3"]); }
  soundFx() { this.autoSound(["sound/eff1.mp3", "sound/eff3.mp3", "sound/eff6.mp3"]); }
  soundSend() { this.autoSound(["sound/send_1.mp3", "sound/send_2.mp3"]); }

  autoSound(arr) { playSound(arr[Math.floor(Math.random() * arr.length)]).catch(() => {}); }

  roomLabel() { return (LOCATIONS.find((l) => l.id === this.roomId) || {}).name || this.roomId; }

  syncAvatar(u) {
    const inR = u.id === this.me.id || (this.bots && this.bots.some((b) => b.id === u.id));
    if (u.smileImg) return;
    const im = this.smiles[u.smile % this.smiles.length];
    if (im) { u.smileImg = im; if (this.renderer) this.renderer.upsert(u); }
  }

  loop = (now) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.net.tick(dt);
    if (this.renderer) {
      this.renderer.frame(dt);
      this.renderer.setNight(this.net.isNight());
      this.renderer.draw();
    }
    // bot avatar lazy-sync
    for (const b of this.bots) this.syncAvatar(b);
    this.raf = requestAnimationFrame(this.loop);
  };

  onTool(action) {
    switch (action) {
      case "smiles": this.ui.openSmiles(); this.soundSend(); break;
      case "gifts": this.ui.openGifts(); break;
      case "private": this.ui.privateLog = this.privateLog; this.ui.showPrivate(this.roomUsers(), "Приватный чат"); break;
      case "menu": this.ui.showMenu(this.me); break;
    }
  }

  sendChat() {
    const inp = $("#room-input");
    const text = inp.value.trim();
    if (!text) return;
    if (text.length > 400) { this.toast("Слишком длинное сообщение"); return; }
    inp.value = "";
    this.net.say(this.me, text);
    this.soundSend();
  }

  onSmilePicked(i) {
    const inp = $("#room-input");
    const mark = "::S" + i + "::";
    ninja(inp, mark);
    inp.focus();
  }

  completeNick(prefix) {
    const candidates = this.roomUsers().filter((u) => u.nick && u.nick.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!candidates.length) return;
    $("#room-input").value = candidates[0].nick + ": ";
  }

  roomUsers() {
    if (!this.net || !this.net.botsByLoc) return [];
    return this.net.usersInRoom().filter((u) => u.id !== this.me.id);
  }

  onCanvasClick(e) {
    const r = $("#room-canvas").getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = this.renderer && this.renderer.hitTest(x, y);
    if (hit) {
      this.ui.showContext(e.clientX, e.clientY, hit, this.playerActions(hit));
      return;
    }
    const wx = this.renderer.screenXToWorld(x);
    this.net.walkUser(this.me, wx, 0);
    this.soundSend();
  }

  playerActions(u) {
    return [
      { icon: "👤", label: "Профиль", cb: () => this.showProfile(u) },
      { icon: "💌", label: "Приватный чат", cb: () => this.ui.privateTarget = u, },
      { icon: "🎁", label: ("Подарить: ") + this.curFx.name, cb: () => this.net.effect(u, this.curFx) },
      { icon: "📣", label: "Позвать сюда", cb: () => this.net.say(this.me, "[imgembedded]🙋[/imgembedded] " + u.nick + ", иди к нам!", false) },
    ];
  }

  showProfile(u) {
    this.ui.hideContext();
    this.ui.showMenu(null);
    // reuse menu panel as simple profile
    const body = document.querySelector("#menu-body");
    body.textContent = "";
    const row2 = document.createElement("div");
    row2.style.display = "flex";
    row2.style.gap = "12px";
    row2.style.alignItems = "center";
    row2.style.padding = "8px 0";
    const im = new Image();
    im.style.cssText = "width:72px;height:72px;border-radius:16px;background:#eaf6ff;border:2px solid #2edcff;";
    im.src = u.smileImg && u.smileImg.src || this.ui.smile(u.smile);
    const info = document.createElement("div");
    info.style.fontSize = "13px";
    info.innerHTML = `<div style="font-weight:800;font-size:16px;color:${u.color}">${u.nick}</div>
      <div>Смайлик: #${u.smile}</div><div>(пузыри с сетью не восстанавливаются)</div>`;
    row2.append(im, info);
    body.appendChild(row2);
  }

  onSendPrivate(target, text) {
    const m = { user: this.me, text, priv: true, me: true };
    this.privateLog.push(m);
    this.ui.addPrivate(m);
    const replyDelay = 900 + Math.random() * 1500;
    setTimeout(() => {
      const r = this.net._botReply(target);
      const m2 = { user: target, text: r, priv: true, me: false };
      this.privateLog.push(m2);
      this.ui.addPrivate(m2);
    }, replyDelay);
  }

  showSettings() {
    this.ui.hideMenu();
    this.ui.showMenu(this.me);
    const body = document.querySelector("#menu-body");
    body.textContent = "";
    const rows = [
      { l: "Звук", sw: true, on: true, act: () => {} },
      { l: "Показывать входящих", sw: true, on: true, act: () => {} },
      { l: "Сжимать сообщения", sw: true, on: false, act: () => {} },
    ];
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("label");
      lab.textContent = r.l;
      const sw = document.createElement("button");
      sw.className = "switch" + (r.on ? " on" : "");
      sw.addEventListener("click", () => sw.classList.toggle("on"));
      row.append(lab, sw);
      body.appendChild(row);
    }
  }

  onMenuOp(op) {
    this.ui.hideMenu();
    switch (op) {
      case "profile": this.showProfile(this.me); break;
      case "settings": this.showSettings(); break;
      case "private": this.ui.showPrivate(this.roomUsers(), "Приватный чат"); break;
      case "gifts": this.ui.openGifts(); break;
      case "leave": this.leaveRoom(); break;
    }
  }

  closeOverlay(n) {
    if (n === 1) this.ui.hideMenu();
    if (n === 2) this.ui.hidePrivate();
    if (n === undefined) { this.ui.hideMenu(); this.ui.hidePrivate(); }
  }

  leaveRoom() {
    this.ui.hideMenu();
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.renderer = null;
    this.chat = null;
    $("#chat-log").textContent = "";
    this.net.bots.clear();
    this.net.botsByLoc.set(this.roomId, []);
    this.setScreen("lobby");
  }

  toast(text) {
    const t = $("#toast");
    t.textContent = ""; t.appendChild(renderBBCode(text, (i) => this.smiles[i] || null, null, this.smiles.length));
    t.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  resizeCanvas() {
    if (!this.renderer) return;
    this.renderer.resize();
  }
}

function ninja(inp, text) {
  const s = inp.selectionStart || inp.value.length;
  const e = inp.selectionEnd || inp.value.length;
  inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
  const np = s + text.length;
  try { inp.setSelectionRange(np, np); } catch (err) {}
}

window.addEventListener("resize", () => {
  if (app && app.renderer) app.renderer.resize();
});

const app = new App();
window.app = app;