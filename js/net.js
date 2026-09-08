import { LOCATIONS, NOTES, NICK_COLORS, NIGHT_FROM, NIGHT_TO } from "./config.js";

const BOT_NAMES = [
  "Сонечка", "Макс_Play", "Кнопка", "Димка", "Рома", "Лиса", "Тиша",
  "Красотка_Ю", "Тигрёнок", "Пончик", "Звезда", "Милка", "Бублик", "Шустрик",
  "Кит", "Пупсик", "Небо", "Кексик", "Йодль", "Бусинка",
];

function uid() { return Math.random().toString(36).slice(2, 10); }

export class Net {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.bots = new Map();
    this.botsByLoc = new Map(LOCATIONS.map((l) => [l.id, []]));
    this.timers = [];
    this.onlineNow = {};
  }

  connect(nick, isGuest) {
    const user = {
      id: "u" + uid(),
      nick,
      guest: !!isGuest,
      smile: Math.floor(Math.random() * 80),
      color: NICK_COLORS[Math.floor(Math.random() * NICK_COLORS.length)],
      place: null,
      online: false,
    };
    this.user = user;
    this._emit({ type: "session", user });
    return new Promise((res) => setTimeout(() => {
      this.onlineNow = { values: Math.floor(120 + Math.random() * 400), max: 888 };
      res(user);
    }, 700));
  }

  _emit(ev) { this.onEvent(ev); }

  spawnBots(locId) {
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const list = names.slice(0, LOCATIONS.find((l) => l.id === locId).people);
    this.botsByLoc.set(locId, []);
    list.forEach((name, i) => {
      const b = {
        id: "b" + uid(),
        nick: name,
        smile: Math.floor(Math.random() * 88),
        color: NICK_COLORS[Math.floor(Math.random() * NICK_COLORS.length)],
        x: 60 + Math.random() * 880,
        y: 0,
        vx: 0, vy: 0,
        target: null,
        walk: false,
        room: locId,
        status: i % 5 === 0 ? "Занят" : null,
      };
      this.bots.set(b.id, b);
      this.botsByLoc.get(locId).push(b);
      this._emit({ type: "user_enter", user: b });
    });
    this.user.room = locId;
    this.user.x = 780; this.user.y = 0;
    this._emit({ type: "user_enter", user: this.user, me: true });
  }

  walkUser(u, toX, toY) {
    u.target = toX;
    u.walk = true;
    u.vx = toX > u.x ? 1 : -1;
    if (u.id === this.user.id) this._emit({ type: "move", user: u });
    else this._emit({ type: "move", user: u });
  }

  tick(dt) {
    for (const b of this.bots.values()) {
      if (b.room !== this.user.room) continue;
      if (b.walk && b.target != null) {
        const dir = Math.sign(b.target - b.x);
        b.x += dir * 42 * dt;
        if (Math.abs(b.target - b.x) < 3) { b.walk = false; b.target = null; b.vx = 0; }
        if (Math.random() < dt * 0.7) this._emit({ type: "move", user: b });
      } else if (Math.random() < dt * 0.25) {
        b.walk = true;
        b.target = 60 + Math.random() * 880;
      }
    }
  }

  say(user, text, priv = false) {
    const msg = { id: uid(), user, text, time: Date.now(), priv };
    this._emit({ type: "message", msg });
    if (!priv && user.id !== this.user.id) {
      const delay = 1500 + Math.random() * 4000;
      setTimeout(() => this._botReply(user), delay);
    }
    return msg;
  }

  placeSmile(user, idx) {
    this._emit({ type: "smile", user, smile: idx });
    const truth = NOTES[Math.floor(Math.random() * NOTES.length)];
    setTimeout(() => this.say(user, truth, false), 1600 + Math.random() * 2000);
  }

  effect(user, fx) {
    this._emit({ type: "effect", user, fx });
  }

  dailyMood(user) {
    const moods = ["Доброе утро!", "Отличный день!", "Опять дождь 😅", "Классно тут!", "Приходите в гости!"];
    return moods[Math.floor(Math.random() * moods.length)];
  }

  _botReply(user) {
    if (this.user.room !== user.room) return;
    const replies = [
      "[b]Привет[/b], " + this.user.nick + "!",
      "Ага, я тоже так думаю)",
      "Ого, правда?",
      "Смотри, какой у меня смайл! ::S" + Math.floor(Math.random() * 88) + "::",
      "Ха-ха!",
      "Может, поиграем?",
      "Я люблю это место!",
      "Мне пора спать 😴",
    ];
    this.say(user, replies[Math.floor(Math.random() * replies.length)]);
  }

  usersInRoom() {
    return this.botsByLoc.get(this.user.room) || [];
  }

  isNight() {
    const h = new Date().getHours();
    return h >= NIGHT_FROM || h < NIGHT_TO;
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}