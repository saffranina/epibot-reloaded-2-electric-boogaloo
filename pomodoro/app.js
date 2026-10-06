'use strict';

const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, autoStart: false, sound: true, keepAwake: true, buddy: 'ambos' };
const LABELS = { focus: 'Enfoque', short: 'Pausa corta', long: 'Pausa larga' };
const RING_LEN = 2 * Math.PI * 100;

const $ = (sel) => document.querySelector(sel);
const els = {
  time: $('#time'), status: $('#status'), ring: $('#ringFg'),
  start: $('#startBtn'), reset: $('#resetBtn'), skip: $('#skipBtn'),
  taskBtn: $('#taskBtn'), noteBtn: $('#noteBtn'), log: $('#log'),
  tasksDialog: $('#tasksDialog'), noteDialog: $('#noteDialog'),
  count: $('#statCount'), minutes: $('#statMinutes'), streak: $('#statStreak'), dots: $('#cycleDots'),
  statsBtn: $('#statsBtn'), statCards: $('#statCards'), statsDialog: $('#statsDialog'),
  settings: $('#settings'), settingsBtn: $('#settingsBtn'),
  notifyBtn: $('#notifyBtn'), clearBtn: $('#clearBtn'), installHint: $('#installHint'),
  stage: $('#stage'), bubble: $('#bubble'),
};

// localStorage puede fallar (modo privado), así que todo pasa por estos helpers.
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

const dayKey = (d) => d.toLocaleDateString('sv'); // YYYY-MM-DD en hora local
const todayKey = () => dayKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

let settings = { ...DEFAULTS, ...load('settings', {}) };
let history = load('history', {});
// El estado guarda la hora de fin (no un contador), así el tiempo sigue siendo
// correcto aunque iOS congele la app en segundo plano.
let state = load('state', null) || { mode: 'focus', endsAt: null, remaining: settings.focus * 60, done: 0 };

// Lista de tareas en orden de importancia (la primera es la más importante).
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let tasks = load('tasks', null);
if (!tasks) {
  // Migrar la tarea suelta de versiones anteriores.
  const old = String(load('task', '')).trim();
  tasks = old ? [{ id: uid(), title: old, est: 1, done: 0, completed: false }] : [];
  save('tasks', tasks);
}
let currentId = load('currentTask', null);
let notes = load('notes', []); // distracciones anotadas: { id, text, time }

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
  renderTaskBtn();
  renderScene();
}

