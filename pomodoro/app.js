'use strict';

const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, autoStart: false, sound: true, keepAwake: true };
const LABELS = { focus: 'Enfoque', short: 'Pausa corta', long: 'Pausa larga' };
const RING_LEN = 2 * Math.PI * 100;

const $ = (sel) => document.querySelector(sel);
const els = {
  time: $('#time'), status: $('#status'), ring: $('#ringFg'),
  start: $('#startBtn'), reset: $('#resetBtn'), skip: $('#skipBtn'),
  task: $('#task'), log: $('#log'),
  count: $('#statCount'), minutes: $('#statMinutes'), cycle: $('#statCycle'),
  settings: $('#settings'), settingsBtn: $('#settingsBtn'),
  notifyBtn: $('#notifyBtn'), clearBtn: $('#clearBtn'), installHint: $('#installHint'),
};

// localStorage puede fallar (modo privado), así que todo pasa por estos helpers.
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

const todayKey = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

let settings = { ...DEFAULTS, ...load('settings', {}) };
let history = load('history', {});
// El estado guarda la hora de fin (no un contador), así el tiempo sigue siendo
// correcto aunque iOS congele la app en segundo plano.
let state = load('state', null) || { mode: 'focus', endsAt: null, remaining: settings.focus * 60, done: 0 };
els.task.value = load('task', '');

let tick = null;
let wakeLock = null;

const duration = (mode) => settings[mode] * 60;
const isRunning = () => state.endsAt !== null;
const remainingNow = () => isRunning() ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)) : state.remaining;
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function persist() { save('state', state); }

function render() {
  const rem = remainingNow();
  els.time.textContent = fmt(rem);
  document.title = isRunning() ? `${fmt(rem)} · ${LABELS[state.mode]}` : 'Foco';
  els.ring.style.strokeDashoffset = RING_LEN * (1 - rem / duration(state.mode));
  els.start.textContent = isRunning() ? 'Pausar' : (rem < duration(state.mode) ? 'Seguir' : 'Empezar');
  els.status.textContent = isRunning()
    ? (state.mode === 'focus' ? 'Concentración' : 'Descansa un poco')
    : (rem < duration(state.mode) ? 'En pausa' : 'Listo para empezar');
  document.body.dataset.mode = state.mode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  renderStats();
}

function renderStats() {
  const today = history[todayKey()] || [];
  const focus = today.filter((e) => e.mode === 'focus');
  els.count.textContent = focus.length;
  els.minutes.textContent = focus.reduce((sum, e) => sum + e.minutes, 0);
  els.cycle.textContent = `${(state.done % settings.every) + 1}/${settings.every}`;
  els.log.replaceChildren(...focus.slice(-5).reverse().map((e) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = e.task || 'Sin título';
    const t = document.createElement('span');
    t.textContent = `${e.time} · ${e.minutes} min`;
    li.append(b, t);
    return li;
  }));
}

function start() {
  unlockAudio();
  state.endsAt = Date.now() + remainingNow() * 1000;
  persist();
  runTick();
  requestWakeLock();
  render();
}

function pause() {
  state.remaining = remainingNow();
  state.endsAt = null;
  persist();
  clearInterval(tick);
  releaseWakeLock();
  render();
}

function setMode(mode, autoStart = false) {
  clearInterval(tick);
  state.mode = mode;
  state.endsAt = null;
  state.remaining = duration(mode);
  persist();
  if (autoStart) start(); else { releaseWakeLock(); render(); }
}

function runTick() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (remainingNow() <= 0) finish(); else render();
  }, 250);
}

function finish() {
  clearInterval(tick);
  const finished = state.mode;
  if (finished === 'focus') {
    state.done += 1;
    const d = new Date();
    const day = todayKey();
    (history[day] ||= []).push({
      mode: 'focus', minutes: settings.focus, task: els.task.value.trim(),
      time: d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    });
    // Conservar sólo los últimos 30 días.
    history = Object.fromEntries(Object.entries(history).sort().slice(-30));
    save('history', history);
  }
  const next = finished === 'focus' ? (state.done % settings.every === 0 ? 'long' : 'short') : 'focus';
  alertUser(finished, next);
  setMode(next, settings.autoStart);
}

