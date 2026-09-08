import { smileSrc } from "./assets.js";
import { FX } from "./config.js";

export class UI {
  constructor(els, cb) {
    this.el = els;
    this.cb = cb;
    this.smiles = null;
    this.privateTarget = null;
    this.privateLog = [];
    this.selFx = FX[0];
    this.bind();
  }

  bind() {
    const d = document;
    d.querySelector("#lobby-settings").addEventListener("click", () => this.cb("showSettings"));
    d.querySelectorAll("[data-close]").forEach((x) =>
      x.addEventListener("click", (e) => this.cb("close", +e.currentTarget.dataset.close)));

    // smile popup
    const sp = this.el.smilePopup;
    sp.addEventListener("click", (e) => {
      const cell = e.target.closest(".smile-cell");
      if (cell) { this.cb("smilePicked", parseInt(cell.dataset.idx, 10)); e.stopPropagation(); }
    });

    this.el.overlayMenu.addEventListener("click", (e) => {
      if (e.target === this.el.overlayMenu) this.cb("close", 1);
    });
    this.el.overlayPrivate.addEventListener("click", (e) => {
      if (e.target === this.el.overlayPrivate) this.cb("close", 2);
    });
    d.querySelector("#private-send").addEventListener("click", () => this.sendPrivate());
    d.querySelector("#private-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendPrivate();
    });
  }

  setUser(u) {
    this.el.lobbyAvatar.src = this.smile(u.smile);
    this.el.lobbyNick.textContent = u.nick;
  }

  setLocality(name) {
    this.el.lobbyLoc.textContent = name + " · онлайн: " + (120 + ((Math.random() * 300) | 0));
  }

  smoke(rank) { return rank; }

  smile(idx) { return this.smiles ? this.smiles[idx] && this.smiles[idx].src : smileSrc(idx); }

  renderLobby(locs, onlineFn, onPick) {
    const list = this.el.lobbyList;
    list.textContent = "";
    for (const l of locs) {
      const card = document.createElement("div");
      card.className = "loc-card";
      const img = document.createElement("img");
      img.className = "loc-thumb";
      img.src = `public/assets/data/${l.id}/background.webp`;
      const info = document.createElement("div");
      info.style.flex = "1";
      const name = document.createElement("div");
      name.className = "loc-name"; name.textContent = l.name;
      const people = document.createElement("div");
      people.className = "loc-people"; people.textContent = `👤 ${l.people + ((Math.random() * 30) | 0)} онлайн`;
      info.append(name, people);
      card.append(img, info);
      const enter = document.createElement("div");
      enter.style.fontSize = "22px"; enter.style.color = "#9ad3ff"; enter.innerHTML = "➜";
      card.append(enter);
      card.addEventListener("click", () => onPick(l));
      list.appendChild(card);
    }
  }

  renderServerMenu(menu, onPick) {
    const list = this.el.lobbyList;
    list.textContent = "";
    if (menu.title) {
      const hdr = document.createElement("div");
      hdr.className = "menu-head";
      hdr.textContent = menu.title || "";
      list.appendChild(hdr);
    }
    (menu.items || []).forEach((item, i) => {
      const card = document.createElement("div");
      card.className = item.key === "__tab__" ? "loc-card tab-card" : "loc-card";
      const info = document.createElement("div");
      info.style.flex = "1";
      const name = document.createElement("div");
      name.className = "loc-name"; name.textContent = item.name || "";
      const desc = document.createElement("div");
      desc.className = "loc-people"; desc.textContent = item.desc || "";
      if (item.key === "__tab__") desc.textContent = "вкладка";
      info.append(name, desc);
      card.append(info);
      card.addEventListener("click", () => onPick(item, i));
      list.appendChild(card);
    });
  }

  openSmiles() {
    this.fillSmileGrid(this.scoreGrid());
    this.el.smilePopup.classList.remove("hidden");
  }

  scoreGrid() {
    const g = document.createElement("div");
    g.className = "smile-grid";
    for (let i = 0; i < this.smiles.length; i += 12) {
      const rows = [];
      for (let k = 0; k < 12; k++) rows.push(this.smiles[i + k] || null);
      rows.forEach((img, k) => {
        if (!img) return;
        const b = document.createElement("button");
        b.className = "smile-cell";
        b.dataset.idx = i + k;
        const im = img.cloneNode(true);
        im.draggable = false;
        b.appendChild(im);
        g.appendChild(b);
      });
    }
    return g;
  }

  fillSmileGrid(g) {
    this.el.smilePopup.textContent = "";
    this.el.smilePopup.appendChild(g);
  }

  openGifts() {
    const g = document.createElement("div");
    g.className = "artist-grid";
    FX.forEach((fx, i) => {
      const b = document.createElement("button");
      b.className = "artist-cell";
      b.title = fx.name;
      const im = document.createElement("img");
      im.src = `public/assets/graphics/chat/fx/${fx.id}.png`;
      im.onerror = () => { im.src = `public/assets/graphics/chat/fx/${fx.id}.webp`; };
      b.appendChild(im);
      b.addEventListener("click", () => {
        this.cb("fxPicked", fx);
        this.closeSmiles();
      });
      g.appendChild(b);
    });
    this.el.smilePopup.textContent = "";
    const cap = document.createElement("div");
    cap.style.cssText = "font-size:11px;color:#7a8a94;margin-bottom:8px;";
    cap.textContent = "Подарок выбран: " + this.selFx.name;
    this.el.smilePopup.append(cap, g);
    this.el.smilePopup.classList.remove("hidden");
  }

  closeSmiles() { this.el.smilePopup.classList.add("hidden"); }

  showMenu(user) {
    const el = document.createElement("div");
    const items = [
      { icon: "👤", label: "Мой профиль", act: "profile" },
      { icon: "⚙", label: "Настройки", act: "settings" },
      { icon: "💬", label: "Приватный чат", act: "private" },
      { icon: "🎁", label: "Подарки", act: "gifts" },
      { icon: "🚪", label: "Выйти в лобби", act: "leave" },
    ];
    for (const it of items) {
      const b = document.createElement("button");
      b.className = "menuitem";
      b.innerHTML = `<span>${it.icon}</span><span>${it.label}</span>`;
      b.addEventListener("click", () => this.cb("menu", it.act));
      el.appendChild(b);
    }
    const body = this.el.menuBody;
    body.textContent = "";
    body.appendChild(el);
    this.el.overlayMenu.classList.remove("hidden");
  }

  hideMenu() { this.el.overlayMenu.classList.add("hidden"); }
  hidePrivate() { this.el.overlayPrivate.classList.add("hidden"); }

  showPrivate(users, title) {
    this.el.overlayPrivate.classList.remove("hidden");
    this.el.privateTitle.textContent = title || "Приватный чат";
    this.renderPrivateUsers(users);
    this.renderPrivateLog();
  }

  renderPrivateUsers(users) {
    const box = this.el.privateUsers;
    box.textContent = "";
    for (const u of users) {
      const b = document.createElement("div");
      b.className = "puser" + (this.privateTarget && u.id === this.privateTarget.id ? " sel" : "");
      const img = new Image();
      img.src = this.smile(u.smile);
      const sp = document.createElement("span");
      sp.textContent = u.nick;
      b.append(img, sp);
      b.addEventListener("click", () => {
        this.privateTarget = u;
        this.renderPrivateUsers(users);
        this.renderPrivateLog();
      });
      box.appendChild(b);
    }
  }

  renderPrivateLog() {
    const box = this.el.privateLog;
    box.textContent = "";
    for (const m of this.privateLog) {
      const wrap = document.createElement("div");
      wrap.className = "msg " + (m.me ? "out" : "in");
      const head = document.createElement("div");
      head.className = "mhead";
      head.style.color = m.user.color || "#334048";
      head.textContent = m.user.nick + " → тебе";
      wrap.appendChild(head);
      const body = document.createElement("div");
      body.appendChild(this.cb.renderText(m.text));
      wrap.appendChild(body);
      box.appendChild(wrap);
    }
    box.scrollTop = box.scrollHeight;
  }

  addPrivate(msg) {
    if (this.el.overlayPrivate.classList.contains("hidden")) {
      this.showPrivate(this.cb.roomUsers() || [], null);
    }
    this.privateLog.push(msg);
    this.privateTarget = msg.user;
    this.renderPrivateLog();
  }

  sendPrivate() {
    const inp = this.el.privateInput;
    const text = inp.value.trim();
    if (!text || !this.privateTarget) return;
    inp.value = "";
    this.cb("sendPrivate", this.privateTarget, text);
  }

  showContext(x, y, user, actions) {
    const pop = this.el.ctxPopup;
    pop.textContent = "";
    for (const a of actions) {
      if (a.sep) { const s = document.createElement("div"); s.className = "sep"; pop.appendChild(s); continue; }
      const b = document.createElement("button");
      b.className = "ci";
      if (a.icon) b.innerHTML = `<img class="mi" src="${a.icon}"><span>${a.label}</span>`;
      else b.innerHTML = `<span>${a.label}</span>`;
      b.addEventListener("click", () => { pop.classList.add("hidden"); a.cb && a.cb(); });
      pop.appendChild(b);
    }
    pop.classList.remove("hidden");
    const pad = 8;
    const px = Math.max(pad, Math.min(x, window.innerWidth - 190 - pad));
    const py = Math.max(pad, Math.min(y, window.innerHeight - 200 - pad));
    pop.style.left = px + "px";
    pop.style.top = py + "px";
  }

  hideContext() { this.el.ctxPopup.classList.add("hidden"); }
}