function renderStats() {
  const today = history[todayKey()] || [];
  const focus = today.filter((e) => e.mode === 'focus');
  els.count.textContent = focus.length;
  els.minutes.textContent = focus.reduce((sum, e) => sum + e.minutes, 0);
  els.streak.textContent = streakNow();
  const pos = state.done % settings.every;
  els.dots.replaceChildren(...Array.from({ length: settings.every }, (_, i) => {
    const dot = document.createElement('i');
    if (i < pos) dot.className = 'on';
    else if (i === pos && state.mode === 'focus') dot.className = 'now';
    return dot;
  }));
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

function start({ quiet = false } = {}) {
  // Al encadenar automáticamente, ya sonó el aviso de fin: no se suma el de inicio.
  if (quiet) unlockAudio(); else play('inicio');
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
  if (autoStart) start({ quiet: true }); else { releaseWakeLock(); render(); }
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
  let reachedEstimate = false;
  if (finished === 'focus') {
    state.done += 1;
    const t = currentTask();
    if (t) { t.done += 1; reachedEstimate = t.done === t.est; saveTasks(); }
    const d = new Date();
    const day = todayKey();
    (history[day] ||= []).push({
      mode: 'focus', minutes: settings.focus, task: currentTask()?.title || '', taskId: currentTask()?.id,
      time: d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    });
    // Conservar poco más de un año para las estadísticas.
    history = Object.fromEntries(Object.entries(history).sort().slice(-400));
    save('history', history);
  }
  const next = finished === 'focus' ? (state.done % settings.every === 0 ? 'long' : 'short') : 'focus';
  alertUser(finished, next);
  setMode(next, settings.autoStart);
  if (finished === 'focus') {
    react('celebra');
    // Primer pomodoro del día que alarga la racha: lo festejan.
    const n = streakNow();
    if (focusOf(todayKey()).length === 1 && n >= 2) say(`¡Racha de ${n} días! 🔥`);
    else if (reachedEstimate) say('¡Llegaste a lo estimado! ¿Ya está lista? ✓');
  }
}

// Saltar no cuenta como pomodoro completado.
function skip() {
  setMode(state.mode === 'focus' ? 'short' : 'focus');
}

/* ---------- Personajes ---------- */

// Cada escena dice qué dibujo usar con "los dos" (duo) o con uno solo (single),
// cómo se mueve y qué pueden decir.
const SCENES = {
  listo:    { duo: ['parado', 'parado'], single: 'parado', anim: 'breathe',
              says: ['¿Empezamos?', 'Un pomodoro a la vez ✨', '¿En qué trabajamos hoy?', 'Libreta lista ✍️'] },
  enfoque:  { duo: ['duo-leen', 'duo-escriben'], single: 'camina', anim: 'walk', duoAnim: 'breathe',
              says: ['Concentración total', 'Shh… estamos trabajando', '¡Tú puedes!', 'Paso a paso', 'Nada de redes, eh 👀'] },
  pausado:  { duo: ['sentado', 'sentado'], single: 'sentado', anim: 'breathe',
              says: ['Aquí esperamos', '¿Seguimos cuando quieras?', 'Pausa técnica'] },
  corta:    { duo: ['duo-cafe'], single: 'guino', anim: 'breathe',
              says: ['Un cafecito ☕', 'Estira las piernas', 'Toma agua 💧', 'Respira hondo'] },
  larga:    { duo: ['dormido', 'dormido'], single: 'dormido', anim: 'sleep',
              says: ['Zzz…', 'Descanso bien merecido', 'Cierra los ojos un ratito'] },
  celebra:  { duo: ['duo-beso', 'duo-corazon'], single: 'guino', anim: 'hop', hearts: true,
              says: ['¡Lo lograste! 💛', '¡Bien hecho!', '¡Un pomodoro más!', 'Orgullo total ❤️'] },
  enojado:  { duo: ['enojado', 'enojado'], single: 'enojado', anim: 'shake',
              says: ['¡Oye!', '¿¡Otra vez desde cero!?', 'Hmph.', '¡Íbamos tan bien!'] },
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let reaction = null;     // escena pasajera (celebra / enojado)
let reactionTimer = null;
let currentKey = '';

function sceneName() {
  if (reaction) return reaction;
  if (state.mode === 'short') return 'corta';
  if (state.mode === 'long') return 'larga';
  if (isRunning()) return 'enfoque';
  return remainingNow() < duration(state.mode) ? 'pausado' : 'listo';
}

function sceneImages(scene) {
  const who = settings.buddy;
  if (who !== 'ambos') return [`${who}-${scene.single}`];
  // Las escenas de dos personas alternan entre pomodoros; las de a uno van lado a lado.
  if (scene.duo.length === 2 && scene.duo[0] === scene.duo[1]) return [`rubio-${scene.duo[0]}`, `rojo-${scene.duo[0]}`];
  return [scene.duo[state.done % scene.duo.length]];
}

function renderScene() {
  const name = sceneName();
  const scene = SCENES[name];
  const imgs = sceneImages(scene);
  const key = `${name}|${imgs.join()}`;
  if (key === currentKey) return;
  const changedScene = !currentKey.startsWith(`${name}|`);
  currentKey = key;

  const stage = els.stage;
  stage.querySelectorAll('.fig, .zzz').forEach((n) => n.remove());
  imgs.forEach((src) => {
    const img = document.createElement('img');
    img.className = 'fig';
    img.src = `img/${src}.webp`;
    img.alt = '';
    img.decoding = 'async';
    stage.append(img);
  });
  const anim = imgs.length === 1 && settings.buddy === 'ambos' && scene.duoAnim ? scene.duoAnim : scene.anim;
  stage.className = `stage ${anim}${imgs.length > 1 ? ' pair' : ''}`;
  if (anim !== 'shake' && anim !== 'hop') {
    void stage.offsetWidth; // reinicia la animación de entrada
    stage.classList.add('enter');
  }
  if (anim === 'sleep') {
    const z = document.createElement('div');
    z.className = 'zzz';
    z.innerHTML = '<span>z</span><span>z</span><span>Z</span>';
    stage.append(z);
  }
  if (scene.hearts) hearts();
  if (changedScene) {
    say((name === 'corta' || name === 'larga') && notes.length
      ? `Anotaste ${plural(notes.length, 'cosa', 'cosas')} 📝 ¿Las revisamos?` : pick(scene.says));
  }
}

function say(text) {
  els.bubble.textContent = '';
  void els.bubble.offsetWidth;
  els.bubble.textContent = text;
}

function hearts() {
  let box = els.stage.querySelector('.hearts');
  if (!box) { box = document.createElement('div'); box.className = 'hearts'; els.stage.append(box); }
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('span');
    h.textContent = pick(['♥', '❤', '💛']);
    h.style.left = `${15 + Math.random() * 70}%`;
    h.style.animationDelay = `${i * 0.18}s`;
    box.append(h);
    setTimeout(() => h.remove(), 2600 + i * 180);
  }
}

// Escena pasajera: se muestra unos segundos y vuelve a la normal.
function react(name) {
  clearTimeout(reactionTimer);
  reaction = name;
  currentKey = '';
  renderScene();
  reactionTimer = setTimeout(() => { reaction = null; render(); }, name === 'celebra' ? 6000 : 2600);
}

// Tocar a los personajes: saltito y una frase nueva.
els.stage.addEventListener('click', () => {
  if (reaction) return;
  const stage = els.stage;
  const base = stage.className.replace(/\s*\b(hop|enter)\b/g, '');
  stage.className = base;
  void stage.offsetWidth;
  stage.classList.add('hop');
  setTimeout(() => { stage.className = base; }, 520);
  say(pick(SCENES[sceneName()].says));
});

/* ---------- Tareas ---------- */

const saveTasks = () => { save('tasks', tasks); save('currentTask', currentId); };
const pending = () => tasks.filter((t) => !t.completed);

// La tarea elegida; si no hay, la más importante sin terminar.
function currentTask() {
  let t = tasks.find((x) => x.id === currentId && !x.completed);
  if (!t) { t = pending()[0] || null; currentId = t ? t.id : null; }
  return t;
}

function tomatoes(t) {
  const html = [];
  const shown = Math.min(Math.max(t.est, t.done), 10);
  for (let i = 0; i < shown; i++) {
    html.push(`<i class="${i >= t.done ? 'todo' : i >= t.est ? 'extra' : ''}">🍅</i>`);
  }
  return html.join('');
}

function renderTaskBtn() {
  const t = currentTask();
  els.taskBtn.classList.toggle('empty', !t);
  $('#taskTitle').textContent = t ? t.title : '¿En qué vas a trabajar?';
  $('#taskTomatoes').innerHTML = t ? tomatoes(t) : '';
  const badge = $('#noteBadge');
  badge.hidden = !notes.length;
  badge.textContent = notes.length;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function actionBtn(label, aria, fn, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); saveTasks(); renderTasks(); renderTaskBtn(); });
  return b;
}

