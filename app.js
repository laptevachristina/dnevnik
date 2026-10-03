'use strict';

/* ---------- утилиты ---------- */

const $ = id => document.getElementById(id);
const SKEY = 'dnevnik_v1';

function blank() {
  return { profile: {}, period: {}, notes: {}, food: {}, steps: {}, workouts: {}, weight: [], measures: [] };
}
function load() {
  try { const d = JSON.parse(localStorage.getItem(SKEY)); if (d && typeof d === 'object') return d; } catch (e) {}
  return blank();
}
let DB = load();
let pendImport = null;
let saveWarned = false;
function save() {
  try { localStorage.setItem(SKEY, JSON.stringify(DB)); }
  catch (e) { if (!saveWarned) { saveWarned = true; toast('Не получается сохранить — возможно, открыта приватная вкладка'); } }
  if (!suppressDirty) markDirty();
}

/* ---------- кабинет на сервере ---------- */

const API = 'https://dnevnik.72.56.9.229.sslip.io/api';
const TKEY = 'dnevnik_token', LKEY = 'dnevnik_login', SYNC = 'dnevnik_sync', DIRTY = 'dnevnik_dirty';
let token = localStorage.getItem(TKEY) || '';
let myLogin = localStorage.getItem(LKEY) || '';
let pushT = null, syncing = false, suppressDirty = false;

function markDirty() {
  localStorage.setItem(DIRTY, String(Date.now()));
  schedulePush();
}
function schedulePush() {
  if (!token || pushT) return;
  pushT = setTimeout(() => { pushT = null; pushNow(true); }, 2500);
}
async function api(ep, body, auth) {
  const h = { 'Content-Type': 'application/json' };
  if (auth && token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + ep, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { localLogout(); throw new Error('session'); }
  return r.json();
}
function applyDoc(doc) {
  const b = blank();
  for (const k in b) if (doc[k] !== undefined) b[k] = doc[k];
  suppressDirty = true; DB = b; pendImport = null; save(); suppressDirty = false;
}
function localLogout() {
  token = ''; myLogin = '';
  localStorage.removeItem(TKEY); localStorage.removeItem(LKEY);
}
function hasLocalData() {
  return !!(Object.keys(DB.notes || {}).length || (DB.weight || []).length ||
    Object.keys(DB.food || {}).length || Object.keys(DB.period || {}).length ||
    (DB.measures || []).length || Object.keys(DB.steps || {}).length || Object.keys(DB.workouts || {}).length);
}
async function pushNow(silent) {
  if (!token || syncing) return;
  syncing = true;
  try {
    const r = await api('/push', { doc: DB }, true);
    if (r.ok) {
      localStorage.setItem(SYNC, String(r.ts));
      localStorage.removeItem(DIRTY);
      if (!silent) { toast('Отправлено на сервер'); if (cur === 'prof') renderProf(); }
    } else if (!silent) toast(r.error || 'Не получилось отправить');
  } catch (e) { if (!silent) toast('Нет связи с сервером'); }
  syncing = false;
}
async function pullNow(silent) {
  if (!token) return null;
  try {
    const r = await api('/pull', null, true);
    if (!r.ok) { if (!silent) toast(r.error || 'Не получилось загрузить'); return null; }
    localStorage.setItem(SYNC, String(r.ts));
    return r;
  } catch (e) { if (!silent) toast('Нет связи с сервером'); return null; }
}
async function afterLogin(r, mode) {
  token = r.token; myLogin = r.login;
  localStorage.setItem(TKEY, token); localStorage.setItem(LKEY, myLogin);
  closeSheet();
  const p = await pullNow(true);
  if (p && p.doc && hasLocalData()) {
    openSheet(
      '<div class="sheet-head"><b>Две копии записей</b></div>' +
      '<div class="hint" style="margin:6px 0 14px">На этом устройстве есть записи, и в кабинете на сервере тоже. Какую оставить?</div>' +
      '<button class="btn pink" style="width:100%;margin-bottom:8px" onclick="keepServer()">Загрузить с сервера (местные пропадут)</button>' +
      '<button class="btn ghost" style="width:100%" onclick="keepLocal()">Отправить местные на сервер</button>'
    );
    return;
  }
  if (p && p.doc) {
    applyDoc(p.doc);
    toast('Записи загружены. Вы вошли как ' + r.login);
  } else if (hasLocalData()) {
    pushNow(true);
    toast((mode === 'reg' ? 'Кабинет создан' : 'Вход выполнен') + ', записи отправлены на сервер');
  } else {
    toast((mode === 'reg' ? 'Кабинет создан' : 'Вход выполнен') + '. Вы вошли как ' + r.login);
  }
  RENDER[cur]();
}
function keepServer() {
  closeSheet();
  pullNow(true).then(p => {
    if (p && p.doc) { applyDoc(p.doc); localStorage.removeItem(DIRTY); toast('Загружено с сервера'); RENDER[cur](); }
    else toast('На сервере пусто');
  });
}
function keepLocal() { closeSheet(); pushNow(false); RENDER[cur](); }
async function doLogin(mode) {
  const l = $('aLogin').value.trim().toLowerCase(), p = $('aPass').value;
  if (!l || !p) { toast('Заполните логин и пароль'); return; }
  try {
    const r = await api(mode === 'reg' ? '/reg' : '/login', { login: l, password: p });
    if (r.ok) afterLogin(r, mode); else toast(r.error || 'Не получилось');
  } catch (e) { toast('Нет связи с сервером'); }
}
function logoutCabinet() {
  localLogout();
  toast('Вы вышли. Записи остались на этом устройстве');
  renderProf();
}
function authSheet(mode) {
  closeSheet();
  openSheet(
    '<div class="sheet-head"><b>' + (mode === 'reg' ? 'Новый кабинет' : 'Вход в кабинет') + '</b><button class="btn small ghost" onclick="closeSheet()">Закрыть</button></div>' +
    '<label class="f">Логин, латиница</label><input id="aLogin" class="inp" autocapitalize="none" autocomplete="username" placeholder="например, kristina">' +
    '<label class="f">Пароль, минимум 6 символов</label><input id="aPass" class="inp" type="password" autocomplete="current-password">' +
    '<div style="margin-top:12px"><button class="btn pink" style="width:100%" onclick="doLogin(\'' + mode + '\')">' + (mode === 'reg' ? 'Создать кабинет' : 'Войти') + '</button></div>' +
    '<div class="hint" style="margin-top:10px">' + (mode === 'reg'
      ? 'Уже есть кабинет? <a href="#" onclick="authSheet(\'in\');return false">Войти</a>'
      : 'Нет кабинета? <a href="#" onclick="authSheet(\'reg\');return false">Создать</a>') + '</div>'
  );
}
function cabinetCard() {
  if (token) {
    const waiting = localStorage.getItem(DIRTY) ? ', есть неотправленные записи' : '';
    return '<div class="card"><h2>Кабинет</h2>' +
      '<div class="hint" style="margin:0 0 10px">Вы вошли как <b>' + esc(myLogin) + '</b>. Записи хранятся на сервере' + waiting + '.</div>' +
      '<div class="row"><button class="btn" onclick="pushNow(false)">Синхронизировать</button><button class="btn ghost" onclick="logoutCabinet()">Выйти</button></div></div>';
  }
  return '<div class="card"><h2>Кабинет на сервере</h2>' +
    '<div class="hint" style="margin:0 0 10px">Записи в кабинете доступны с любого устройства и открываются только после пароля.</div>' +
    '<div class="row"><button class="btn pink" onclick="authSheet(\'reg\')">Создать</button><button class="btn ghost" onclick="authSheet(\'in\')">Войти</button></div></div>';
}

/* ---------- перенос старых записей ---------- */

function mkDate(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
function parseD(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/);
  if (!m) return null;
  let y = m[3] ? +m[3] : null;
  if (y != null && y < 100) y += 2000;
  if (y == null) {
    y = new Date().getFullYear();
    if (mkDate(y, +m[2], +m[1]) > new Date()) y--;
  }
  return mkDate(y, +m[2], +m[1]);
}
function parsePeriodLine(part) {
  let s = part.replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const iso = /^\d{4}-/.test(s);
  const p = iso ? s.split(/\s+-\s+/) : s.split(/\s*-\s*|\s+до\s+/);
  const a = parseD(p[0]);
  if (!a) return null;
  const b = p.length > 1 ? parseD(p[p.length - 1]) : null;
  if (p.length > 1 && !b) return null;
  if (b && b < a) return null;
  return { a, b: b || null };
}
function parseWeightLine(part) {
  const m = part.match(/(\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2})\D{0,5}(\d+[.,]?\d{0,2})/);
  if (!m) return null;
  const d = parseD(m[1]);
  const kg = parseFloat(m[2].replace(',', '.'));
  if (!d || isNaN(kg) || kg < 25 || kg > 300) return null;
  return { d, kg };
}
function impParse() {
  const per = [], wgt = [];
  $('impPer').value.split('\n').forEach(line => {
    line.split(/[,;]+/).forEach(part => {
      const r = parsePeriodLine(part);
      if (r) per.push(r);
    });
  });
  $('impW').value.split('\n').forEach(line => {
    line.split(/;+/).forEach(part => {
      const r = parseWeightLine(part);
      if (r) wgt.push(r);
    });
  });
  return { per, wgt };
}
function impCount() {
  const el = $('impCnt');
  if (!el) return;
  const { per, wgt } = impParse();
  el.textContent = per.length || wgt.length
    ? 'Нашёл: месячные — ' + per.length + ', вес — ' + wgt.length
    : '';
}
function importHistorySheet() {
  const dur = (cycleInfo() && cycleInfo().avgDur) || 4;
  openSheet(
    '<div class="sheet-head"><b>Перенос старых записей</b><button class="btn small ghost" onclick="closeSheet()">Закрыть</button></div>' +
    '<div class="hint" style="margin:4px 0 10px">Вставьте списки из заметок одним куском — я разложу по календарю. Понимаю даты: 5.01, 05.01.2026, 2026-01-05 и периоды 5.01-9.01.</div>' +
    '<label class="f">Месячные — дата или период в строке, можно через запятую</label>' +
    '<textarea id="impPer" class="inp" rows="5" oninput="impCount()" placeholder="5.01-9.01; 2.02; 2.03-6.03"></textarea>' +
    '<label class="f">Вес — дата и килограммы, кг писать не обязательно</label>' +
    '<textarea id="impW" class="inp" rows="4" oninput="impCount()" placeholder="5.01 64,5; 12.01 64,1"></textarea>' +
    '<div class="hint" id="impCnt" style="margin:8px 0 0"></div>' +
    '<div style="margin-top:12px"><button class="btn pink" style="width:100%" onclick="impApply()">Добавить в дневник</button></div>' +
    '<div class="hint" style="margin-top:8px">Год не указан — возьму прошедший. Одна дата месячных отмечает ' + dur + ' дн. (ваша средняя длительность, пока данных нет — 4).</div>'
  );
}
function impApply() {
  const { per, wgt } = impParse();
  if (!per.length && !wgt.length) { toast('Не нашёл ни одной даты — проверьте запись'); return; }
  const dur = (cycleInfo() && cycleInfo().avgDur) || 4;
  per.forEach(r => {
    const end = r.b || new Date(r.a.getTime() + (dur - 1) * DAY);
    for (let dt = new Date(r.a); dt <= end; dt = new Date(dt.getTime() + DAY)) DB.period[dkey(dt)] = 1;
  });
  wgt.forEach(r => {
    const k = dkey(r.d);
    DB.weight = DB.weight.filter(x => x.d !== k);
    DB.weight.push({ d: k, kg: Math.round(r.kg * 10) / 10 });
  });
  DB.weight.sort((a, b) => a.d < b.d ? -1 : 1);
  save(); closeSheet();
  toast('Добавлено: месячные ' + per.length + ' зап., вес ' + wgt.length + ' зап.');
  if (cur === 'cal') renderCal(); else RENDER[cur]();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const p2 = n => String(n).padStart(2, '0');
const dkey = dt => dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate());
const parseKey = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const todayKey = () => dkey(new Date());
const DAY = 864e5;

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WD = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

