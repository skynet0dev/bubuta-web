import {
  decodePayload, encodePayload, framePacket, parsePacketHeader,
  XorCipher, gunzipBytes
} from "./protocol.js";
import { LOCATIONS, NIGHT_FROM, NIGHT_TO } from "./config.js";

const KEY_MASKS = {
  0: Uint8Array.from([0x98, 0x82, 0x51, 0xb0, 0x59]),
  4: Uint8Array.from([0x0f, 0xd6, 0x76, 0x90, 0x1c]),
};

export class Net {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.ws = null;
    this.cipher = new XorCipher();
    this.recvBuf = new Uint8Array(0);
    this.state = "disconnected";
    this.user = null;
    this.allUsers = [];
    this.bots = new Set();
    this.botsByLoc = new Map();
    this.currentLoc = "loc01";
    this.serverAddr = localStorage.getItem("serverAddr") || "89.111.136.70";
    this.serverPort = parseInt(localStorage.getItem("serverPort") || "110", 10);
    this.bridgePort = parseInt(localStorage.getItem("bridgePort") || "8166", 10);
    this.hsKeyId = null;
    this.hsKey5 = null;
    this.regAccount = {};
    this.awaiting = null;        // {fg,type,flags,payload} to send after next [0/3]
    this.awaitingSex = false;
    this.chatSeq = 0;
    this._sex = localStorage.getItem("bubuta_sex") || "2";
  }

  _emit(ev) { try { this.onEvent(ev); } catch (e) {} }

  async connect(nick, isGuest) {
    this.nick = nick;
    this.state = "connecting";

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      try {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.bridgePort}`);
        this.ws.binaryType = "arraybuffer";
      } catch (e) {
        return reject(new Error("Cannot connect to bridge (ws://127.0.0.1:" + this.bridgePort + ")"));
      }

      this.ws.onopen = () => {
        this._emit({ type: "log", text: `WebSocket ok. Waiting TCP ${this.serverAddr}:${this.serverPort}...` });
      };

      this.ws.onmessage = async (evt) => {
        if (typeof evt.data === "string") {
          const msg = JSON.parse(evt.data);
          if (msg.type === "connected") {
            this._emit({ type: "log", text: "TCP connected." });
            this._doHandshake();
          } else if (msg.type === "disconnected" || msg.type === "error") {
            if (this.state === "online") this._emit({ type: "disconnect", reason: msg.error || "closed" });
            else this._reject(new Error(msg.error || "Server closed connection"));
          }
          return;
        }
        const raw = new Uint8Array(evt.data);
        if (raw.length === 0) return;
        if (raw[0] === 0) await this._onRecv(raw.slice(1));
      };

      this.ws.onclose = () => {
        if (this.state === "online") {
          this.state = "disconnected";
          this._emit({ type: "disconnect", reason: "ws closed" });
        }
      };
      this.ws.onerror = (e) => {
        this._reject(new Error("WebSocket error. Запусти мост: node bridge.js"));
      };

      setTimeout(() => {
        if (this.state === "handshake" || this.state === "keyed") {
          this.state = "error";
          this._reject(new Error("Timeout during handshake"));
        }
      }, 20000);
    });
  }

  // ─── Handshake ───
  async _doHandshake() {
    try {
      this.state = "handshake";
      this.hsKeyId = Math.random() < 0.5 ? 4 : 0;
      const mask = KEY_MASKS[this.hsKeyId];
      this.hsKey5 = crypto.getRandomValues(new Uint8Array(5));
      const masked = new Uint8Array(5);
      for (let i = 0; i < 5; i++) masked[i] = this.hsKey5[i] ^ mask[i];

      const blob = new Uint8Array(19);
      const info = crypto.getRandomValues(new Uint8Array(11));
      blob[0] = this.hsKeyId;
      blob[1] = 0x01; blob[2] = 0x01;
      blob.set(info, 3);
      blob.set(masked, 14);

      const payload = encodePayload([blob]);
      const frame = framePacket(0, 0, 0, payload); // plaintext
      this._send(frame);
      this._emit({ type: "log", text: `Handshake [0/0] sent (key_id=${this.hsKeyId}), waiting key...` });
      this.cipher = new XorCipher(this.hsKey5);
    } catch (e) {
      this._emit({ type: "log", text: "Handshake err: " + e.message });
      this._reject(e);
    }
  }

  async _onRecv(bytes) {
    this.recvBuf = concatUint8(this.recvBuf, bytes);
    while (this.recvBuf.length >= 4) {
      const head = this.cipher.process(this.recvBuf.slice(0, 4));
      const len = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
      if (len < 4 || len > 16 * 1024 * 1024) break;
      const total = 4 + len;
      if (this.recvBuf.length < total) break;
      const frame = this.recvBuf.slice(0, total);
      this.recvBuf = this.recvBuf.slice(total);
      try {
        const dec = this.cipher.process(frame);
        const hdr = parsePacketHeader(dec);
        if (!hdr) continue;
        let payload = dec.slice(8, hdr.totalLen);
        if (hdr.flags & 1) {
          try { payload = await gunzipBytes(payload); } catch (e) {}
        }
        const decoded = decodePayload(payload);
        await this._handlePacket(hdr.foodgroup, hdr.type, hdr.flags, decoded);
      } catch (e) {
        this._emit({ type: "log", text: "Parse err: " + e.message });
      }
    }
  }

  async _handlePacket(foodgroup, type, flags, data) {
    try {
      // key exchange
      if (foodgroup === 0 && type === 1 && this.state === "handshake") {
        const realKey = _extractRealKey(data);
        if (realKey) {
          this.cipher = new XorCipher(realKey);
          this.state = "keyed";
          this._emit({ type: "log", text: "XOR key set: " + hex(realKey) });
          this.regStep = 0;
          await this._regStep2(); // send [0/2]
        } else {
          this._emit({ type: "log", text: "No real key in [0/1]" });
        }
        return;
      }

      // [0/3] empty — pacing ack; fire pending action if any
      if (foodgroup === 0 && type === 3 && this.state === "keyed") {
        if (this.awaiting) {
          const a = this.awaiting;
          this.awaiting = null;
          await this._sendPacket(a.fg, a.type, a.flags, a.payload);
        }
        return;
      }

      // [0/5] — server response with account / new-device marker
      if (foodgroup === 0 && type === 5) {
        await this._handleAuth(data);
        return;
      }

      // [5/6] ready? (rare from server)
      if (foodgroup === 5 && type === 6) {
        return;
      }

      // content dialogs (sexChoose / intro / menus)
      if (foodgroup === 4 && type === 3) {
        await this._handleContent(data);
        return;
      }

      // notification counters [3/7]
      if (foodgroup === 3 && type === 7) {
        return;
      }

      // welcome message [5/0] → [nick, ts, text, ...]
      if (foodgroup === 5 && type === 0) {
        if (Array.isArray(data) && data.length >= 4) {
          const nick = String(data[1]);
          const text = String(data[3]);
          this._emit({ type: "message", msg: { id: "sw" + (++this.chatSeq), user: { id: 0, nick, color: "#e8c04a", smile: 0 }, text, time: Date.now(), priv: false, sys: true } });
        }
        return;
      }

      // chat [2/4] and private [2/8]
      if (foodgroup === 2 && (type === 4 || type === 8)) {
        this._handleChat(data, type === 8);
        return;
      }

      // generic command-style array [A,B,"name",{},{}]
      if (Array.isArray(data) && typeof data[0] === "number" && typeof data[1] === "number" && typeof data[2] === "string") {
        this._emit({ type: "command", name: data[2], args: data.slice(3) });
        return;
      }
    } catch (e) {
      this._emit({ type: "log", text: "Handle err: " + e.message });
    }
  }

  // [0/2] empty → server replies [0/3]; then pending.
  async _regStep2() {
    const deviceInfo = this._buildDeviceInfo();
    this.awaiting = { fg: 0, type: 4, flags: 0, payload: [deviceInfo] }; // [0/4] after [0/3]
    await this._sendPacket(0, 2, 0, []);
  }

  _buildDeviceInfo() {
    const saved = {};
    try { Object.assign(saved, JSON.parse(localStorage.getItem("bubuta_account") || "{}")); } catch (e) {}
    this._lastAndroidId = saved.android_id || randomHex(8);
    const deviceInfo = {
      android_id: this._lastAndroidId,
      android_version: "7.1.2",
      cx: 540, cy: 924,
      dt: Math.floor(Date.now() / 1000),
      fingerprint: "samsung/z3qksx/z3q:7.1.2/QP1A.190711.020/G988NKSU1ATED:user/release-keys",
      kernel_version: "4.9.31",
      model_codename: "z3q",
      model_id: "QP1A.190711.020.G988NKSU1ATED",
      model_name: "SM-G988N",
      nm: "0",
      platform: "android",
      sdk_version: "25",
      version: "4.8.0",
    };
    if (saved.user_id !== undefined && saved.password) {
      deviceInfo.user_id = saved.user_id;
      deviceInfo.password = saved.password;
      this._emit({ type: "log", text: "Login with saved account id=" + saved.user_id });
    } else {
      this._emit({ type: "log", text: "New device — registration path" });
    }
    return deviceInfo;
  }

  _handleAuth(data) {
    if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object") {
      const d = data[0];
      if (d.user_id !== undefined && d.password) {
        this.regAccount = { user_id: d.user_id, password: d.password, nick: d.nick || this.nick, female: this._sex === "2" };
        this._emit({ type: "log", text: `АККАУНТ: nick=${d.nick}, id=${d.user_id}, pass=${d.password}` });
        d.android_id = this._lastAndroidId;
        try { localStorage.setItem("bubuta_account", JSON.stringify(d)); } catch (e) {}
        this._online();
        return;
      }
      // empty dict {} → new device, need sex
      if (Object.keys(d).length === 0) {
        this.awaitingSex = true;
        this._emit({ type: "log", text: "[0/5] {} — new device, sending [5/6] + [4/0] intro" });
        this._sendPacket(5, 6, 0, []).then(() =>
          sleep(300).then(() => this._sendPacket(4, 0, 0, [0]))
        );
        return;
      }
    }
  }

  async _handleContent(data) {
    // sex dialog: contains "intro2/sexChoose"
    if (!Array.isArray(data)) return;
    const json = JSON.stringify(data);
    if (this.awaitingSex && json.includes("intro2/sexChoose")) {
      this.awaitingSex = false;
      this._emit({ type: "log", text: "Sex dialog received. Choosing key=" + this._sex });
      // [0/2] empty → then after [0/3] send [4/1]
      this.awaiting = { fg: 4, type: 1, flags: 0, payload: [0, 1, "intro2/sexChoose", { key: this._sex }, {}] };
      await this._sendPacket(0, 2, 0, []);
      return;
    }
    this._emit({ type: "content", data });
  }

  _handleChat(data, priv) {
    try {
      let items = Array.isArray(data[0]) ? data[0] : data;
      for (const row of items) {
        if (Array.isArray(row) && row.length >= 5) {
          const [, seq, , senderId, text] = row;
          if (typeof senderId === "number" && typeof text === "string") {
            const u = this._upsertUser(senderId);
            this._emit({ type: "message", msg: { id: "m" + (seq || ++this.chatSeq), user: u, text, time: Date.now(), priv, sys: false } });
            continue;
          }
        }
        if (Array.isArray(row) && typeof row[0] === "number" && typeof row[1] === "string") {
          const u = this._upsertUser(row[0]);
          this._emit({ type: "message", msg: { id: "m" + (++this.chatSeq), user: u, text: row[1], time: Date.now(), priv, sys: false } });
        }
      }
    } catch (e) {}
  }

  _upsertUser(uid) {
    const id = "s" + uid;
    for (const u of this.allUsers) if (u.id === id) return u;
    const u = {
      id, serverId: uid, nick: "User_" + (uid % 10000),
      smile: 0, color: "#" + ((uid * 2654435761) % 0xffffff).toString(16).padStart(6, "0"),
      x: 60 + Math.random() * 880, y: 0, walk: false, target: null,
    };
    this.allUsers.push(u);
    this._emit({ type: "user_enter", user: u });
    return u;
  }

  _online() {
    this.state = "online";
    this.user = {
      id: "me",
      nick: this.regAccount.nick || this.nick,
      user_id: this.regAccount.user_id,
      password: this.regAccount.password,
      color: "#73a7ff", smile: 0, x: 480, y: 0,
    };
    this._resolve(this.user);
  }

  async _sendPacket(foodgroup, type, flags, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      let encoded = encodePayload(payload);
      if (flags & 1) {
        // gzip send — supported via CompressionStream when ready; fallback raw
        this._emit({ type: "log", text: "gzip send (raw fallback)" });
      }
      const framed = framePacket(foodgroup, type, flags, encoded);
      const wrapped = new Uint8Array(framed.length + 1);
      wrapped[0] = 0x01;
      wrapped.set(framed, 1);
      this.ws.send(wrapped);
      return true;
    } catch (e) {
      this._emit({ type: "log", text: "Send err: " + e.message });
      return false;
    }
  }

  _send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const wrapped = new Uint8Array(frame.length + 1);
    wrapped[0] = 0x01;
    wrapped.set(frame, 1);
    this.ws.send(wrapped);
  }

  // chat API
  async say(user, text, priv = false) {
    try {
      if (priv) {
        await this._sendPacket(2, 8, 0, [user.serverId || 0, text, 0]);
      } else {
        await this._sendPacket(2, 28, 0, [text, 0]);
      }
      this._emit({ type: "message", msg: { id: "m" + (++this.chatSeq), user, text, time: Date.now(), priv } });
    } catch (e) {}
  }

  async placeSmile(user, idx) {
    this._emit({ type: "smile", user, smile: idx });
  }

  async effect(user, fx) { this._emit({ type: "effect", user, fx }); }

  walkUser(u, toX, toY) {
    u.target = toX; u.x = toX; u.walk = false;
    this._emit({ type: "move", user: u });
  }

  // local filler bots (used when server room is empty / offline fallback)
  spawnBots(locId) {
    if (this.botsByLoc.has(locId) && this.botsByLoc.get(locId).length) return;
    const names = ["Виталик", "Крош", "Лира", "Мася", "Алиса", "Тимон", "Гоша", "Айна"];
    const list = [];
    for (let i = 0; i < 8; i++) {
      const uid = 9000 + i;
      const u = this._upsertUser(uid);
      u.nick = names[i];
      u.x = 60 + Math.random() * 880;
      u.bot = true;
      list.push(u);
      this.bots.add(u.id);
      this._emit({ type: "user_enter", user: u });
    }
    this.botsByLoc.set(locId, list);
  }

  _botReply(target) {
    if (target && target.bot) {
      const phrases = ["Привет!", "Как дела?", "Ага", "Ахахах 😄", "Куда пропал?", "Дай денег на подарок)"];
      return phrases[Math.floor(Math.random() * phrases.length)];
    }
    return "…";
  }

  usersInRoom() {
    return this.allUsers.filter((u) => u.id !== "me");
  }

  isNight() { const h = new Date().getHours(); return h >= NIGHT_FROM || h < NIGHT_TO; }

  tick(dt) {
    for (const b of this.allUsers) {
      if (Math.random() < dt * 0.15) {
        b.x = 60 + Math.random() * 880;
        this._emit({ type: "move", user: b });
      }
    }
  }

  dispose() { if (this.ws) this.ws.close(); }
}

function concatUint8(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function randomHex(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hex(u8) {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Extract real XOR key from [0/1]:
// root = [bin(01), bin(key)] — the second binary element is the key (bytes after payload[11]).
function _extractRealKey(data) {
  if (!Array.isArray(data)) return null;
  for (const el of data) {
    if (el instanceof Uint8Array) {
      if (el.length > 4) return el;
    }
  }
  return null;
}