function renderTasks() {
  const cur = currentTask();
  const list = $('#taskList');
  const open = pending();
  if (!open.length) {
    list.replaceChildren(el('li', 'empty', 'Sin tareas pendientes. Agrega la primera arriba ✨'));
  } else {
    list.replaceChildren(...open.map((t, i) => {
      const li = el('li', `task-item${t === cur ? ' current' : ''}`);
      const main = el('button', 'task-main');
      main.type = 'button';
      const tom = el('span', 'tomatoes');
      tom.innerHTML = tomatoes(t);
      main.append(el('span', 'num', i + 1), el('span', 'name', t.title), tom);
      main.addEventListener('click', () => { currentId = t.id; saveTasks(); renderTasks(); renderTaskBtn(); });
      li.append(main);
      if (t === cur) {
        li.append(el('div', 'now-label', `Trabajando en esta · ${t.done} de ${plural(t.est, 'pomodoro', 'pomodoros')}`));
        const idx = tasks.indexOf(t);
        const swap = (dir) => {
          // Mover respecto a la tarea pendiente vecina (las completadas no cuentan).
          const other = open[i + dir];
          if (!other) return;
          const j = tasks.indexOf(other);
          [tasks[idx], tasks[j]] = [tasks[j], tasks[idx]];
        };
        const row = el('div', 'row-actions');
        row.append(
          actionBtn('↑', 'Subir prioridad', () => swap(-1)),
          actionBtn('↓', 'Bajar prioridad', () => swap(1)),
          actionBtn('−', 'Menos pomodoros', () => { t.est = Math.max(1, t.est - 1); }),
          el('span', 'est-label', `${t.est} 🍅`),
          actionBtn('+', 'Más pomodoros', () => { t.est = Math.min(12, t.est + 1); }),
          el('span', 'sep'),
          actionBtn('🗑', 'Borrar tarea', () => {
            if (confirm(`¿Borrar "${t.title}"?`)) tasks.splice(tasks.indexOf(t), 1);
          }, 'del'),
          actionBtn('✓ Lista', 'Marcar como lista', () => {
            t.completed = true;
            say('¡Tarea lista! 💛');
          }, 'ok'),
        );
        li.append(row);
      }
      return li;
    }));
  }

  const done = tasks.filter((t) => t.completed);
  $('#doneBox').hidden = !done.length;
  $('#doneCount').textContent = done.length;
  $('#doneList').replaceChildren(...done.map((t) => {
    const li = el('li', 'task-item');
    const main = el('div', 'task-main');
    const tom = el('span', 'tomatoes');
    tom.innerHTML = tomatoes(t);
    main.append(el('span', 'num', '✓'), el('span', 'name', t.title), tom,
      actionBtn('↺', 'Volver a pendientes', () => { t.completed = false; }));
    li.append(main);
    return li;
  }));

  const nl = $('#noteList');
  if (!notes.length) {
    nl.replaceChildren(el('li', 'empty', 'Nada anotado. ¡Buena concentración! ✨'));
  } else {
    nl.replaceChildren(...notes.map((n) => {
      const li = el('li');
      const doneBtn = actionBtn('✓', 'Ya la atendí', () => {
        notes = notes.filter((x) => x !== n);
        save('notes', notes);
      });
      li.append(el('span', '', n.text), el('small', '', n.time), doneBtn);
      return li;
    }));
  }
}