const fmtInt = x => Math.round(x).toLocaleString('ru-RU');
const fmt1 = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const num = v => parseFloat(String(v).replace(',', '.'));

let toastT;
function toast(m) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast'; t.textContent = m; t.style.opacity = '1';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}
function openSheet(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = '<div class="sheet">' + html + '</div>';
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}
function closeSheet() { const m = document.querySelector('.modal'); if (m) m.remove(); }

/* ---------- расчёты ---------- */

function latestKg() {
  if (!DB.weight.length) return null;
  return DB.weight[DB.weight.length - 1].kg;
}
function calcAge() {
  const b = DB.profile.birth;
  if (!b) return DB.profile.age || 0;
  const d = parseKey(b), now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
function bmr() {
  const p = DB.profile, kg = latestKg(), age = calcAge();
  if (!p.height || !age || !kg) return null;
  return Math.round(10 * kg + 6.25 * p.height - 5 * age - 161);
}
function stepsOf(k) { const s = DB.steps[k]; return (s && s.m || 0) + (s && s.s || 0); }
function stepsKcal(k) {
  const kg = latestKg();
  if (!kg) return 0;
  return Math.round(stepsOf(k) * 0.0005 * kg);
}
function workoutsOf(k) { return DB.workouts[k] || []; }
function dayBurn(k) {
  const b = bmr();
  if (b == null) return null;
  const w = workoutsOf(k).reduce((s, x) => s + x.kcal, 0);
  return { bmr: b, steps: stepsKcal(k), work: w, total: b + stepsKcal(k) + w };
}

function periodClusters() {
  const ds = Object.keys(DB.period).filter(k => DB.period[k]).sort();
  const cl = [];
  let prev = null, cur = null;
  for (const k of ds) {
    const t = parseKey(k).getTime();
    if (prev === null || t - prev > 2 * DAY) { cur = { start: k, days: 0 }; cl.push(cur); }
    cur.days++; prev = t;
  }
  return cl;
}
function cycleInfo() {
  const cl = periodClusters();
  if (!cl.length) return null;
  const lens = [];
  for (let i = 1; i < cl.length; i++) lens.push(Math.round((parseKey(cl[i].start) - parseKey(cl[i - 1].start)) / DAY));
  const last6 = lens.slice(-6);
  const avgLen = last6.length ? Math.round(last6.reduce((a, b) => a + b, 0) / last6.length) : null;
  const durs = cl.slice(-6).map(c => c.days);
  const avgDur = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
  const lastStart = cl[cl.length - 1].start;
  const nextStart = avgLen ? dkey(new Date(parseKey(lastStart).getTime() + avgLen * DAY)) : null;
  const cycleDay = Math.floor((Date.now() - parseKey(lastStart).getTime()) / DAY) + 1;
  const pred = new Set();
  if (nextStart) for (let c = 0; c < 6; c++) {
    const s = new Date(parseKey(nextStart).getTime() + c * avgLen * DAY);
    for (let i = 0; i < avgDur; i++) pred.add(dkey(new Date(s.getTime() + i * DAY)));
  }
  return { count: cl.length, avgLen, avgDur, lastStart, nextStart, cycleDay, pred };
}

/* ---------- вкладки ---------- */

const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recBase = '', recTarget = null;

function startVoice(target) {
  if (!SR) { toast('Этот браузер не умеет распознавать речь — попробуйте Safari или Chrome'); return; }
  if (rec) { try { rec.stop(); } catch (e) {} return; }
  recTarget = target;
  recBase = target === 'note' && $('dayNote') ? $('dayNote').value.trim() : '';
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    if (recTarget === 'food' && $('fName')) { $('fName').value = t; foodLookup(); }
    if (recTarget === 'note' && $('dayNote')) $('dayNote').value = (recBase ? recBase + ' ' : '') + t;
  };
  rec.onend = () => {
    rec = null; micUI(false);
    if (recTarget === 'note' && $('dayNote')) onNoteInput($('dayNote').value);
  };
  rec.onerror = e => {
    rec = null; micUI(false);
    toast(e.error === 'not-allowed' ? 'Разрешите доступ к микрофону' : 'Не получилось распознать речь');
  };
  micUI(true);
  try { rec.start(); toast('Говорите — я записываю'); }
  catch (e) { rec = null; micUI(false); }
}
function micUI(on) {
  const a = $('micFood'), b = $('micNote');
  if (a) a.classList.toggle('rec', on && recTarget === 'food');
  if (b) b.classList.toggle('rec', on && recTarget === 'note');
}

