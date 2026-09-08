import {
  decodePayload, encodePayload, framePacket, parsePacketHeader,
  XorCipher, gunzipBytes
} from "./protocol.js";
import { LOCATIONS, NIGHT_FROM, NIGHT_TO } from "./config.js";

const KEY_MASKS = {
  0: Uint8Array.from([0x98, 0x82, 0x51, 0xb0, 0x59]),
  4: Uint8Array.from([0x0f, 0xd6, 0x76, 0x90, 0x1c]),
};

// Entry [0/0] blobs captured from the real Android client.
// The server VALIDATES the whole 19-byte blob (any mutation is rejected),
// so we must replay known-good ones. Session key is fresh each connection.
const ENTRY_BLOBS = [
  "040101573ee14ea7243de04fa429fbc842e963",
  "040101ed3ee14ea02938e147a92991272fe09f",
  "040101c53ee14ea72536e647a824475b5e63a7",
].map((hex) => {
  const b = new Uint8Array(19);
  for (let i = 0; i < 19; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
});
let entryBlobIndex = Math.floor(Math.random() * ENTRY_BLOBS.length);

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
    this.screen = null;          // last [4/3] screen state {sc, counter, cmd, tab_cur, title, items}
    this.onlineRoom = false;     // true while inside a server room ([4/3] loc_id screen)
    this._pendingLocId = null;   // loc_id await entry ack for a public location
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
      // The server validates the entry blob byte-for-byte, so replay captured ones.
      this.entryBlob = ENTRY_BLOBS[entryBlobIndex % ENTRY_BLOBS.length];
      entryBlobIndex++;
      this.hsKeyId = this.entryBlob[0] in KEY_MASKS ? this.entryBlob[0] : 4;
      const mask = KEY_MASKS[this.hsKeyId];
      this.hsKey5 = new Uint8Array(5);
      for (let i = 0; i < 5; i++) this.hsKey5[i] = this.entryBlob[14 + i] ^ mask[i];

      const payload = encodePayload([this.entryBlob]);
      const frame = framePacket(0, 0, 0, payload); // plaintext
      this._send(frame);
      this._emit({ type: "log", text: `Handshake [0/0] sent (entry blob #${entryBlobIndex}, key_id=${this.hsKeyId}), waiting key...` });
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

      // room users [2/1] — fill real nick/color/smile
      if (foodgroup === 2 && type === 1) {
        this._handleRoomUsers(data);
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
    this._savedAccount = saved;
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
      // login: server confirms existing account with {nick, sex, ping_interval}
      if (typeof d.nick === "string") {
        const saved = {};
        try { Object.assign(saved, JSON.parse(localStorage.getItem("bubuta_account") || "{}")); } catch (e) {}
        this._emit({ type: "log", text: `LOGIN OK: nick=${d.nick} sex=${d.sex}` });
        if (!saved.nick) {
          saved.nick = d.nick;
          saved.user_id = saved.user_id ?? this._lastSavedUserId;
          try { localStorage.setItem("bubuta_account", JSON.stringify(saved)); } catch (e) {}
        }
        if (this._savedAccount) this._savedAccount.nick = d.nick;
        this._online();
        // request main menu: [5/6] ready then [4/0][0] (see big.txt)
        this._sendPacket(5, 6, 0, []).then(() =>
          sleep(300).then(() => this._sendPacket(4, 0, 0, [0]))
        );
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

    const sc = data[0];
    const counter = data[1];
    if (this.awaitingSex && json.includes("intro2/sexChoose")) {
      this.awaitingSex = false;
      this._emit({ type: "log", text: "Sex dialog received. Choosing key=" + this._sex });
      // [0/2] empty → then after [0/3] send [4/1]
      this.awaiting = { fg: 4, type: 1, flags: 0, payload: [sc, counter + 1, "intro2/sexChoose", { key: this._sex }, {}] };
      await this._sendPacket(0, 2, 0, []);
      return;
    }
    const title = data[3] && String(data[3]);
    // command from banner: ["выбор", [0, ["cmd"]]] etc
    let cmd = "";
    if (Array.isArray(data[4]) && Array.isArray(data[4][1]) && Array.isArray(data[4][1][1])) {
      cmd = String(data[4][1][1][0] || "");
    }
    const dict = data[8] && typeof data[8] === "object" ? data[8] : {};
    this.screen = { sc, counter, cmd, tab_cur: dict.tab_cur };

    // room screen: server opened loc (loc_id + places)
    if (dict.loc_id !== undefined && dict.places !== undefined) {
      this.onlineRoom = true;
      this._pendingLocId = null;
      this.screen.loc_id = dict.loc_id;
      this.screen.online = true;
      this._emit({ type: "room_open", loc_id: dict.loc_id, places: dict.places, title });
      await this._sendPacket(2, 0, 0, [dict.loc_id]);
      await this._sendPacket(3, 4, 0, [dict.loc_id]);
      return;
    }

    // "действие" popup: server pushes actions sheet (e.g. after entering public loc, hide_on:loc_id)
    if (Array.isArray(data[4]) && String(data[4][0]) === "действие") {
      if (this._pendingLocId) {
        // entering public location: send [2/0] + [3/4] then await user list
        const loc = this._pendingLocId;
        this._pendingLocId = null;
        this.onlineRoom = true;
        this.screen.online = true;
        this.screen.loc_id = loc;
        this._emit({ type: "room_open", loc_id: loc, places: 0, title });
        await this._sendPacket(2, 0, 0, [loc]);
        await this._sendPacket(3, 4, 0, [loc]);
      } else {
        this._emit({ type: "content", data });
      }
      return;
    }

    // dialog with message and answer list
    if (dict.msg && dict.ans_list && typeof dict.ans_list === "object") {
      const answers = Object.entries(dict.ans_list).map(([k, v]) => ({ key: k, label: String(v) }));
      this._emit({ type: "dialog", title, msg: String(dict.msg), answers, cmd });
      return;
    }

    // "СТАРТ!" welcome screen for new accounts (flags 03)
    if (Array.isArray(data[4]) && String(data[4][0]) === "Старт!") {
      this._emit({ type: "start", title, content: dict.menu_items || [] });
      // advance: [0/2] → [0/3] → [4/0][2]
      this.awaiting = { fg: 4, type: 0, flags: 0, payload: [2] };
      await this._sendPacket(0, 2, 0, []);
      return;
    }

    // main menu / submenu: menu_items + menuSelect/open cmd
    if (Array.isArray(dict.menu_items) && dict.menu_items.length && (cmd === "menuSelect" || cmd === "open")) {
      const isForm = dict.menu_items.some((m) => Array.isArray(m) && m[5] && (m[5].text_limit !== undefined || m[5].input_type !== undefined));
      if (!isForm) {
        const items = dict.menu_items
          .filter((m) => Array.isArray(m) && m.length >= 4 && typeof m[3] === "string" && m[3].length > 0)
          .map((m, i) => ({ key: String(m[0]), id: m[1], name: String(m[3]), desc: m[4] ? String(m[4]) : "", view: (m[5] && m[5].view) }));
        this._emit({ type: "menu", title, items });
        return;
      }
    }

    // city room picker (cmd polis_chat/main with menu_items + tabs)
    if (Array.isArray(dict.menu_items) && dict.menu_items.length && dict.tab_cur !== undefined) {
      const items = dict.menu_items
        .filter((m) => Array.isArray(m) && m.length >= 4 && typeof m[3] === "string" && m[3].length > 0)
        .map((m, i) => ({ key: String(m[0]), id: m[1], name: String(m[3]), desc: m[4] ? String(m[4]) : "", online: 0 }));
      const tabs = Array.isArray(dict.tab_list)
        ? dict.tab_list.map((t, i) => ({ no: i + 1, name: String(t[0] || (i + 1)) }))
        : [];
      this._emit({ type: "city", title, items, tabs, tab_cur: dict.tab_cur });
      return;
    }

    this._emit({ type: "content", data });
  }

  _handleChat(data, priv) {
    try {
      // [2/4] → [[0, seq, ts, uid, text], ...]  OR  [2/28-sent] → []
      let items;
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && data[0].length > 0) {
        items = Array.isArray(data[0][0]) ? data[0] : data;
      } else {
        items = data;
      }
      for (const row of items) {
        if (Array.isArray(row) && row.length >= 5) {
          const [, seq, , senderId, text] = row;
          if (typeof senderId === "number" && typeof text === "string") {
            const u = this._upsertUser(senderId);
            const mine = (this.user && this.user.user_id) === senderId;
            if (!mine) {
              this._emit({ type: "message", msg: { id: "m" + (seq || ++this.chatSeq), user: u, text, time: Date.now(), priv, sys: false } });
            }
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

  _handleRoomUsers(data) {
    try {
      // [2/1] → [1, [[uid, color, 0, "nick", smile, isMan, level, ...], ...]]
      let list = data;
      if (Array.isArray(data) && data[0] === 1 && Array.isArray(data[1])) list = data[1];
      else if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) list = data;
      for (const row of list) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const uid = row[0];
        if (typeof uid !== "number") continue;
        const u = this._upsertUser(uid);
        if (typeof row[3] === "string") u.nick = row[3];
        const col = row[1];
        if (typeof col === "string" && col.length === 6) u.color = "#" + col;
        if (typeof row[4] === "number" && row[4] > 0) u.smile = row[4];
        this._emit({ type: "user_enter", user: u });
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
    const account = this.regAccount.user_id ? this.regAccount : (this._savedAccount || this.regAccount);
    this.user = {
      id: "me",
      nick: account.nick || this.nick,
      user_id: account.user_id,
      password: account.password,
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

  // ─── server menu / room navigation ───
  // [4/1] = [screen[0], screen[1]+1, cmd, dict1, dict2]
  selectMenuItem(idx, key) {
    const s = this.screen;
    if (!s || !["menuSelect", "polis_chat/main"].includes(s.cmd)) return false;
    const dict1 = { cur_pos: idx, key: key || String(idx) };
    const dict2 = s.cmd === "polis_chat/main" ? { tabs: s.tab_cur || 1 } : {};
    return this._sendPacket(4, 1, 0, [s.sc, s.counter + 1, s.cmd, dict1, dict2]);
  }

  selectCityItem(idx, key) {
    const s = this.screen;
    if (!s) return false;
    const cmd = s.cmd || "polis_chat/main";
    const dict1 = { cur_pos: idx, key: key || String(idx) };
    const dict2 = { tabs: s.tab_cur || 1 };
    this._pendingLocId = key || String(idx);
    return this._sendPacket(4, 1, 0, [s.sc, s.counter + 1, cmd, dict1, dict2]);
  }

  selectTab(tab_no) {
    const s = this.screen;
    if (!s) return false;
    return this._sendPacket(4, 1, 0, [s.sc, s.counter + 1, "cAction", { cmd: "selectPage", cur_pos: 0, tab_no }, { tabs: s.tab_cur || 1 }]);
  }

  answerDialog(key) {
    const s = this.screen;
    const cmd = s && s.cmd ? s.cmd : "main";
    return this._sendPacket(4, 1, 0, [(s && s.sc) || 0, (s ? s.counter : 0) + 1, cmd, { key: String(key) }, {}]);
  }

  dismiss() {
    // [4/0][5] — close current popup/dialog
    return this._sendPacket(4, 0, 5, []);
  }

  back() {
    return this.dismiss();
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