function openTasks() {
  renderTasks();
  els.tasksDialog.showModal();
  els.tasksDialog.scrollTop = 0;
}
els.taskBtn.addEventListener('click', openTasks);
els.tasksDialog.addEventListener('close', render);

let newEst = 1;
document.querySelectorAll('.add-task .est button').forEach((b) => b.addEventListener('click', () => {
  newEst = Math.min(12, Math.max(1, newEst + Number(b.dataset.est)));
  $('#newEst').textContent = newEst;
}));
$('#addTask').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#newTask');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  tasks.push({ id: uid(), title, est: newEst, done: 0, completed: false });
  if (!currentTask()) currentId = tasks[tasks.length - 1].id;
  input.value = '';
  newEst = 1;
  $('#newEst').textContent = 1;
  saveTasks();
  renderTasks();
  renderTaskBtn();
});
$('#clearDone').addEventListener('click', () => {
  if (!confirm('¿Borrar las tareas completadas?')) return;
  tasks = tasks.filter((t) => !t.completed);
  saveTasks();
  renderTasks();
});

/* ---------- Distracciones ---------- */

els.noteBtn.addEventListener('click', () => {
  $('#noteText').value = '';
  els.noteDialog.showModal();
  $('#noteText').focus();
});
$('#noteCancel').addEventListener('click', () => els.noteDialog.close());
els.noteDialog.addEventListener('close', () => {
  const text = $('#noteText').value.trim();
  if (els.noteDialog.returnValue !== 'save' || !text) return;
  els.noteDialog.returnValue = '';
  notes.push({ id: uid(), text, time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) });
  save('notes', notes);
  renderTaskBtn();
  say(isRunning() && state.mode === 'focus' ? 'Anotado 📝 ¡De vuelta a la tarea!' : 'Anotado 📝');
});

/* ---------- Estadísticas y racha ---------- */

const focusOf = (key) => (history[key] || []).filter((e) => e.mode === 'focus');
const minutesOf = (key) => focusOf(key).reduce((sum, e) => sum + e.minutes, 0);