const I = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/></svg>',
  food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7.5 3v4.5a2.5 2.5 0 0 0 5 0V3M10 3v18"/><path d="M17.5 3c-2.2 3-2.2 7.5 0 10v8"/></svg>',
  act: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5h3.5l2.5-6 4.5 12 2.5-6H21"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 8.2l2.3 3.3a2.7 2.7 0 1 1-4.6 0z"/></svg>',
  prof: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.2" r="3.6"/><path d="M5 20c1.4-3.4 3.9-5 7-5s5.6 1.6 7 5"/></svg>'
};
const TABS = [
  { id: 'cal', label: 'Календарь' },
  { id: 'food', label: 'Еда' },
  { id: 'act', label: 'Активность' },
  { id: 'body', label: 'Тело' },
  { id: 'prof', label: 'Профиль' }
];
let cur = 'cal';
const RENDER = {};
const renderCal = () => RENDER.cal();
const renderFood = () => RENDER.food();
const renderAct = () => RENDER.act();
const renderBody = () => RENDER.body();
const renderProf = () => RENDER.prof();

function showTab(id) {
  cur = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + id));
  renderTabbar();
  RENDER[id]();
  window.scrollTo(0, 0);
}
function renderTabbar() {
  $('tabbar').innerHTML = TABS.map(t =>
    '<button class="tabbtn' + (t.id === cur ? ' on' : '') + '" onclick="showTab(\'' + t.id + '\')" aria-label="' + t.label + '">' + I[t.id] + '<span>' + t.label + '</span></button>'
  ).join('');
}

/* ---------- календарь ---------- */

let calY = new Date().getFullYear(), calM = new Date().getMonth(), selDate = todayKey();

function calShift(n) {
  calM += n;
  if (calM < 0) { calM = 11; calY--; }
  if (calM > 11) { calM = 0; calY++; }
  renderCal();
}
function selectDay(k) { selDate = k; renderCal(); }
function togglePeriod(k) {
  if (DB.period[k]) delete DB.period[k]; else DB.period[k] = 1;
  save(); renderCal();
}
function onNoteInput(v) {
  if (v) DB.notes[selDate] = v; else delete DB.notes[selDate];
  save();
}

function dayTitle(k) {
  const d = parseKey(k);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + WD[d.getDay()];
}

RENDER.cal = function () {
  const el = $('tab-cal');
  const ci = cycleInfo();
  const pred = ci ? ci.pred : new Set();
  const tk = todayKey();

  let grid = '<div class="cal-grid">' + ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => '<div class="cal-dow">' + d + '</div>').join('');
  const first = new Date(calY, calM, 1);
  const start = (first.getDay() + 6) % 7;
  const dim = new Date(calY, calM + 1, 0).getDate();
  for (let i = 0; i < start; i++) grid += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const k = calY + '-' + p2(calM + 1) + '-' + p2(d);
    const cls = ['cal-day'];
    if (DB.period[k]) cls.push('period');
    else if (pred.has(k)) cls.push('pred');
    if (k === tk) cls.push('today');
    if (k === selDate) cls.push('sel');
    const nd = DB.notes[k] ? '<span class="nd"></span>' : '';
    grid += '<div class="' + cls.join(' ') + '" onclick="selectDay(\'' + k + '\')">' + d + nd + '</div>';
  }
  grid += '</div>';

  const food = DB.food[selDate] || [];
  const foodSum = food.reduce((s, x) => s + x.kcal, 0);
  const st = stepsOf(selDate);
  let dayStats = '';
  if (foodSum || st) {
    dayStats = '<div class="hint">' +
      (foodSum ? 'Еда: ' + fmtInt(foodSum) + ' ккал' : '') +
      (foodSum && st ? ' · ' : '') +
      (st ? 'Шаги: ' + fmtInt(st) : '') + '</div>';
  }

  let cyc = '';
  if (ci) {
    const lines = [];
    if (ci.avgLen) {
      const daysTo = Math.round((parseKey(ci.nextStart) - new Date(new Date().toDateString())) / DAY);
      lines.push('Сегодня — ' + ci.cycleDay + '-й день цикла. Цикл в среднем ' + ci.avgLen + ' дн., месячные ~' + ci.avgDur + ' дн.');
      lines.push('Следующие: ориентировочно ' + parseKey(ci.nextStart).getDate() + ' ' + MONTHS[parseKey(ci.nextStart).getMonth()] + (daysTo > 0 ? ' (через ' + daysTo + ' дн.)' : ''));
      const nexts = [];
      for (let c = 0; c < 3; c++) {
        const d = new Date(parseKey(ci.nextStart).getTime() + c * ci.avgLen * DAY);
        nexts.push(d.getDate() + ' ' + MONTHS[d.getMonth()]);
      }
      lines.push('Прогноз на три цикла: ' + nexts.join(' · ') + '. Пунктиром отмечен и на полгода вперёд в календаре.');
    } else {
      lines.push('Сегодня — ' + ci.cycleDay + '-й день цикла. Отметьте следующие месячные — посчитаю длину цикла.');
    }
    cyc = '<div class="card"><h2>Цикл</h2>' + lines.map(l => '<div class="hint" style="margin:4px 0">' + l + '</div>').join('') + '</div>';
  }

  el.innerHTML =
    '<div class="card">' +
    '<div class="cal-nav">' +
    '<button class="cal-arrow" onclick="calShift(-1)" aria-label="Предыдущий месяц">‹</button>' +
    '<b>' + MONTHS_NOM[calM] + ' ' + calY + '</b>' +
    '<button class="cal-arrow" onclick="calShift(1)" aria-label="Следующий месяц">›</button>' +
    '</div>' + grid + '</div>' +
    '<div class="card">' +
    '<h2>' + dayTitle(selDate) + '</h2>' +
    '<button class="btn ' + (DB.period[selDate] ? 'pink' : '') + '" style="width:100%" onclick="togglePeriod(\'' + selDate + '\')">' +
    (DB.period[selDate] ? 'Месячные отмечены — убрать отметку' : 'Отметить месячные') + '</button>' +
    dayStats +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<label class="f" style="margin:12px 0 5px">Заметка на этот день</label>' +
    '<button class="mic" id="micNote" onclick="startVoice(\'note\')" aria-label="Надиктовать заметку">' + MIC + '</button>' +
    '</div>' +
    '<textarea id="dayNote" class="inp" placeholder="Что хочется записать…" oninput="onNoteInput(this.value)">' + esc(DB.notes[selDate] || '') + '</textarea>' +
    '</div>' + cyc;
};

/* ---------- еда ---------- */

let foodDate = todayKey();

