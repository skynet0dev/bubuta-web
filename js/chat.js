import { renderBBCode } from "./bbcode.js";
import { smileSrc } from "./assets.js";

export class Chat {
  constructor(root, opts) {
    this.root = root;
    this.opt = opts || {};
    this.smiles = null;
    this.smileCount = 0;
    this.muted = false;
  }

  setSmiles(imgs) {
    this.smiles = imgs;
    this.smileCount = Math.min(imgs.length, 262144);
  }

  add(entry) {
    const wrap = document.createElement("div");
    wrap.className = "msg";
    if (entry.type === "sys") {
      wrap.classList.add("sys");
      wrap.textContent = entry.text;
    } else {
      const isOut = entry.me;
      wrap.classList.add(isOut ? "out" : "in");
      const head = document.createElement("div");
      head.className = "mhead";
      head.textContent = entry.nick || "";
      head.style.color = entry.color || "#334048";
      wrap.appendChild(head);
      const body = document.createElement("div");
      body.appendChild(this.renderText(entry.text));
      wrap.appendChild(body);
      if (this.opt.onNickTap) {
        head.addEventListener("click", (e) => {
          e.stopPropagation();
          this.opt.onNickTap(entry);
        });
        head.style.cursor = "pointer";
      }
      if (this.opt.onRemove) {
        wrap.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.opt.onRemove(entry);
        });
      }
    }
    this.root.appendChild(wrap);
    while (this.root.children.length > 250) this.root.firstChild.remove();
    if (!this.pinnedUp()) this.scrollDown();
  }

  scrollDown() {
    this.root.scrollTop = this.root.scrollHeight;
  }

  pinnedUp() {
    return this.root.scrollTop + this.root.clientHeight < this.root.scrollHeight - 30;
  }

  renderText(src) {
    if (this.smiles) {
      return renderBBCode(src, (i) => {
        if (i < 0 || i >= this.smileCount) return null;
        return this.smiles[i] || null;
      }, null, this.smileCount);
    }
    const el = document.createElement("span");
    el.textContent = src;
    return el;
  }

  clear() { this.root.textContent = ""; }
}