// Días seguidos con al menos un pomodoro. Si hoy aún no hay, la racha sigue viva hasta ayer.
function streakNow() {
  let d = new Date();
  if (!focusOf(dayKey(d)).length) d = addDays(d, -1);
  let n = 0;
  while (focusOf(dayKey(d)).length) { n++; d = addDays(d, -1); }
  return n;
}

function streakBest() {
  const days = Object.keys(history).filter((k) => focusOf(k).length).sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    run = prev && dayKey(addDays(parseKey(prev), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

function fmtDur(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d) => d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '');

// Suma pomodoros y minutos de los días [desde, hoy].
function totalsSince(from) {
  let p = 0, m = 0;
  for (let d = new Date(from); dayKey(d) <= todayKey(); d = addDays(d, 1)) {
    p += focusOf(dayKey(d)).length;
    m += minutesOf(dayKey(d));
  }
  return { p, m };
}

let chartRange = 7;

function renderStatsPage() {
  const now = new Date();
  const streak = streakNow();
  const doneToday = focusOf(todayKey()).length > 0;
  $('#streakNow').textContent = streak;
  $('#streakUnit').textContent = streak === 1 ? 'día' : 'días';
  $('#streakBest').textContent = plural(Math.max(streakBest(), streak), 'día', 'días');
  $('#streakMsg').textContent = streak === 0 ? 'Empieza hoy una racha nueva ✨'
    : doneToday ? '¡Hoy ya cuenta! 💛' : '¡Haz un pomodoro hoy para no perderla!';
  const who = settings.buddy;
  $('#streakImg').src = `img/${streak > 0 ? (who === 'ambos' ? 'duo-corazon' : `${who}-guino`) : (who === 'ambos' ? 'duo-cafe' : `${who}-sentado`)}.webp`;

  // Últimos 7 días como puntitos.
  $('#weekStrip').replaceChildren(...Array.from({ length: 7 }, (_, i) => {
    const d = addDays(now, i - 6);
    const li = document.createElement('li');
    const n = focusOf(dayKey(d)).length;
    li.className = `${n ? 'done' : ''} ${i === 6 ? 'today' : ''}`;
    const dot = document.createElement('i');
    dot.textContent = n ? (n > 9 ? '9+' : n) : '';
    li.append(dot, d.toLocaleDateString('es', { weekday: 'narrow' }));
    li.setAttribute('aria-label', `${shortDate(d)}: ${plural(n, 'pomodoro', 'pomodoros')}`);
    return li;
  }));

  // Tarjetas: semana (desde el lunes), mes, mejor día, total.
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const week = totalsSince(monday);
  const month = totalsSince(new Date(now.getFullYear(), now.getMonth(), 1));
  $('#tWeek').textContent = fmtDur(week.m);
  $('#tWeekP').textContent = plural(week.p, 'pomodoro', 'pomodoros');
  $('#tMonth').textContent = fmtDur(month.m);
  $('#tMonthP').textContent = plural(month.p, 'pomodoro', 'pomodoros');
  let best = null, totalP = 0, totalM = 0;
  for (const k of Object.keys(history)) {
    const m = minutesOf(k);
    totalP += focusOf(k).length; totalM += m;
    if (m && (!best || m > best.m)) best = { k, m };
  }
  $('#tBest').textContent = best ? fmtDur(best.m) : '—';
  $('#tBestD').textContent = best ? shortDate(parseKey(best.k)) : 'Aún nada';
  $('#tTotal').textContent = fmtDur(totalM);
  $('#tTotalP').textContent = plural(totalP, 'pomodoro', 'pomodoros');

  renderChart();
  renderTopTasks();
}

function niceStep(max) {
  return [5, 10, 15, 25, 30, 50, 60, 100, 120, 150, 200, 250, 300, 500].find((s) => max / s <= 4) || 600;
}

function renderChart() {
  const chart = $('#chart');
  const tip = $('#tip');
  tip.hidden = true;
  const now = new Date();
  const days = Array.from({ length: chartRange }, (_, i) => {
    const d = addDays(now, i - chartRange + 1);
    const k = dayKey(d);
    return { d, k, p: focusOf(k).length, m: minutesOf(k), today: i === chartRange - 1 };
  });

  // Tabla accesible (más reciente primero).
  $('#chartTable').replaceChildren(...days.slice().reverse().map((x) => {
    const tr = document.createElement('tr');
    for (const v of [shortDate(x.d), x.p, x.m]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    return tr;
  }));

  const max = Math.max(...days.map((x) => x.m));
  if (!max) {
    chart.innerHTML = `<div class="chart-empty">Todavía no hay pomodoros en ${chartRange === 7 ? 'esta semana' : 'estos 30 días'}.<br>¡El primero cuenta! 🍅</div>`;
    return;
  }

  const W = 340, H = 180, L = 30, R = 4, T = 18, B = 22;
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const pw = W - L - R, ph = H - T - B;
  const band = pw / chartRange;
  const bw = Math.min(24, chartRange === 7 ? band * 0.55 : band - 2);
  const y = (v) => T + ph - (v / top) * ph;
  const maxIdx = days.findIndex((x) => x.m === max);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutos de foco por día, últimos ${chartRange} días">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  days.forEach((x, i) => {
    const cx = L + band * i + band / 2;
    const h = (x.m / top) * ph, r = Math.min(4, h);
    const x0 = cx - bw / 2, yb = T + ph;
    svg += `<g class="col" data-i="${i}">`;
    if (x.m) {
      // Extremo de datos redondeado (4px), cuadrado en la base.
      svg += `<path class="bar${x.today ? ' now' : ''}" d="M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + bw - r} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + r} V${yb} Z"/>`;
    }
    if (i === maxIdx) svg += `<text class="val" x="${cx}" y="${yb - h - 5}" text-anchor="middle">${x.m}</text>`;
    const label = chartRange === 7 ? x.d.toLocaleDateString('es', { weekday: 'short' }).replace('.', '')
      : (x.today || (x.d.getDate() % 5 === 0 && i < chartRange - 3) ? String(x.d.getDate()) : '');
    if (label) svg += `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    svg += `<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${ph + B}"/></g>`;
  });
  svg += '</svg>';
  chart.innerHTML = svg;

  const show = (g) => {
    chart.querySelectorAll('.col.sel').forEach((c) => c.classList.remove('sel'));
    g.classList.add('sel');
    const x = days[Number(g.dataset.i)];
    tip.innerHTML = `<b>${shortDate(x.d)}</b> · ${plural(x.p, 'pomodoro', 'pomodoros')} · ${x.m} min`;
    tip.hidden = false;
    const card = chart.parentElement.getBoundingClientRect();
    const bar = (g.querySelector('.bar') || g.querySelector('.hit')).getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const left = Math.min(card.width - half - 6, Math.max(half + 6, bar.left + bar.width / 2 - card.left));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(bar.top - card.top - 8, 34)}px`;
  };
  chart.querySelectorAll('.col').forEach((g) => {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('click', () => show(g));
  });
  chart.querySelector('svg').addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') { tip.hidden = true; chart.querySelectorAll('.col.sel').forEach((c) => c.classList.remove('sel')); }
  });
}

function renderTopTasks() {
  const groups = new Map();
  for (let i = 0; i < 30; i++) {
    for (const e of focusOf(dayKey(addDays(new Date(), -i)))) {
      const name = e.task || 'Sin título';
      const key = name.toLowerCase();
      const g = groups.get(key) || { name, p: 0, m: 0 };
      g.p++; g.m += e.minutes;
      groups.set(key, g);
    }
  }
  const top = [...groups.values()].sort((a, b) => b.m - a.m).slice(0, 5);
  const list = $('#topTasks');
  if (!top.length) {
    list.innerHTML = '<li class="chart-empty">Escribe en qué trabajas y aquí verás tus temas favoritos.</li>';
    return;
  }
  list.replaceChildren(...top.map((g) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.textContent = g.name;
    const val = document.createElement('span'); val.textContent = `${fmtDur(g.m)} · ${g.p} 🍅`;
    const meter = document.createElement('div'); meter.className = 'meter';
    const fill = document.createElement('i'); fill.style.width = `${(g.m / top[0].m) * 100}%`;
    meter.append(fill);
    li.append(name, val, meter);
    return li;
  }));
}

function openStats() {
  renderStatsPage();
  els.statsDialog.showModal();
  els.statsDialog.scrollTop = 0;
}
els.statsBtn.addEventListener('click', openStats);
els.statCards.addEventListener('click', openStats);
els.statCards.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStats(); } });
document.querySelectorAll('.range button').forEach((b) => b.addEventListener('click', () => {
  chartRange = Number(b.dataset.range);
  document.querySelectorAll('.range button').forEach((x) => x.classList.toggle('active', x === b));
  renderChart();
}));

/* ---------- Avisos: sonido, vibración y notificación ---------- */

let audioCtx = null;

// iOS sólo deja sonar audio después de un toque, y lo vuelve a pausar cuando la app
// pasa a segundo plano. Por eso se "despierta" en cada toque sobre la pantalla.
function unlockAudio(force = false) {
  if (!settings.sound && !force) return;
  try {
    // "transient": sonido corto tipo aviso; baja un momento la música en vez de cortarla.
    if (navigator.audioSession) navigator.audioSession.type = 'transient';
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch { audioCtx = null; }
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });

// Una campanita: tono base con un par de armónicos que se apagan suave.
function bell(freq, at, { dur = 1.4, vol = 0.32 } = {}) {
  const out = audioCtx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  out.connect(audioCtx.destination);
  [[1, 1], [2.01, 0.28], [3.02, 0.1]].forEach(([mult, level]) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  });
}

// Melodías (notas en Hz y en qué momento suenan).
const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };
const SOUNDS = {
  // Al empezar: dos notas cortitas hacia arriba.
  inicio: [[N.E5, 0, 0.7], [N.B5, 0.12, 0.9]],
  // Fin del enfoque: arpegio alegre, dos veces.
  finEnfoque: [[N.C6, 0, 1], [N.E6, 0.16, 1], [N.G6, 0.32, 1.6],
               [N.C6, 1.1, 1], [N.E6, 1.26, 1], [N.G6, 1.42, 2]],
  // Fin de la pausa: "a trabajar" más suave, hacia abajo y de vuelta arriba.
  finPausa: [[N.G5, 0, 1], [N.E5, 0.2, 1], [N.C6, 0.45, 1.8]],
};

function play(name, force = false) {
  if (!settings.sound && !force) return;
  unlockAudio(force);
  if (!audioCtx) return;
  const go = () => {
    const t = audioCtx.currentTime + 0.03;
    SOUNDS[name].forEach(([f, at, dur]) => bell(f, t + at, { dur }));
  };
  if (audioCtx.state === 'running') go();
  else audioCtx.resume().then(go).catch(() => {});
}

function alertUser(finished, next) {
  play(finished === 'focus' ? 'finEnfoque' : 'finPausa');
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
    buddy: f.elements.buddy.value,
  };
  save('settings', settings);
  // Si no está corriendo, aplicar la nueva duración de inmediato.
  if (!isRunning()) setMode(state.mode); else render();
  els.settings.returnValue = '';
});

/* ---------- Eventos ---------- */

els.start.addEventListener('click', () => (isRunning() ? pause() : start()));
els.reset.addEventListener('click', () => { setMode(state.mode); react('enojado'); });
els.skip.addEventListener('click', () => { skip(); react('enojado'); });
els.settingsBtn.addEventListener('click', openSettings);
els.notifyBtn.addEventListener('click', requestNotifications);
$('#testSound').addEventListener('click', (e) => { e.preventDefault(); play('finEnfoque', true); });
els.clearBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar el historial de hoy?')) return;
  delete history[todayKey()];
  state.done = 0;
  save('history', history);
  persist();
  render();
});
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

// Precargar los dibujos para que cambien sin parpadeo.
['parado', 'camina', 'sentado', 'guino', 'dormido', 'enojado'].forEach((n) => {
  ['rubio', 'rojo'].forEach((w) => { new Image().src = `img/${w}-${n}.webp`; });
});
['leen', 'escriben', 'cafe', 'beso', 'corazon'].forEach((n) => { new Image().src = `img/duo-${n}.webp`; });

if (isRunning()) {
  if (remainingNow() <= 0) finish(); else runTick();
}
render();