const PRODUCTS = [
  ['Гречка отварная',110],['Рис отварной',130],['Макароны отварные',135],['Киноа отварная',120],['Булгур отварной',83],
  ['Картофель варёный',82],['Картофель жареный',192],['Картофель фри',310],['Овсянка на воде',88],['Овсянка на молоке',105],
  ['Куриная грудка запечённая',165],['Куриное бедро запечённое',210],['Куриная котлета',220],['Индейка запечённая',189],
  ['Говядина отварная',220],['Говядина жареная',250],['Свинина жареная',292],['Пельмени варёные',245],['Сосиски',260],['Бекон',450],
  ['Треска запечённая',120],['Лосось запечённый',208],['Горбуша',150],['Креветки',99],['Тунец в собственном соку',96],['Скумбрия',220],['Ролл с лососем',145],
  ['Творог 5%',121],['Творог обезжиренный',71],['Сырники запечённые',195],['Молоко 2,5%',52],['Кефир 1%',40],['Ряженка 2,5%',54],
  ['Йогурт греческий 2%',66],['Йогурт питьевой с сахаром',85],['Сыр твёрдый',350],['Моцарелла',280],['Сулугуни',290],['Сметана 20%',204],['Плавленый сыр',290],
  ['Яйцо варёное',75,'шт'],['Омлет',170],['Яичница',200],['Скрэмбл',160],['Шакшука',120],
  ['Хлеб белый',265],['Хлеб цельнозерновой',247],['Хлебцы',300],['Батон нарезной',270],['Булочка',320],['Круассан',400],['Блины',190],
  ['Печенье',480],['Пряник',350],['Торт бисквитный',350],['Пирожное',400],
  ['Яблоко',52],['Банан',96],['Апельсин',47],['Мандарин',53],['Груша',57],['Виноград',72],['Клубника',33],['Черника',57],['Малина',46],
  ['Арбуз',30],['Дыня',35],['Киви',61],['Авокадо',160],['Персик',46],['Хурма',67],
  ['Лимон',30],['Грейпфрут',40],['Ананас',50],['Манго',65],['Гранат',75],['Слива',45],['Абрикос',45],['Вишня',50],['Черешня',55],
  ['Курага',215],['Чернослив',240],['Изюм',280],['Финики',280],['Инжир сушёный',250],
  ['Огурец',15],['Помидор',20],['Салат листовой',15],['Брокколи',34],['Цветная капуста',30],['Морковь',41],['Капуста',28],['Свёкла',43],
  ['Кабачок',24],['Баклажан',24],['Тыква',25],['Шпинат',23],['Редис',20],['Спаржа',20],['Болгарский перец',27],['Лук',41],
  ['Шампиньоны',27],['Грибы жареные',150],['Стручковая фасоль',31],['Кукуруза консервированная',96],['Кукуруза варёная',96],['Зелёный горошек',73],['Оливки',115],['Батат печёный',90],['Эдамаме',120],
  ['Оливье',198],['Греческий салат',120],['Цезарь с курицей',190],['Сельдь под шубой',200],['Винегрет',90],
  ['Крабовый салат',150],['Мимоза',190],['Салат с тунцом',180],['Коул-слоу',170],['Свекольный салат',120],['Табуле',120],
  ['Борщ',49],['Куриный суп',36],['Солянка',80],['Крем-суп из тыквы',45],['Рассольник',55],['Гороховый суп',66],['Уха',46],['Щи',35],['Грибной суп',50],['Минестроне',40],
  ['Масло сливочное',748],['Масло оливковое',884],['Майонез',620],['Грецкие орехи',654],['Миндаль',579],['Кешью',600],['Арахисовая паста',588],['Семечки',580],
  ['Фисташки',560],['Кедровые орехи',680],['Пекан',690],['Макадамия',720],['Фундук',650],['Арахис',570],['Кокосовая стружка',360],
  ['Шоколад молочный',535],['Шоколад тёмный 70%',546],['Белый шоколад',540],['Зефир',326],['Мармелад',320],['Пастила',310],['Мёд',304],['Сахар',387],['Варенье',260],['Халва',520],['Сгущёнка',320],['Протеиновый батончик',350],
  ['Нуга',400],['Грильяж',500],['Карамель',370],['Ирис',400],['Попкорн',430],['Чипсы картофельные',530],['Сушки',340],['Сухари',350],['Баранки',310],['Вафли',430],
  ['Мороженое пломбир',230],['Сорбет',120],['Медовик',400],['Наполеон',420],['Шарлотка',200],['Тирамису',280],['Чизкейк',320],['Панна-котта',200],['Брауни',430],
  ['Кофе американо без сахара',2],['Кофе с молоком',30],['Латте на молоке 2,5%',55],['Капучино',45],['Чай без сахара',1],['Какао на молоке',85],
  ['Матча латте',130],['Раф',190,'порция'],['Флэт уайт',90,'порция'],['Мокко',240,'порция'],['Фраппе',300,'порция'],['Чай с сахаром',25,'порция'],
  ['Сок апельсиновый',45],['Сок яблочный',46],['Кола',42],['Кола, средний стакан',170,'порция'],['Лимонад',40],['Энергетик',45],['Компот',90],['Морс',45],['Кисель',90],
  ['Молочный коктейль',330,'порция'],['Смузи',200,'порция'],
  ['Вино белое сухое',70],['Вино красное сухое',68],['Пиво светлое',43],['Шампанское',85],['Сидр',50],['Вермут',150],['Глинтвейн',90],
  ['Водка',230],['Коньяк',240],['Виски',240],['Ром',230],['Джин',250],['Текила',230],['Ликёр',330],['Настойка',210],
  ['Пицца',260],['Пицца, кусок',270,'шт'],['Шаурма',200],['Хумус',166],['Тофу',76],['Соевый соус',53],['Кетчуп',110],
  ['Горчица',120],['Соус барбекю',110],['Соус сырный',300],['Соус тартар',340],['Соус ранч',430],['Соус песто',450],['Соус бешамель',140],['Спайси-майо',600],['Соус унаги',230],['Гуакамоле',160],
  ['Сливки 10%',120],['Сливки 33%',300],['Рикотта',174],['Фета',264],['Пармезан',392],['Брынза',260],['Творожный сыр',253],['Молоко 3,2%',59],['Айран',35],['Топлёное молоко',67],['Сыворотка',20],
  ['Кокосовое молоко (банка, густое)',200],['Кокосовое молоко (напиток)',30],['Овсяное молоко',45],['Миндальное молоко',15],
  ['Ветчина',240],['Колбаса докторская',250],['Салями',400],['Сервелат',350],['Карбонад',160],['Буженина',240],['Баранина запечённая',280],['Утка запечённая',330],['Кролик',170],
  ['Сельдь',160],['Форель запечённая',150],['Сёмга солёная',190],['Кальмар',100],['Мидии',80],['Икра красная',230],['Минтай',75],['Мойва',160],['Дорадо',100],['Сибас',105],['Устрицы',70],['Осьминог',80],['Краб',95],
  ['Фасоль отварная',123],['Чечевица отварная',110],['Нут отварной',130],['Маш отварной',100],['Овсяные хлопья сухие',370],['Мюсли',370],['Гранола',430],['Кукурузные хлопья',360],
  ['Плов',190],['Голубцы',150],['Долма',180],['Бефстроганов',180],['Драники',220],['Запеканка творожная',180],['Холодец',90],['Язык говяжий',230],['Печень куриная',140],
  ['Шашлык из курицы',180],['Шашлык из свинины',290],['Люля-кебаб',230],['Вареники с творогом',200],['Хачапури по-аджарски',270],
  ['Манная каша',95],['Пшённая каша',120],['Перловая каша',110],['Картофельное пюре',105],['Овощи гриль',120],['Тушёные овощи',80],
  ['Паста карбонара',330],['Паста болоньезе',160],['Лазанья',200],['Ризотто',150],['Паэлья',150],['Гаспачо',40],['Тортилья испанская',200],
  ['Хамон',240],['Чоризо',400],['Фалафель',330],['Мусака',150],['Рататуй',80],['Шницель',250],['Гуляш',150],['Дофинуа',170],
  ['Кускус отварной',110],['Бриошь',350],['Багет',270],['Пита',275],['Лаваш тонкий',270],['Панкейки',230],['Вафли бельгийские',300],
  ['Биг Мак',257,'шт'],['Воппер',660,'шт'],['Гамбургер',253,'шт'],['Чизбургер',302,'шт'],['Двойной чизбургер',450,'шт'],['МакЧикен',470,'шт'],['Филе-о-фиш',330,'шт'],
  ['Наггетс куриный',48,'шт'],['Картошка фри, порция',340,'порция'],['МакФлурри',330,'порция'],['Хот-дог',290,'шт'],
  ['Шаурма классическая',450,'порция'],['Дёнер-кебаб',450,'порция'],['Сэндвич с курицей',380,'шт'],['Буррито',500,'шт'],['Тако',190,'шт'],['Кесадилья',380,'порция'],
  ['Ролл Филадельфия, кусок',60,'шт'],['Ролл Калифорния, кусок',55,'шт'],['Суши с лососем, кусок',45,'шт'],['Онигири',160,'шт'],
  ['Димсам',45,'шт'],['Спринг-ролл',120,'шт'],['Бао со свининой',220,'шт'],
  ['Рамен, порция',470,'порция'],['Фо бо, порция',300,'порция'],['Пад-тай, порция',400,'порция'],['Том ям, порция',250,'порция'],
  ['Карри с рисом, порция',480,'порция'],['Жареная лапша с овощами, порция',450,'порция'],['Жареный рис, порция',480,'порция'],
  ['Эскимо',180,'шт'],['Сникерс',250,'шт'],['Марс',230,'шт'],['Баунти',280,'шт'],['Кит-кат',210,'шт'],['Донат',280,'шт'],['Маффин',400,'шт'],['Эклер',270,'шт'],
  ['Чебурек',320,'шт'],['Беляш',330,'шт'],['Самса',450,'шт'],['Пирожок с картошкой',250,'шт'],['Пирожок с мясом',330,'шт'],['Сосиска в тесте',330,'шт'],['Ватрушка',300,'шт'],['Котлета по-киевски',450,'шт'],
  ['Макарун (печенье)',95,'шт'],['Эспрессо',3,'шт']
];

function setFoodDate(v) { foodDate = v || todayKey(); renderFood(); }