// Saltar no cuenta como pomodoro completado.
function skip() {
  setMode(state.mode === 'focus' ? 'short' : 'focus');
}

/* ---------- Avisos: sonido, vibración y notificación ---------- */

let audioCtx = null;
// iOS sólo permite audio después de un toque del usuario, así que se "desbloquea" al empezar.
function unlockAudio() {
  if (!settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}

function chime() {
  if (!settings.sound || !audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((offset, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = [660, 880, 990][i];
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.6);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.65);
  });
}

function alertUser(finished, next) {
  chime();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  const title = finished === 'focus' ? '¡Pomodoro terminado!' : 'Fin de la pausa';
  const body = `Sigue: ${LABELS[next]}`;
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'foco' }))
      .catch(() => {});
  }
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('Este navegador no permite notificaciones. En iPhone, primero instala la app en la pantalla de inicio (iOS 16.4 o superior).');
    return;
  }
  const result = await Notification.requestPermission();
  updateNotifyBtn();
  if (result === 'denied') alert('Las notificaciones están bloqueadas. Puedes activarlas en Ajustes del sistema.');
}

function updateNotifyBtn() {
  const granted = 'Notification' in window && Notification.permission === 'granted';
  els.notifyBtn.textContent = granted ? 'Notificaciones activadas ✓' : 'Activar notificaciones';
  els.notifyBtn.disabled = granted;
}

/* ---------- Pantalla encendida ---------- */

async function requestWakeLock() {
  if (!settings.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }

/* ---------- Ajustes ---------- */

function openSettings() {
  const f = els.settings.querySelector('form');
  for (const [k, v] of Object.entries(settings)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v; else input.value = v;
  }
  updateNotifyBtn();
  els.settings.showModal();
}

els.settings.addEventListener('close', () => {
  if (els.settings.returnValue !== 'save') return;
  const f = els.settings.querySelector('form');
  const num = (k, min, max) => Math.min(max, Math.max(min, parseInt(f.elements[k].value, 10) || DEFAULTS[k]));
  settings = {
    focus: num('focus', 1, 120), short: num('short', 1, 60), long: num('long', 1, 60), every: num('every', 2, 10),
    autoStart: f.elements.autoStart.checked, sound: f.elements.sound.checked, keepAwake: f.elements.keepAwake.checked,
  };
  save('settings', settings);
  // Si no está corriendo, aplicar la nueva duración de inmediato.
  if (!isRunning()) setMode(state.mode); else render();
  els.settings.returnValue = '';
});

/* ---------- Eventos ---------- */

els.start.addEventListener('click', () => (isRunning() ? pause() : start()));
els.reset.addEventListener('click', () => setMode(state.mode));
els.skip.addEventListener('click', skip);
els.settingsBtn.addEventListener('click', openSettings);
els.notifyBtn.addEventListener('click', requestNotifications);
els.clearBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar el historial de hoy?')) return;
  delete history[todayKey()];
  state.done = 0;
  save('history', history);
  persist();
  render();
});
els.task.addEventListener('input', () => save('task', els.task.value));
els.task.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.task.blur(); });
document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === state.mode) return;
  if (isRunning() && !confirm('Hay un temporizador en marcha. ¿Cambiar de modo?')) return;
  setMode(b.dataset.mode);
}));

// Al volver a la app (iOS la congela en segundo plano) se recalcula todo.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (isRunning()) {
    if (remainingNow() <= 0) finish(); else { runTick(); requestWakeLock(); }
  }
  render();
});

/* ---------- Arranque ---------- */

const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
els.installHint.hidden = standalone || !isIOS;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (isRunning()) {
  if (remainingNow() <= 0) finish(); else runTick();
}
render();
