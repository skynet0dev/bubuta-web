export const ASSETS = "public/assets/";

export const SOUNDS = [
  "sound/click1.mp3", "sound/click2.mp3", "sound/click3.mp3",
  "sound/eff1.mp3", "sound/eff2.mp3", "sound/eff3.mp3",
  "sound/eff4.mp3", "sound/eff5.mp3", "sound/eff6.mp3",
  "sound/eff7.mp3", "sound/eff8.mp3", "sound/eff9.mp3",
  "sound/eff10.mp3", "sound/eff11.mp3", "sound/eff12.mp3",
  "sound/eff13.mp3", "sound/eff14.mp3", "sound/eff15.mp3",
  "sound/message_1.mp3", "sound/message_2.mp3", "sound/message_3.mp3",
  "sound/new_online.mp3", "sound/online.mp3",
  "sound/receive_1.mp3", "sound/receive_2.mp3", "sound/receive_3.mp3",
  "sound/send_1.mp3", "sound/send_2.mp3", "sound/send_3.mp3",
  "sound/system_1.mp3", "sound/system_2.mp3", "sound/system_3.mp3",
  "sound/timer_1.mp3"
];

export const LOCATIONS = [
  { id: "loc01", name: "Центральная площадь", parts: 6, people: 12 },
  { id: "loc58", name: "Игровая зона",       parts: 6, people: 8 },
  { id: "loc59", name: "Уютный дворик",      parts: 4, people: 5 },
];

export const LOC_W = 1600, LOC_H = 240;
export const PANORAMA_H = 240;

export const SMILE_COLS = 4;
export const SMILE_ROWS = 32;

export const FX = [
  { id: "fireworks", name: "Салют",   frame: 48,  col: 5, overlay: null },
  { id: "boom",      name: "Бум",     frame: 39,  col: 14, overlay: null },
  { id: "hearts",    name: "Сердечки",frame: 48,  col: 10, overlay: null },
  { id: "bubbles",   name: "Пузырьки",frame: 58,  col: 7,  overlay: null },
  { id: "sparkles",  name: "Блёстки", frame: 48,  col: 5,  overlay: null },
  { id: "flowers",   name: "Цветы",   frame: 48,  col: 10, overlay: null },
  { id: "kiss",      name: "Поцелуй", frame: 48,  col: 4,  overlay: "kiss-overlay" },
  { id: "tomato",    name: "Помидор", frame: 48,  col: 6,  overlay: "tomato-overlay" },
  { id: "slime",     name: "Слайм",   frame: 48,  col: 5,  overlay: "slime-overlay" },
  { id: "fireball",  name: "Огненный шар", frame: 80, col: 3, overlay: null },
  { id: "valentine", name: "Валентинка", frame: 48, col: 5, overlay: "valentine-overlay" },
];

export const NIGHT_FROM = 20, NIGHT_TO = 7;

export const NICK_COLORS = [
  "#FF6D2E", "#13D64E", "#2EDCFF", "#F52EFF", "#FFAF2E",
  "#FF2E5E", "#8A2EFF", "#26B1FF", "#FFC400", "#5E44FF",
];

export const NOTES = [
  "Привет! Как дела?",
  "Кто сегодня играет?",
  "Загляни в мою звёзду клуба!",
  "Ура, я тут!",
  "Кто-нибудь на видеопокер?",
  "Спокойной ночи, друзья!",
  "Хочу салют! 🎉",
  "А вот и я!",
];