/* умный подбор продукта по названию */
const STOP = new Set(['на','с','со','и','в','из','без','для','по','от','до','за','the']);
const stemW = w => w.replace(/(ами|ями|ого|его|ому|ему|ых|их|ая|яя|ое|ее|ые|ие|ой|ей|ий|ый|ом|ем|ую|юю|ов|ев|ам|ях|ах|у|ю|а|я|ы|и|е|о|ь)$/,'');
const wordsOf = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9%,.\-]+/gi, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w));
function prodMatch(q) {
  const qw = wordsOf(q).map(stemW).filter(Boolean);
  if (!qw.length) return -1;
  let best = -1, bestS = 0;
  PRODUCTS.forEach((p, i) => {
    const nw = wordsOf(p[0]).map(stemW);
    let s = 0, hit = 0;
    qw.forEach(qw1 => {
      const exact = nw.some(n => n === qw1);
      const pref = nw.some(n => qw1.length >= 3 && n.length >= 3 && (n.startsWith(qw1) || qw1.startsWith(n)));
      if (exact) { s += 10; hit++; }
      else if (pref) s += 6;
    });
    if (hit === qw.length && hit > 0) s += 15;
    if (nw.length && qw.length && (nw[0] === qw[0] || (qw[0].length >= 3 && nw[0].startsWith(qw[0])))) s += 2;
    s -= nw.length * 0.4;
    if (s > bestS) { bestS = s; best = i; }
  });
  return bestS >= 9 ? best : -1;
}
let fMatchI = -1;
function foodLookup() {
  const el = $('fName'), sug = $('fSug');
  if (!el) return;
  let q = el.value, amtSet = null;
  const mp = q.match(/(\d{1,3})\s*(шт|штук|порци)/i);
  const mg = q.match(/(\d{1,4})\s*(гр|грамм|г|мл)\b/i);
  if (mp) { amtSet = +mp[1]; q = q.replace(mp[0], ' '); }
  else if (mg) { amtSet = +mg[1]; q = q.replace(mg[0], ' '); }
  fMatchI = prodMatch(q);
  if (fMatchI >= 0) {
    const p = PRODUCTS[fMatchI], per100 = !p[2];
    if (amtSet == null) amtSet = per100 ? 100 : 1;
    if ($('fAmt')) $('fAmt').value = amtSet;
    if ($('fAmtLbl')) $('fAmtLbl').textContent = per100 ? 'г' : p[2];
    if ($('fKcal')) $('fKcal').value = per100 ? Math.round(p[1] * amtSet / 100) : Math.round(p[1] * amtSet);
    if (sug) sug.innerHTML = 'Нашла: <b>' + esc(p[0]) + '</b> — ' + p[1] + (per100 ? ' ккал/100 г' : ' ккал за 1 ' + p[2]) + '. Калории подставила, поправьте при желании.';
  } else {
    if (sug) sug.textContent = 'В справочнике не нашлось — впишите калории сами, запомню как есть.';
  }
}
function foodCalc() {
  if (fMatchI < 0) return;
  const p = PRODUCTS[fMatchI];
  const a = num($('fAmt') && $('fAmt').value) || 0;
  if ($('fKcal')) $('fKcal').value = Math.round(p[2] ? p[1] * a : p[1] * a / 100);
}
function addFood() {
  const name = $('fName').value.trim();
  const kcal = num($('fKcal').value);
  if (!name) { toast('Напишите, что съели'); return; }
  if (isNaN(kcal) || kcal < 0 || kcal > 5000) { toast('Проверьте калории'); return; }
  if (!DB.food[foodDate]) DB.food[foodDate] = [];
  let shown = name;
  if (fMatchI >= 0) {
    const p = PRODUCTS[fMatchI];
    const a = num($('fAmt') && $('fAmt').value);
    shown = p[0] + (a ? ', ' + Math.round(a) + (p[2] ? ' ' + p[2] : ' г') : '');
  }
  DB.food[foodDate].push({ id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6), name: shown, kcal: Math.round(kcal) });
  save(); renderFood();
}
function delFood(id) {
  DB.food[foodDate] = (DB.food[foodDate] || []).filter(x => x.id !== id);
  if (DB.food[foodDate] && !DB.food[foodDate].length) delete DB.food[foodDate];
  save(); renderFood();
}

function openProducts() {
  openSheet(
    '<div class="sheet-head"><b>Справочник продуктов</b><button class="btn small ghost" onclick="closeSheet()">Готово</button></div>' +
    '<input class="inp search" placeholder="Поиск: творог, биг мак…" oninput="filterProds(this.value)">' +
    '<div class="hint" style="margin:6px 0 0">Большинство — на 100 г; «шт» и «порция» — за штуку или порцию целиком. Значения приблизительные.</div>' +
    '<div id="prodList">' + prodListHTML('') + '</div>'
  );
}
function prodListHTML(q) {
  const ql = (q || '').trim().toLowerCase();
  const f = PRODUCTS.map((p, i) => ({ p, i })).filter(x => !ql || x.p[0].toLowerCase().includes(ql));
  if (!f.length) return '<div class="empty">Ничего не нашлось — добавьте вручную</div>';
  return f.map(({ p, i }) =>
    '<div class="prod">' +
    '<div style="flex:1"><b>' + p[0] + '</b><div class="hint" style="margin:0">~' + p[1] + ' ккал' + (p[2] ? ' / ' + p[2] : ' / 100 г') + '</div></div>' +
    '<input id="g' + i + '" class="g" type="number" inputmode="decimal" min="0" value="' + (p[2] ? 1 : 100) + '" oninput="recalc(' + i + ')">' +
    '<span id="k' + i + '" class="kc">' + p[1] + '</span>' +
    '<button class="btn small pink" onclick="addProd(' + i + ')" aria-label="Добавить">+</button>' +
    '</div>'
  ).join('');
}
function filterProds(v) { const l = $('prodList'); if (l) l.innerHTML = prodListHTML(v); }
function recalc(i) {
  const g = num($('g' + i).value) || 0;
  const p = PRODUCTS[i];
  $('k' + i).textContent = Math.round(p[2] ? p[1] * g : p[1] * g / 100);
}
function addProd(i) {
  const g = num($('g' + i).value);
  if (!g || g <= 0) { toast('Сколько добавляем?'); return; }
  const p = PRODUCTS[i];
  const kcal = Math.round(p[2] ? p[1] * g : p[1] * g / 100);
  if (!DB.food[foodDate]) DB.food[foodDate] = [];
  DB.food[foodDate].push({ id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6), name: p[0] + ', ' + Math.round(g) + (p[2] ? ' ' + p[2] : ' г'), kcal });
  save(); toast('Добавлено: ' + kcal + ' ккал'); renderFood();
}

