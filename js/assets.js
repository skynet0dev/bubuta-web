import { ASSETS, SOUNDS, LOC_W, LOC_H, SMILE_COLS } from "./config.js";

const cache = new Map();
let soundCtx = null;

export function url(path) {
  return ASSETS + path;
}

export function loadImage(path) {
  if (cache.has(path)) return cache.get(path);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("load " + path));
    img.src = url(path);
  });
  cache.set(path, p);
  return p;
}

export function loadFonts() {}

export async function loadSmiles(w, h) {
  try {
    const sheet = await loadImage("graphics/smilepack.png");
    const tiles = [];
    const per = SMILE_COLS;
    const tw = sheet.width / per;
    const rows = Math.floor(sheet.height / tw);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < per; c++) {
        const cv = document.createElement("canvas");
        cv.width = tw; cv.height = tw;
        const g = cv.getContext("2d");
        g.drawImage(sheet, c * tw, r * tw, tw, tw, 0, 0, tw, tw);
        const img = new Image();
        img.src = cv.toDataURL("image/png");
        img.className = "sm";
        tiles.push(img);
      }
    }
    return tiles;
  } catch (e) {
    return [];
  }
}

export function smileSrc(index) {
  return `data-smile:${index}`;
}

export function cutSheet(path, rows) {
  return loadImage(path).then((sheet) => {
    const cells = [];
    const cw = sheet.width, ch = Math.floor(sheet.height / rows);
    for (let i = 0; i < rows; i++) {
      const cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      const g = cv.getContext("2d");
      g.drawImage(sheet, 0, i * ch, cw, ch, 0, 0, cw, ch);
      const img = new Image();
      img.src = cv.toDataURL("image/png");
      cells.push(img);
    }
    return cells;
  });
}

export function hideOnEmptyRows(sheet, rows) {
  return cutSheet(sheet, rows);
}

export async function loadFxImage(name) {
  return loadImage("graphics/chat/fx/" + name + ".png")
    .catch(() => loadImage("graphics/chat/fx/" + name + ".webp"));
}

export function createAudio() {
  if (!soundCtx) soundCtx = new (window.AudioContext || window.webkitAudioContext)();
  return soundCtx;
}

const audioPool = new Map();
export async function playSound(name) {
  try {
    if (!audioPool.has(name)) {
      const a = new Audio(url(name));
      a.preload = "auto";
      audioPool.set(name, a);
    }
    const a = audioPool.get(name);
    a.currentTime = 0;
    await a.play();
  } catch (e) { /* muted / not ready */ }
}

export function pickSound(kind) {
  return SOUNDS.filter((s) => s.includes(kind));
}

export function panoramaUrl(locId, layer) {
  if (layer === 0) return url(`data/${locId}/background.webp`);
  return url(`data/${locId}/group${layer}.webp`);
}

export function locLayers(locId) {
  const defs = { loc01: 1, loc58: 1, loc59: 4 };
  const n = defs[locId] || 1;
  return n;
}

export function tileW(h) { return h * (LOC_W / LOC_H); }