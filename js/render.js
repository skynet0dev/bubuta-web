import { locLayers, loadImage, loadFxImage, tileW, panoramaUrl } from "./assets.js";
import { LOC_W, LOC_H } from "./config.js";

export class RoomRenderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.images = { layers: [], groups: [] };
    this.fxSheets = new Map();
    this.fx = [];
    this.players = new Map();
    this.meId = null;
    this.pan = 0;
    this.viewH = 0;
    this.viewW = 0;
  }

  async loadLocality(locId) {
    const defs = { loc01: 1, loc58: 1, loc59: 4 };
    const n = defs[locId] || 1;
    this.images.layers = [];
    for (let i = 0; i <= n; i++) {
      const img = await loadImage(`data/${locId}/${i === 0 ? "background" : "group" + i}.webp`);
      this.images.layers.push(img);
    }
    this.images.groups = this.images.layers.slice(1);
  }

  async loadFx(id, def) {
    if (this.fxSheets.has(id)) return;
    const img = await loadFxImage(id);
    this.fxSheets.set(id, { img, frame: def.frame, col: def.col });
  }

  setPlayers(list, meId) {
    this.players = new Map();
    this.meId = meId;
    for (const p of list) this.players.set(p.id, p);
  }

  upsert(p) { this.players.set(p.id, p); }
  remove(id) { this.players.delete(id); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = w * dpr;
    this.cv.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w; this.viewH = h;
    this.panoH = Math.min(Math.round(h * 0.52), 300);
  }

  setNight(night) { this.night = night; }

  frame(dt) {
    this.dt = dt;
  }

  spawnFx(id, x, y, user, overlay) {
    const s = this.fxSheets.get(id);
    if (!s) return;
    this.fx.push({
      id, x, y, user, slice: s,
      t: 0, dur: Math.max(0.5, (s.col / s.img.height) * 1.4),
      overlay: overlay ? { id: overlay, t: 0, dur: 1.2 } : null,
    });
  }

  draw() {
    const { ctx } = this;
    const W = this.viewW, H = this.viewH;
    ctx.clearRect(0, 0, W, H);

    const img = this.images.layers[0];
    if (!img) return;

    const t = tileW(this.panoH);
    const maxShift = Math.max(0, t - W);
    const me = this.players.get(this.meId);
    this.pan = me ? Math.max(0, Math.min((me.x / 1000) * t - W * 0.5, maxShift)) : 0;

    // background tiles (seamless, clipped by canvas)
    for (const [k, shiftF] of [[1, 1]]) {
      const shift = this.pan * (k === 1 ? 1 : 0.9);
      const i0 = Math.floor(shift / t) - 1;
      const n = Math.ceil(W / t) + 3;
      for (let i = i0; i < i0 + n; i++) {
        const dx = i * t - shift;
        ctx.drawImage(img, 0, 0, img.width, img.height, dx, 0, t + 1, this.panoH);
      }
    }

    // foreground groups with scrub parallax
    for (const g of this.images.groups) {
      const shift = this.pan * 0.9;
      const i0 = Math.floor(shift / t) - 1;
      const n = Math.ceil(W / t) + 3;
      for (let i = i0; i < i0 + n; i++) {
        const dx = i * t - shift;
        ctx.drawImage(g, 0, 0, g.width, g.height, dx, 0, t + 1, this.panoH);
      }
    }

    // players
    const panoBottom = this.panoH;
    for (const p of this.players.values()) {
      this.drawPlayer(ctx, p, panoBottom);
    }

    // fx
    this.drawFx(ctx);

    // night
    if (this.night) {
      ctx.fillStyle = "rgba(10,15,40,.42)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawPlayer(ctx, p, baseY) {
    const size = Math.max(52, Math.round(this.panoH * 0.42));
    const t = tileW(this.panoH);
    const bob = Math.sin((performance.now() / 700) + p.id.length) * 4;
    const dx = (p.x / 1000) * t - this.pan + size * 0.25;
    const dy = baseY - size - bob;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath();
    ctx.ellipse(dx + size / 2, baseY - 8, size * 0.45, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    let img = null;
    if (p.smileImg) img = p.smileImg;
    if (img) {
      ctx.save();
      ctx.translate(dx, dy + size * 0.52);
      if (p.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    // name
    const label = p.nick;
    ctx.font = "600 " + Math.round(size * 0.22) + "px system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.strokeText(label, dx + size / 2, dy - 6);
    ctx.fillStyle = p.color || "#334048";
    ctx.fillText(label, dx + size / 2, dy - 6);

    // me marker
    if (p.id === this.meId) {
      ctx.fillStyle = "rgba(46,220,255,.9)";
      ctx.beginPath();
      const cx = dx + size / 2;
      ctx.moveTo(cx, baseY - 6);
      ctx.lineTo(cx - 8, baseY - 16);
      ctx.lineTo(cx + 8, baseY - 16);
      ctx.closePath();
      ctx.fill();
    }
    p._px = dx; p._baseY = baseY;
  }

  drawFx(ctx) {
    const now = performance.now() / 1000;
    this.fx = this.fx.filter((f) => {
      const s = f.slice;
      const cols = Math.floor(s.img.width / s.frame);
      const frame = Math.min(cols - 1, Math.floor((f.t / f.dur) * cols));
      const p = this.players.get(f.user.id);
      const bx = p ? p._px : f.x;
      const by = p ? p._baseY : f.y;

      const size = Math.min(240, this.viewW * 0.28);
      const sx = frame * s.frame;
      if (f.t < f.dur) {
        ctx.save();
        ctx.globalAlpha = f.t < 0.2 ? f.t / 0.2 : 1;
        ctx.drawImage(s.img, sx, 0, s.frame, s.img.height, bx - size / 2, by - size - 8, size, size * (s.img.height / s.frame));
        ctx.restore();
      }
      if (f.overlay) {
        const o = f.overlay;
        if (o.t < o.dur) {
          const oImg = this.fxSheets.get("overlay:" + o.id);
          if (oImg) {
            const k = Math.min(oImg.cells.length - 1, Math.floor((o.t / o.dur) * oImg.cells.length));
            const oi = oImg.cells[k];
            if (oi) ctx.drawImage(oi, bx - 70, by - 170, 140, 140);
          }
        }
        o.t += this.dt;
      }
      f.t += this.dt;
      return f.t < f.dur;
    });
  }

  worldToScreen(wx) {
    return wx;
  }

  hitTest(mx, my) {
    const t = tileW(this.panoH);
    const size = Math.max(52, Math.round(this.panoH * 0.42));
    for (const p of this.players.values()) {
      if (p.id === this.meId) continue;
      const cx = (p.x / 1000) * t - this.pan + size * 0.75;
      const top = this.panoH - size;
      if (mx > cx - size * 0.7 && mx < cx + size * 0.95 && my > top - 6 && my < this.panoH - 4) return p;
    }
    return null;
  }

  worldXToScreen(wx) {
    const t = tileW(this.panoH);
    return (wx / 1000) * t - this.pan;
  }

  screenXToWorld(sx) {
    const t = tileW(this.panoH);
    return Math.max(0, Math.min(1000, ((sx + this.pan) / t) * 1000));
  }
}