function foodDayLabel(k) {
  const t = todayKey();
  if (k === t) return 'сегодня';
  if (k === dkey(new Date(Date.now() - DAY))) return 'вчера';
  const d = parseKey(k);
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

RENDER.food = function () {
  const el = $('tab-food');
  const list = DB.food[foodDate] || [];
  const eaten = list.reduce((s, x) => s + x.kcal, 0);
  const burn = dayBurn(foodDate);
  const goal = DB.profile.goalKcal;

  const items = list.length
    ? list.map(x => '<div class="item"><span class="nm">' + esc(x.name) + '</span><span class="kcal">' + fmtInt(x.kcal) + '</span><button class="del" onclick="delFood(\'' + x.id + '\')" aria-label="Удалить">×</button></div>').join('')
    : '<div class="empty">Пока ничего не записано</div>';

  let totals =
    '<div class="total"><span>Съедено — ' + foodDayLabel(foodDate) + '</span><b>' + fmtInt(eaten) + ' ккал</b></div>';
  if (burn) {
    const bal = eaten - burn.total;
    totals += '<div class="hint" style="margin:0">Расход ~' + fmtInt(burn.total) + ' ккал · баланс ' + (bal > 0 ? '+' : '') + fmtInt(bal) + '</div>';
  } else {
    totals += '<div class="hint" style="margin:0">Расход посчитается, когда заполнятся рост, возраст и вес — вкладки «Тело» и «Профиль».</div>';
  }
  if (goal) {
    const w = Math.min(100, Math.round(eaten / goal * 100));
    totals += '<div class="progress"><i style="width:' + w + '%"></i></div><div class="hint" style="margin:2px 0 0">' + w + '% от цели (' + fmtInt(goal) + ' ккал)</div>';
  }

  el.innerHTML =
    '<div class="card">' +
    '<input class="inp" type="date" value="' + foodDate + '" onchange="setFoodDate(this.value)">' +
    '<h3>Что я съела</h3>' + items + totals + '</div>' +
    '<div class="card">' +
    '<h3>Добавить</h3>' +
    '<div class="row" style="align-items:stretch">' +
    '<input id="fName" class="inp" placeholder="Блюдо или продукт" oninput="foodLookup()">' +
    '<button class="mic" id="micFood" onclick="startVoice(\'food\')" aria-label="Надиктовать блюдо">' + MIC + '</button>' +
    '</div>' +
    '<div class="hint" id="fSug" style="margin:6px 0 0"></div>' +
    '<div class="row" style="margin-top:8px;align-items:center">' +
    '<input id="fAmt" class="inp" type="number" inputmode="decimal" value="100" oninput="foodCalc()" aria-label="Количество">' +
    '<span id="fAmtLbl" style="flex:0 0 auto;color:var(--muted);font-size:13px">г</span>' +
    '<input id="fKcal" class="inp" type="number" inputmode="decimal" placeholder="ккал">' +
    '<button class="btn" style="flex:0 0 auto" onclick="addFood()">Добавить</button>' +
    '</div>' +
    '<div style="margin-top:10px"><button class="btn pink" style="width:100%" onclick="openProducts()">Справочник: ' + PRODUCTS.length + ' продуктов</button></div>' +
    '<div class="hint">Надиктуйте или впишите блюдо — калории подставлю сама. Русская, европейская, азиатская кухня и фастфуд. Значения приблизительные.</div>' +
    '</div>';
};

/* ---------- активность ---------- */

const WORKOUTS = [
  ['Прогулка',3.5],['Быстрая ходьба',5],['Бег',9.5],['Велосипед',7.5],['Йога',3],['Силовая тренировка',5],
  ['Плавание',7],['Танцы',6],['Растяжка',2.5],['Уборка',3],['Другое',4]
];

const sen = { on: false, count: 0, lastPeak: 0, wasAbove: false, date: null, g: { x: 0, y: 0, z: 0 } };

async function toggleSensor() {
  if (sen.on) { stopSensor(); renderAct(); return; }
  if (!('DeviceMotionEvent' in window)) { toast('Здесь нет датчика движения — вносите шаги вручную'); return; }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') { toast('Нет доступа к датчику'); return; }
    }
  } catch (e) { toast('Не удалось включить датчик'); return; }
  sen.on = true;
  sen.date = todayKey();
  sen.count = (DB.steps[sen.date] && DB.steps[sen.date].s) || 0;
  window.addEventListener('devicemotion', onMotion);
  toast('Шагомер включён — считает, пока приложение открыто');
  renderAct();
}
function stopSensor() {
  sen.on = false;
  window.removeEventListener('devicemotion', onMotion);
  persistSensor();
  toast('Шагомер остановлен');
}
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const k = todayKey();
  if (k !== sen.date) { persistSensor(); sen.date = k; sen.count = 0; }
  const al = 0.12;
  sen.g.x += al * (a.x - sen.g.x);
  sen.g.y += al * (a.y - sen.g.y);
  sen.g.z += al * (a.z - sen.g.z);
  const mag = Math.hypot(a.x - sen.g.x, a.y - sen.g.y, a.z - sen.g.z);
  const now = Date.now();
  // порог 2 м/с² отсекает тряску телефона в руке, окно 270 мс — два шага не склеятся в один
  if (mag > 2) {
    if (!sen.wasAbove && now - sen.lastPeak > 270) {
      sen.lastPeak = now; sen.count++;
      if (sen.count % 5 === 0) persistSensor();
      updateStepsLive();
    }
    sen.wasAbove = true;
  } else if (mag < 0.8) sen.wasAbove = false;
}
function persistSensor() {
  if (!sen.date) return;
  if (!DB.steps[sen.date]) DB.steps[sen.date] = { m: 0, s: 0 };
  DB.steps[sen.date].s = Math.max(DB.steps[sen.date].s || 0, sen.count);
  save();
}
function updateStepsLive() {
  const k = todayKey();
  const s = $('stepsLive');
  if (s) s.textContent = fmtInt(stepsOf(k));
}
function addStepsManual() {
  const v = parseInt($('stepsAdd').value, 10);
  if (isNaN(v) || v <= 0) { toast('Сколько шагов добавить?'); return; }
  const k = todayKey();
  if (!DB.steps[k]) DB.steps[k] = { m: 0, s: 0 };
  DB.steps[k].m += v;
  save(); renderAct();
}
function resetSteps() {
  const k = todayKey();
  DB.steps[k] = { m: 0, s: 0 };
  sen.count = 0;
  save(); renderAct();
}
function addWorkout() {
  const w = WORKOUTS[parseInt($('wType').value, 10)];
  const min = parseInt($('wMin').value, 10);
  if (isNaN(min) || min <= 0 || min > 600) { toast('Сколько минут?'); return; }
  const kg = latestKg() || 60;
  const kcal = Math.round(w[1] * kg * min / 60);
  const k = todayKey();
  if (!DB.workouts[k]) DB.workouts[k] = [];
  DB.workouts[k].push({ id: 'w' + Date.now(), name: w[0], min, kcal });
  save(); renderAct();
}
function delWorkout(id) {
  const k = todayKey();
  DB.workouts[k] = (DB.workouts[k] || []).filter(x => x.id !== id);
  if (DB.workouts[k] && !DB.workouts[k].length) delete DB.workouts[k];
  save(); renderAct();
}

let BAR_DAYS = [];
function barChart7() {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(dkey(new Date(Date.now() - i * DAY)));
  BAR_DAYS = days.map(k => ({ k, v: stepsOf(k) }));
  const mx = Math.max(1, ...BAR_DAYS.map(d => d.v));
  const W = 320, H = 128, pad = 12, bw = (W - pad * 2) / 7 - 6, bh = 74;
  const tk = todayKey();
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
  BAR_DAYS.forEach((d, i) => {
    const x = pad + i * ((W - pad * 2) / 7) + 3;
    const h = Math.max(d.v > 0 ? 4 : 0, Math.round(d.v / mx * bh));
    const y = 88 - h;
    const isT = d.k === tk;
    s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="4" fill="' + (isT ? '#DFA3B6' : '#75906F') + '" opacity="' + (d.v > 0 ? 1 : .18) + '"/>';
    s += '<text x="' + (x + bw / 2) + '" y="' + (104) + '" text-anchor="middle" font-size="10.5" fill="#8B8794">' + d.k.slice(8) + '</text>';
    if (isT && d.v > 0) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#3A3740">' + (d.v / 1000 >= 1 ? fmt1(d.v / 1000).replace(',0', '') + 'к' : d.v) + '</text>';
    s += '<rect x="' + (x - 3) + '" y="4" width="' + (bw + 6) + '" height="112" fill="transparent" onclick="barTap(' + i + ')"/>';
  });
  s += '</svg>';
  return s;
}
function barTap(i) {
  const d = BAR_DAYS[i];
  const c = $('stepsCap');
  if (c) c.textContent = d.k.slice(8) + '.' + d.k.slice(5, 7) + ': ' + fmtInt(d.v) + ' шагов';
}

RENDER.act = function () {
  const el = $('tab-act');
  const k = todayKey();
  const st = DB.steps[k] || { m: 0, s: 0 };
  const burn = dayBurn(k);
  const wl = workoutsOf(k);

  el.innerHTML =
    '<div class="card">' +
    '<h2>Шаги сегодня</h2>' +
    '<div class="big" id="stepsLive">' + fmtInt(st.m + st.s) + '</div>' +
    '<div class="hint" style="margin:2px 0 10px">ручные ' + fmtInt(st.m) + ' + шагомер ' + fmtInt(st.s) + '</div>' +
    '<div class="row">' +
    '<button class="btn ' + (sen.on ? 'pink' : '') + '" onclick="toggleSensor()">' + (sen.on ? 'Остановить шагомер' : 'Включить шагомер') + '</button>' +
    '</div>' +
    '<div class="row" style="margin-top:10px">' +
    '<input id="stepsAdd" class="inp" type="number" inputmode="numeric" placeholder="Например, 2500">' +
    '<button class="btn pink" onclick="addStepsManual()">+ шаги</button>' +
    '</div>' +
    '<div class="hint">Шагомер считает, пока приложение открыто на экране. Точное число за весь день можно посмотреть в «Здоровье» на телефоне и вписать сюда.</div>' +
    '</div>' +
    '<div class="card">' +
    '<h2>Неделя шагов</h2>' + barChart7() +
    '<div class="chart-cap" id="stepsCap">нажмите на столбик — покажу число</div>' +
    '</div>' +
    '<div class="card">' +
    '<h2>Тренировка</h2>' +
    '<div class="row">' +
    '<select id="wType" class="inp">' + WORKOUTS.map((w, i) => '<option value="' + i + '">' + w[0] + '</option>').join('') + '</select>' +
    '<input id="wMin" class="inp" type="number" inputmode="numeric" placeholder="минут">' +
    '</div>' +
    '<div style="margin-top:10px"><button class="btn" onclick="addWorkout()">Добавить</button></div>' +
    (wl.length ? wl.map(x => '<div class="item"><span class="nm">' + esc(x.name) + ', ' + x.min + ' мин</span><span class="kcal">~' + fmtInt(x.kcal) + ' ккал</span><button class="del" onclick="delWorkout(\'' + x.id + '\')" aria-label="Удалить">×</button></div>').join('') : '<div class="empty">Сегодня тренировок нет</div>') +
    '</div>' +
    '<div class="card">' +
    '<h2>Расход за день</h2>' +
    (burn
      ? '<div class="total"><span>Базовый обмен</span><b>~' + fmtInt(burn.bmr) + ' ккал</b></div>' +
        '<div class="total"><span>Шаги</span><b>~' + fmtInt(burn.steps) + ' ккал</b></div>' +
        '<div class="total"><span>Тренировки</span><b>~' + fmtInt(burn.work) + ' ккал</b></div>' +
        '<div class="total"><span><b>Итого</b></span><b>~' + fmtInt(burn.total) + ' ккал</b></div>' +
        '<div class="hint">Базовый обмен — формула Миффлина — Сан Жеора по росту, возрасту и весу. Всё приблизительно.</div>'
      : '<div class="empty">Заполните рост и возраст в «Профиле» и запишите вес в «Теле» — тогда посчитаю расход.</div>') +
    '<div style="margin-top:8px"><button class="btn ghost small" onclick="resetSteps()">Обнулить шаги за сегодня</button></div>' +
    '</div>';
};

/* ---------- тело ---------- */

const MEAS = [['chest','Грудь'],['waist','Талия'],['hips','Бёдра'],['thigh','Бедро'],['arm','Рука']];
let curMeasure = 'waist';
const CHARTS = {};

function setMeasure(v) { curMeasure = v; renderBody(); }

function saveWeight() {
  const kg = num($('wKg').value);
  if (isNaN(kg) || kg < 25 || kg > 300) { toast('Проверьте вес'); return; }
  const k = todayKey();
  DB.weight = DB.weight.filter(x => x.d !== k);
  DB.weight.push({ d: k, kg: Math.round(kg * 10) / 10 });
  DB.weight.sort((a, b) => a.d < b.d ? -1 : 1);
  save(); toast('Вес записан'); renderBody();
}
function saveMeasures() {
  const rec = { d: todayKey() };
  let any = false;
  MEAS.forEach(m => {
    const v = num($('m_' + m[0]).value);
    if (!isNaN(v) && v > 0) { rec[m[0]] = Math.round(v * 10) / 10; any = true; }
  });
  if (!any) { toast('Хотя бы одно измерение'); return; }
  DB.measures = DB.measures.filter(x => x.d !== rec.d);
  DB.measures.push(rec);
  DB.measures.sort((a, b) => a.d < b.d ? -1 : 1);
  save(); toast('Обмеры записаны'); renderBody();
}

const dShort = k => k.slice(8) + '.' + k.slice(5, 7);

function lineChart(kind, pts, unit) {
  CHARTS[kind] = pts;
  if (!pts.length) return '';
  const last = pts[pts.length - 1];
  const cap = 'последняя запись: ' + fmt1(last.v) + unit + ' · ' + dShort(last.d);
  if (pts.length < 2) {
    return '<div class="chart-cap" id="' + kind + 'Cap">' + cap + '</div>';
  }
  const W = 320, H = 140, L = 38, R = 16, T = 16, B = 24;
  const vs = pts.map(p => p.v);
  let mn = Math.min(...vs), mx = Math.max(...vs);
  if (mn === mx) { mn -= 1; mx += 1; }
  const pad = (mx - mn) * 0.12;
  mn -= pad; mx += pad;
  const X = i => L + (W - L - R) * (i / (pts.length - 1));
  const Y = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const maxLen = Math.min(pts.length, 20);
  const shown = pts.slice(-maxLen);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
  [mn + (mx - mn) * 0.05, (mn + mx) / 2, mx - (mx - mn) * 0.05].forEach(v => {
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#EFE7EA" stroke-width="1"/>';
    s += '<text x="' + (L - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="#8B8794">' + fmt1(v) + '</text>';
  });
  s += '<path d="' + line + '" fill="none" stroke="#75906F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  shown.forEach(p => {
    const i = pts.indexOf(p);
    const isLast = i === pts.length - 1;
    s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="' + (isLast ? 4.5 : 3.5) + '" fill="#75906F" stroke="#fff" stroke-width="2"/>';
    s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="13" fill="transparent" onclick="chartTap(\'' + kind + '\',' + i + ')"/>';
  });
  s += '<text x="' + L + '" y="' + (H - 6) + '" font-size="10.5" fill="#8B8794">' + dShort(pts[0].d) + '</text>';
  s += '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" font-size="10.5" fill="#8B8794">' + dShort(last.d) + '</text>';
  s += '<text x="' + (X(pts.length - 1) - 2).toFixed(1) + '" y="' + Math.max(11, Y(last.v) - 9).toFixed(1) + '" text-anchor="end" font-size="11" font-weight="700" fill="#3A3740">' + fmt1(last.v) + unit + '</text>';
  s += '</svg>';
  return '<div class="chart-cap" id="' + kind + 'Cap">' + cap + '</div>' + s;
}
function chartTap(kind, i) {
  const p = CHARTS[kind][i];
  if (!p) return;
  const c = $(kind + 'Cap');
  if (c) c.textContent = dShort(p.d) + ': ' + fmt1(p.v) + (kind === 'w' ? ' кг' : ' см');
}

RENDER.body = function () {
  const el = $('tab-body');
  const w = DB.weight;
  const last = w[w.length - 1];
  const lm = DB.measures[DB.measures.length - 1];

  let wDelta = '';
  if (w.length >= 2) {
    const d = w[w.length - 1].kg - w[0].kg;
    wDelta = '<div class="hint" style="margin:0 0 4px">с первой записи: ' + (d > 0 ? '+' : '') + fmt1(d) + ' кг</div>';
  }

  let bmi = '';
  const p = DB.profile;
  if (p.height && last) {
    const h = p.height / 100;
    const v = last.kg / (h * h);
    const cat = v < 18.5 ? 'ниже нормы' : v < 25 ? 'в норме' : 'выше нормы';
    const lo = Math.round(18.5 * h * h), hi = Math.round(24.9 * h * h);
    bmi = '<div class="card"><h2>ИМТ</h2>' +
      '<div class="big">' + fmt1(v) + '</div>' +
      '<div class="hint" style="margin:2px 0 0">— ' + cat + '. Норма для роста ' + p.height + ' см: ' + lo + '–' + hi + ' кг</div></div>';
  }

  el.innerHTML =
    '<div class="card"><h2>Вес</h2>' +
    (last ? '<div class="hint" style="margin:0 0 4px">сейчас: ' + fmt1(last.kg) + ' кг · ' + dShort(last.d) + '</div>' + wDelta : '<div class="empty">Первая запись — и пойдут графики</div>') +
    '<div class="row" style="margin-top:8px">' +
    '<input id="wKg" class="inp" type="number" inputmode="decimal" placeholder="вес, кг" value="' + (last ? last.kg : '') + '">' +
    '<button class="btn" onclick="saveWeight()">Записать</button>' +
    '</div>' +
    (w.length >= 2 ? '<div style="margin-top:12px">' + lineChart('w', w.map(x => ({ d: x.d, v: x.kg })), ' кг') + '</div>' : '<div class="hint">нажимайте на точки графика — покажу дату и число</div>') +
    '</div>' +
    '<div class="card"><h2>Обмеры, см</h2>' +
    MEAS.map(m => '<label class="f">' + m[1] + '</label><input id="m_' + m[0] + '" class="inp" type="number" inputmode="decimal" placeholder="—" value="' + (lm && lm[m[0]] != null ? lm[m[0]] : '') + '">').join('') +
    '<div style="margin-top:12px"><button class="btn" onclick="saveMeasures()">Записать обмеры</button></div>' +
    (DB.measures.length >= 2
      ? '<div style="margin-top:14px"><select class="inp" onchange="setMeasure(this.value)">' +
        MEAS.map(m => '<option value="' + m[0] + '"' + (m[0] === curMeasure ? ' selected' : '') + '>' + m[1] + ', динамика</option>').join('') +
        '</select>' +
        lineChart('m', DB.measures.filter(x => x[curMeasure] != null).map(x => ({ d: x.d, v: x[curMeasure] })), ' см') + '</div>'
      : '<div class="hint">Два дня обмеров — и появится график динамики</div>') +
    '</div>' + bmi;
};

/* ---------- профиль ---------- */

function saveProfile() {
  const name = $('pName').value.trim();
  const height = parseInt($('pH').value, 10);
  const birth = $('pB').value || '';
  const goal = $('pGoal').value;
  const gkg = num($('pGKg').value);
  if (!isNaN(height) && (height < 120 || height > 230)) { toast('Проверьте рост'); return; }
  let age = 0;
  if (birth) {
    const d = parseKey(birth);
    if (!d || d > new Date() || d.getFullYear() < 1920) { toast('Проверьте дату рождения'); return; }
    const now = new Date();
    age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    if (age < 10 || age > 100) { toast('По этой дате выходит ' + age + ' — проверьте её'); return; }
  }
  if (!isNaN(gkg) && (gkg < 30 || gkg > 300)) { toast('Проверьте желаемый вес'); return; }
  DB.profile = { name, height: height || 0, birth, age: age || (DB.profile.age || 0), goal, goalKg: gkg || 0, goalKcal: DB.profile.goalKcal || 0 };
  const b = bmr();
  if (b && goal) {
    const base = goal === 'lose' ? Math.max(1200, Math.round(b * 0.85)) : goal === 'gain' ? Math.round(b * 1.1) : b;
    DB.profile.goalKcal = base;
  }
  save(); toast('Профиль сохранён'); renderProf();
}
function exportData() {
  const data = JSON.stringify(DB, null, 1);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dnevnik-' + todayKey() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function showDataText() {
  openSheet(
    '<div class="sheet-head"><b>Копия данных</b><button class="btn small ghost" onclick="closeSheet()">Закрыть</button></div>' +
    '<textarea class="inp" rows="9" readonly onclick="this.select()">' + esc(JSON.stringify(DB)) + '</textarea>' +
    '<div class="hint">Коснитесь текста — он выделится, и его можно скопировать.</div>'
  );
}
function importFile(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== 'object' || !(d.period || d.food || d.weight || d.profile)) throw 0;
      pendImport = d;
      renderProf();
    } catch (e) { toast('Файл не похож на копию дневника'); }
  };
  r.readAsText(f);
}
function confirmImport() {
  if (!pendImport) return;
  DB = pendImport;
  pendImport = null;
  save(); toast('Данные загружены'); renderProf();
}
function cancelImport() { pendImport = null; renderProf(); }

RENDER.prof = function () {
  const el = $('tab-prof');
  const p = DB.profile || {};
  const nFood = Object.keys(DB.food).length;
  const nW = DB.weight.length;
  const nP = Object.keys(DB.period).length;

  el.innerHTML =
    cabinetCard() +
    '<div class="card"><h2>Обо мне</h2>' +
    '<label class="f">Имя</label><input id="pName" class="inp" value="' + esc(p.name || '') + '" placeholder="Кристина">' +
    '<div class="row">' +
    '<div><label class="f">Рост, см</label><input id="pH" class="inp" type="number" inputmode="numeric" value="' + (p.height || '') + '"></div>' +
    '<div><label class="f">Дата рождения</label><input id="pB" class="inp" type="date" value="' + esc(p.birth || '') + '"></div>' +
    '</div>' +
    '<label class="f">Цель</label><select id="pGoal" class="inp">' +
    '<option value=""' + (!p.goal ? ' selected' : '') + '>— выбрать —</option>' +
    '<option value="lose"' + (p.goal === 'lose' ? ' selected' : '') + '>Похудеть</option>' +
    '<option value="keep"' + (p.goal === 'keep' ? ' selected' : '') + '>Поддерживать вес</option>' +
    '<option value="gain"' + (p.goal === 'gain' ? ' selected' : '') + '>Набрать вес</option>' +
    '</select>' +
    '<label class="f">Желаемый вес, кг</label><input id="pGKg" class="inp" type="number" inputmode="decimal" value="' + (p.goalKg || '') + '" placeholder="куда стремлюсь">' +
    '<div style="margin-top:12px"><button class="btn" onclick="saveProfile()">Сохранить</button></div>' +
    '<div class="hint">Возраст считаю по дате сам — в день рождения норма обновится без вас. Норма калорий: рост, дата рождения и текущий вес (вкладка «Тело») плюс выбранная цель.</div>' +
    (p.goalKcal ? '<div class="hint" style="color:var(--sage-600)">Ваша норма сейчас: <b>~' + fmtInt(p.goalKcal) + ' ккал в день</b>' + (p.goalKg && latestKg() ? ' · до цели ' + fmt1(Math.abs(latestKg() - p.goalKg)) + ' кг' : '') + '</div>' : '') +
    '</div>' +
    (pendImport
      ? '<div class="card"><h2>Загрузка копии</h2><div class="hint" style="margin:0 0 10px">Заменить все записи дневника теми, что в файле? Текущие данные пропадут.</div>' +
        '<div class="row"><button class="btn" onclick="confirmImport()">Заменить</button><button class="btn ghost" onclick="cancelImport()">Отмена</button></div></div>'
      : '') +
    '<div class="card"><h2>Мои данные</h2>' +
    '<div class="hint" style="margin:0 0 10px">Дней с записями о еде: ' + nFood + ' · записей веса: ' + nW + ' · отмеченных дней цикла: ' + nP + '</div>' +
    '<div class="row"><button class="btn pink" onclick="exportData()">Скачать копию</button><button class="btn ghost" onclick="showDataText()">Текстом</button></div>' +
    '<button class="btn ghost" style="margin-top:8px;width:100%" onclick="importHistorySheet()">Перенести старые записи</button>' +
    '<label class="f">Восстановить из файла</label><input class="inp" type="file" accept=".json,application/json" onchange="importFile(this.files[0])">' +
    '<div class="hint">Все записи хранятся в этом приложении на телефоне. Раз в месяц скачивайте копию — это файл со всеми данными, ничего не потеряется.</div>' +
    '</div>';
};

/* ---------- запуск ---------- */

function updateTopDate() {
  const d = new Date();
  $('topDate').textContent = WD[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

let lastToday = todayKey();
setInterval(() => {
  updateTopDate();
  const k = todayKey();
  if (k !== lastToday) {
    lastToday = k;
    if (cur === 'cal') { selDate = k; renderCal(); }
    else if (cur === 'act') renderAct();
    else RENDER[cur]();
  }
}, 60000);

document.addEventListener('visibilitychange', () => { if (document.hidden) { persistSensor(); if (localStorage.getItem(DIRTY)) pushNow(true); } });
window.addEventListener('pagehide', persistSensor);
window.addEventListener('online', () => { if (localStorage.getItem(DIRTY)) pushNow(true); });

updateTopDate();
renderTabbar();
showTab('cal');

if (token) {
  (async () => {
    if (localStorage.getItem(DIRTY)) { await pushNow(true); return; }
    const before = +(localStorage.getItem(SYNC) || 0);
    const p = await pullNow(true);
    if (p && p.doc && p.ts > before) { applyDoc(p.doc); RENDER[cur](); }
  })();
} else if (!localStorage.getItem('dnevnik_hello')) {
  localStorage.setItem('dnevnik_hello', '1');
  openSheet(
    '<div class="sheet-head"><b>Кабинет в дневнике</b></div>' +
    '<div class="hint" style="margin:6px 0 14px">Записи можно хранить не только на телефоне, а в кабинете на сервере: с любого устройства, под своим паролем. Можно и без кабинета — тогда всё хранится только на телефоне.</div>' +
    '<button class="btn pink" style="width:100%;margin-bottom:8px" onclick="authSheet(\'reg\')">Создать кабинет</button>' +
    '<button class="btn ghost" style="width:100%" onclick="authSheet(\'in\')">У меня есть кабинет</button>' +
    '<div style="text-align:center;margin-top:10px"><button class="btn small ghost" onclick="closeSheet()">Пока без кабинета</button></div>'
  );
}
