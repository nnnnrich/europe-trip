'use strict';

/* =========================================================
   歐洲行 — offline-first trip planner
   資料存在 localStorage；有網路時透過 Supabase RPC 同步。
   ========================================================= */

const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const LS = { items: 'trip.items.v1', code: 'trip.code', cursor: 'trip.cursor', me: 'trip.me', tab: 'trip.tab', seg: 'trip.seg' };
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }

/* ---------------- data store ---------------- */

let items = new Map(Object.entries(lsGet(LS.items, {})));
const persist = () => lsSet(LS.items, Object.fromEntries(items));
const all = kind => [...items.values()].filter(i => i.kind === kind && !i.deleted);

function put(kind, data, id) {
  const it = { id: id || uid(), kind, data, updated_at: Date.now(), deleted: false, dirty: true };
  items.set(it.id, it);
  persist(); render(); scheduleSync();
  return it;
}
function remove(id) {
  const cur = items.get(id);
  if (!cur) return;
  items.set(id, { ...cur, deleted: true, updated_at: Date.now(), dirty: true });
  persist(); render(); scheduleSync();
}

/* ---------------- settings ---------------- */

const DEFAULTS = { name: '我的歐洲行', start: '', end: '', travelers: '', home: 'TWD', rates: 'EUR=35.5, CZK=1.45, HUF=0.09, AED=8.8, USD=32' };
const S = () => ({ ...DEFAULTS, ...(items.get('settings')?.data || {}) });
const travelers = () => S().travelers.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
function rates() {
  const r = { [S().home]: 1 };
  S().rates.split(/[,，\n]/).forEach(p => {
    const m = p.match(/([A-Za-z]{3})\s*[=:]\s*([\d.]+)/);
    if (m) r[m[1].toUpperCase()] = parseFloat(m[2]);
  });
  return r;
}
const currencies = () => Object.keys(rates());
const toHome = (amt, cur) => { const r = rates()[cur]; return r == null ? null : amt * r; };
const money = (n, cur) => `${cur === 'TWD' ? 'NT$' : cur === 'EUR' ? '€' : cur + ' '}${Math.round(n).toLocaleString('zh-TW')}`;

/* ---------------- dates ---------------- */

const WD = '日一二三四五六';
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtD = s => { if (!s) return ''; const d = pd(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);

/* ---------------- events (timeline) ---------------- */

const TRANSPORT_ICON = { 火車: '🚆', 巴士: '🚌', 租車: '🚗', 渡輪: '⛴️', 計程車: '🚕', 其他: '🚐' };
const CATS = { 住宿: '🛏', 交通: '🚆', 餐飲: '🍽', 門票: '🎟', 購物: '🛍', 其他: '💡' };

function events() {
  const ev = [];
  for (const f of all('flight')) {
    const d = f.data;
    const arr = d.arr_time ? ` → ${d.arr_date && d.arr_date !== d.dep_date ? fmtD(d.arr_date) + ' ' : ''}${d.arr_time} 抵達` : '';
    ev.push({ date: d.dep_date, time: d.dep_time, icon: '✈️', title: `${d.flight_no || '航班'}　${d.from || ''} → ${d.to || ''}`, sub: `${d.dep_term ? '航廈 ' + d.dep_term : ''}${arr}`, item: f });
    if (d.arr_date && d.arr_date !== d.dep_date)
      ev.push({ date: d.arr_date, time: d.arr_time, icon: '🛬', title: `抵達 ${d.to || ''}（${d.flight_no || ''}）`, sub: d.arr_term ? '航廈 ' + d.arr_term : '', item: f });
  }
  for (const t of all('transport')) {
    const d = t.data;
    const arr = d.arr_time ? ` → ${d.arr_date && d.arr_date !== d.dep_date ? fmtD(d.arr_date) + ' ' : ''}${d.arr_time} 抵達` : '';
    ev.push({ date: d.dep_date, time: d.dep_time, icon: TRANSPORT_ICON[d.type] || '🚐', title: `${d.from || ''} → ${d.to || ''}`, sub: `${d.number || d.type || ''}${arr}`, item: t });
  }
  for (const s of all('stay')) {
    const d = s.data;
    ev.push({ date: d.in_date, time: d.in_time, icon: '🏨', title: `入住 ${d.name || '住宿'}`, sub: d.address || '', item: s });
    if (d.out_date) ev.push({ date: d.out_date, time: d.out_time, icon: '🧳', title: `退房 ${d.name || '住宿'}`, sub: '', item: s });
  }
  for (const p of all('plan')) {
    const d = p.data;
    ev.push({ date: d.date, time: d.time, icon: d.icon || '📍', title: d.title || '行程', sub: [d.place, d.note].filter(Boolean).join(' · '), order: +d.order || 0, item: p });
  }
  return ev.filter(e => e.date).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')) || (a.order || 0) - (b.order || 0));
}

function tripRange() {
  let { start, end } = S();
  if (!start || !end) {
    const ds = events().map(e => e.date).sort();
    start = start || ds[0];
    end = end || ds[ds.length - 1];
  }
  return start && end && end >= start ? { start, end } : null;
}
const stayOn = date => all('stay').find(s => s.data.in_date && s.data.out_date && s.data.in_date <= date && date < s.data.out_date);

/* ---------------- rendering ---------------- */

let tab = lsGet(LS.tab, 'home');
let seg = lsGet(LS.seg, 'flight');
let pendingRender = false;

function render() {
  const ae = document.activeElement;
  if (ae && $('#view').contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) { pendingRender = true; return; }
  pendingRender = false;
  $('#trip-name').textContent = S().name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const html = { home: renderHome, days: renderDays, book: renderBook, money: renderMoney, list: renderList }[tab]();
  $('#view').innerHTML = html;
  renderSyncPill();
}

function evRow(e, showDate) {
  return `<div class="ev tap" data-edit="${e.item.id}">
    <div class="t">${esc(e.time || '')}${showDate ? `<div class="muted small">${esc(fmtD(e.date).replace(/（.）/, ''))}</div>` : ''}</div>
    <div class="i">${e.icon}</div>
    <div><div class="title">${esc(e.title)}</div>${e.sub ? `<div class="sub">${esc(e.sub)}</div>` : ''}</div>
  </div>`;
}

function stayCard(s, label) {
  const d = s.data;
  const nights = d.in_date && d.out_date ? diffDays(d.in_date, d.out_date) : null;
  const q = encodeURIComponent(d.address || d.name || '');
  return `<article class="card tap" data-edit="${s.id}">
    <div class="row between"><span class="tag green">${label || '住宿'}</span><span class="muted small">${esc(fmtD(d.in_date))} → ${esc(fmtD(d.out_date))}${nights ? ` · ${nights} 晚` : ''}</span></div>
    <h3 style="margin-top:6px">${esc(d.name || '住宿')}</h3>
    ${d.address ? `<div class="muted small">${esc(d.address)}</div>` : ''}
    <dl class="kv">
      ${d.in_time || d.out_time ? `<dt>時間</dt><dd>入住 ${esc(d.in_time || '—')} · 退房 ${esc(d.out_time || '—')}</dd>` : ''}
      ${d.pnr ? `<dt>訂位</dt><dd><button class="copy" data-copy="${esc(d.pnr)}">${esc(d.pnr)}</button>${d.platform ? ` <span class="muted small">${esc(d.platform)}</span>` : ''}</dd>` : ''}
      ${d.price ? `<dt>金額</dt><dd>${esc(d.price)}</dd>` : ''}
      ${d.note ? `<dt>備註</dt><dd>${esc(d.note)}</dd>` : ''}
    </dl>
    <div class="actions">
      ${q ? `<a class="btn" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">🗺 Apple 地圖</a><a class="btn" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Google 地圖</a>` : ''}
      ${d.phone ? `<a class="btn" href="tel:${esc(d.phone.replace(/[^\d+]/g, ''))}">📞 撥打</a>` : ''}
    </div>
  </article>`;
}

function flightCard(f) {
  const d = f.data;
  return `<article class="card tap" data-edit="${f.id}">
    <div class="row between"><span class="tag">${esc(d.flight_no || '航班')}</span><span class="muted small">${esc(fmtD(d.dep_date))}${d.airline ? ' · ' + esc(d.airline) : ''}</span></div>
    <div class="route">
      <div><b>${esc(d.from || '—')}</b><small>${esc(d.dep_time || '')}${d.dep_term ? ' · T' + esc(String(d.dep_term).replace(/^T/i, '')) : ''}</small></div>
      <div class="line">✈︎</div>
      <div class="r"><b>${esc(d.to || '—')}</b><small>${d.arr_date && d.arr_date !== d.dep_date ? esc(fmtD(d.arr_date).replace(/（.）/, '')) + ' ' : ''}${esc(d.arr_time || '')}${d.arr_term ? ' · T' + esc(String(d.arr_term).replace(/^T/i, '')) : ''}</small></div>
    </div>
    <dl class="kv">
      ${d.pnr ? `<dt>訂位代號</dt><dd><button class="copy" data-copy="${esc(d.pnr)}">${esc(d.pnr)}</button></dd>` : ''}
      ${d.seats ? `<dt>座位</dt><dd>${esc(d.seats)}</dd>` : ''}
      ${d.baggage ? `<dt>行李</dt><dd>${esc(d.baggage)}</dd>` : ''}
      ${d.note ? `<dt>備註</dt><dd>${esc(d.note)}</dd>` : ''}
    </dl>
  </article>`;
}

function transportCard(t) {
  const d = t.data;
  return `<article class="card tap" data-edit="${t.id}">
    <div class="row between"><span class="tag">${TRANSPORT_ICON[d.type] || '🚐'} ${esc(d.type || '交通')}</span><span class="muted small">${esc(fmtD(d.dep_date))}</span></div>
    <div class="route">
      <div><b style="font-size:19px">${esc(d.from || '—')}</b><small>${esc(d.dep_time || '')}</small></div>
      <div class="line">→</div>
      <div class="r"><b style="font-size:19px">${esc(d.to || '—')}</b><small>${esc(d.arr_time || '')}</small></div>
    </div>
    <dl class="kv">
      ${d.number ? `<dt>班次</dt><dd>${esc(d.number)}</dd>` : ''}
      ${d.pnr ? `<dt>訂位代號</dt><dd><button class="copy" data-copy="${esc(d.pnr)}">${esc(d.pnr)}</button></dd>` : ''}
      ${d.seats ? `<dt>座位</dt><dd>${esc(d.seats)}</dd>` : ''}
      ${d.station ? `<dt>上車地點</dt><dd>${esc(d.station)}</dd>` : ''}
      ${d.price ? `<dt>金額</dt><dd>${esc(d.price)}</dd>` : ''}
      ${d.note ? `<dt>備註</dt><dd>${esc(d.note)}</dd>` : ''}
    </dl>
  </article>`;
}

function renderHome() {
  const range = tripRange();
  const t = today();
  let hero;
  if (!range) {
    hero = `<div class="label">還沒設定日期</div><div class="count">開始規劃吧</div><div class="range">到 ⚙︎ 設定旅程日期，或先新增機票</div>`;
  } else if (t < range.start) {
    hero = `<div class="label">距離出發</div><div class="count">${diffDays(t, range.start)} 天</div>`;
  } else if (t <= range.end) {
    hero = `<div class="label">旅程進行中</div><div class="count">第 ${diffDays(range.start, t) + 1} 天<span style="font-size:18px;opacity:.75"> / ${diffDays(range.start, range.end) + 1}</span></div>`;
  } else {
    hero = `<div class="label">旅程結束</div><div class="count">歡迎回家 🏡</div>`;
  }
  if (range) hero += `<div class="range">${fmtD(range.start)} – ${fmtD(range.end)}・${diffDays(range.start, range.end) + 1} 天</div>`;

  let out = `<section class="card hero">${hero}</section>`;

  const now = t + 'T' + nowHM();
  const upcoming = events().filter(e => e.date + 'T' + (e.time || '23:59') >= now);
  if (upcoming.length) {
    out += `<div class="section-title">接下來</div><div class="ev-list">${upcoming.slice(0, 4).map(e => evRow(e, true)).join('')}</div>`;
  }

  const inTrip = range && t >= range.start && t <= range.end;
  const stay = stayOn(inTrip ? t : (range ? range.start : t));
  if (stay) out += `<div class="section-title">${inTrip ? '今晚住這裡' : '第一晚住這裡'}</div>${stayCard(stay, inTrip ? '今晚' : '第一晚')}`;

  const exps = all('expense');
  if (exps.length) {
    const home = S().home;
    const total = exps.reduce((s, e) => s + (toHome(+e.data.amount || 0, e.data.currency || home) || 0), 0);
    out += `<div class="section-title">花費</div><div class="card tap" data-tab="money"><div class="row between"><span class="muted">目前總花費</span><span class="big">${money(total, home)}</span></div></div>`;
  }

  const todo = all('check').filter(c => !c.data.done);
  if (todo.length) {
    out += `<div class="section-title">待辦 <span>${todo.length} 項</span></div><div class="ev-list">${todo.slice(0, 4).map(chkRow).join('')}</div>`;
  }

  if (!upcoming.length && !stay && !exps.length && !todo.length) {
    out += `<div class="empty"><b>🧭</b>還沒有資料。到「訂位」新增機票和住宿，或到「行程」排每天要去的地方。</div>`;
  }
  return out;
}

function renderDays() {
  const range = tripRange();
  const evs = events();
  if (!range) return `<div class="empty"><b>🗓</b>到 ⚙︎ 設定旅程的開始與結束日期，這裡就會出現每一天。</div>` + `<button class="fab" data-new="plan">+</button>`;
  const t = today();
  let out = '';
  // events outside range still show
  const dates = new Set();
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) dates.add(d);
  evs.forEach(e => dates.add(e.date));
  [...dates].sort().forEach(date => {
    const dayEvs = evs.filter(e => e.date === date);
    const n = diffDays(range.start, date) + 1;
    const stay = stayOn(date);
    out += `<section class="day${date === t ? ' today' : ''}" id="d-${date}">
      <div class="day-head"><h3>${fmtD(date)}</h3><span class="muted small">${n >= 1 && date <= range.end ? 'Day ' + n : ''}${date === t ? ' · 今天' : ''}</span><button class="add" data-new="plan" data-date="${date}">＋ 新增</button></div>
      <div class="ev-list">
        ${dayEvs.length ? dayEvs.map(e => evRow(e)).join('') : `<div class="ev"><div></div><div></div><div class="muted small">尚未安排</div></div>`}
        ${stay ? `<div class="sleep tap" data-edit="${stay.id}">🛏 住：${esc(stay.data.name || '')}</div>` : ''}
      </div>
    </section>`;
  });
  return out + `<button class="fab" data-new="plan">+</button>`;
}

function renderBook() {
  const segs = [['flight', '✈️ 機票'], ['transport', '🚆 交通'], ['stay', '🏨 住宿']];
  let out = `<div class="seg">${segs.map(([k, l]) => `<button data-seg="${k}" class="${seg === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (seg === 'flight') {
    const list = all('flight').sort((a, b) => ((a.data.dep_date || '') + (a.data.dep_time || '')).localeCompare((b.data.dep_date || '') + (b.data.dep_time || '')));
    out += list.length ? list.map(flightCard).join('') : `<div class="empty"><b>✈️</b>還沒有機票，按右下角 ＋ 新增</div>`;
  } else if (seg === 'transport') {
    const list = all('transport').sort((a, b) => ((a.data.dep_date || '') + (a.data.dep_time || '')).localeCompare((b.data.dep_date || '') + (b.data.dep_time || '')));
    out += list.length ? list.map(transportCard).join('') : `<div class="empty"><b>🚆</b>還沒有火車、巴士或租車，按右下角 ＋ 新增</div>`;
  } else {
    const list = all('stay').sort((a, b) => (a.data.in_date || '').localeCompare(b.data.in_date || ''));
    out += list.length ? list.map(s => stayCard(s)).join('') : `<div class="empty"><b>🏨</b>還沒有住宿，按右下角 ＋ 新增</div>`;
  }
  return out + `<button class="fab" data-new="${seg}">+</button>`;
}

function renderMoney() {
  const home = S().home;
  const people = travelers();
  const exps = all('expense').sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  if (!exps.length) return `<div class="empty"><b>💶</b>還沒有花費紀錄，按右下角 ＋ 記一筆<br><span class="small">匯率可以在 ⚙︎ 設定裡調整</span></div><button class="fab" data-new="expense">+</button>`;

  let total = 0, unknown = new Set();
  const byCat = {}, paid = {}, owed = {};
  people.forEach(p => { paid[p] = 0; owed[p] = 0; });
  for (const e of exps) {
    const d = e.data, cur = d.currency || home;
    const v = toHome(+d.amount || 0, cur);
    if (v == null) { unknown.add(cur); continue; }
    total += v;
    byCat[d.category || '其他'] = (byCat[d.category || '其他'] || 0) + v;
    if (people.length > 1 && d.payer && paid[d.payer] != null) {
      paid[d.payer] += v;
      const share = d.split && people.includes(d.split) ? [d.split] : people;
      share.forEach(p => owed[p] += v / share.length);
    }
  }

  let out = `<div class="stat-row">
    <div class="card"><div class="muted small">總花費</div><div class="big">${money(total, home)}</div></div>
    <div class="card"><div class="muted small">${people.length > 1 ? '每人平均' : '筆數'}</div><div class="big">${people.length > 1 ? money(total / people.length, home) : exps.length}</div></div>
  </div>`;
  if (unknown.size) out += `<p class="hint">⚠️ 找不到 ${[...unknown].join('、')} 的匯率，沒算進總額。請到設定補上。</p>`;

  if (people.length > 1) {
    const bal = people.map(p => ({ p, v: paid[p] - owed[p] }));
    const debt = bal.filter(b => b.v < -1).map(b => ({ ...b })), cred = bal.filter(b => b.v > 1).map(b => ({ ...b }));
    const lines = [];
    for (const d of debt) for (const c of cred) {
      const x = Math.min(-d.v, c.v);
      if (x > 1) { lines.push(`<div class="settle"><b>${esc(d.p)}</b> 要給 <b>${esc(c.p)}</b> ${money(x, home)}</div>`); d.v += x; c.v -= x; }
    }
    out += `<div class="section-title">分帳</div><div class="card">${lines.join('') || '<div class="settle">目前帳是平的 👍</div>'}
      <div class="muted small" style="margin-top:6px">${people.map(p => `${esc(p)} 已付 ${money(paid[p], home)}`).join(' · ')}</div></div>`;
  }

  out += `<div class="section-title">分類</div><div class="card">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
    `<div class="cat-row"><div class="row between"><span>${CATS[c] || '💡'} ${esc(c)}</span><span>${money(v, home)}</span></div><div class="bar"><i style="width:${total ? (v / total * 100).toFixed(1) : 0}%"></i></div></div>`).join('')}</div>`;

  out += `<div class="section-title">明細</div><div class="ev-list">${exps.map(e => {
    const d = e.data, cur = d.currency || home, v = toHome(+d.amount || 0, cur);
    return `<div class="exp" data-edit="${e.id}"><div class="ic">${CATS[d.category] || '💡'}</div>
      <div class="mid"><div>${esc(d.title || d.category || '花費')}</div><div class="muted small">${esc(fmtD(d.date))}${d.payer ? ' · ' + esc(d.payer) + ' 付' : ''}${d.split ? ' · 只算 ' + esc(d.split) : ''}</div></div>
      <div class="amt"><div>${money(+d.amount || 0, cur)}</div>${cur !== home && v != null ? `<div class="muted small">≈ ${money(v, home)}</div>` : ''}</div></div>`;
  }).join('')}</div>`;
  return out + `<button class="fab" data-new="expense">+</button>`;
}

const CHECK_GROUPS = ['行前準備', '預約訂票', '行李', '其他'];
function chkRow(c) {
  return `<div class="chk${c.data.done ? ' done' : ''}">
    <span class="box" data-toggle="${c.id}">${c.data.done ? '✓' : ''}</span>
    <span class="txt" data-toggle="${c.id}">${esc(c.data.text)}</span>
    <button class="edit" data-edit="${c.id}" aria-label="編輯">✎</button>
  </div>`;
}
function renderList() {
  const checks = all('check');
  let out = `<form class="add-row" data-form="quick-check">
    <input name="text" placeholder="新增待辦或行李…" autocomplete="off" enterkeyhint="done">
    <select name="group">${CHECK_GROUPS.map(g => `<option>${g}</option>`).join('')}</select>
    <button class="btn primary" type="submit">加入</button>
  </form>`;
  const groups = [...new Set([...CHECK_GROUPS, ...checks.map(c => c.data.group || '其他')])];
  for (const g of groups) {
    const list = checks.filter(c => (c.data.group || '其他') === g).sort((a, b) => (a.data.done - b.data.done) || (a.data.order || 0) - (b.data.order || 0));
    if (!list.length) continue;
    const done = list.filter(c => c.data.done).length;
    out += `<div class="section-title">${esc(g)} <span>${done}/${list.length}</span></div><div class="ev-list">${list.map(chkRow).join('')}</div>`;
  }
  if (!checks.length) out += `<div class="empty"><b>✅</b>出發前要準備的東西、要預約的景點都可以記在這裡</div>`;
  return out;
}

/* ---------------- forms ---------------- */

const opt = arr => arr.map(v => Array.isArray(v) ? v : [v, v]);
const FORMS = {
  flight: { title: '機票', fields: () => [
    ['flight_no', '航班號', 'text', { half: 1, ph: 'EK139' }], ['airline', '航空公司', 'text', { half: 1 }],
    ['from', '出發機場', 'text', { half: 1, ph: 'TPE' }], ['to', '抵達機場', 'text', { half: 1, ph: 'PRG' }],
    ['dep_date', '出發日期', 'date', { half: 1 }], ['dep_time', '出發時間', 'time', { half: 1 }],
    ['arr_date', '抵達日期', 'date', { half: 1 }], ['arr_time', '抵達時間', 'time', { half: 1 }],
    ['dep_term', '出發航廈', 'text', { half: 1 }], ['arr_term', '抵達航廈', 'text', { half: 1 }],
    ['pnr', '訂位代號', 'text', { half: 1 }], ['seats', '座位', 'text', { half: 1 }],
    ['baggage', '行李', 'text'], ['note', '備註', 'textarea']] },
  transport: { title: '交通', fields: () => [
    ['type', '類型', 'select', { half: 1, options: opt(Object.keys(TRANSPORT_ICON)) }], ['number', '班次 / 公司', 'text', { half: 1, ph: 'RJ 1031' }],
    ['from', '出發地', 'text', { half: 1, ph: 'Praha hl.n.' }], ['to', '目的地', 'text', { half: 1, ph: 'Wien Hbf' }],
    ['dep_date', '出發日期', 'date', { half: 1 }], ['dep_time', '出發時間', 'time', { half: 1 }],
    ['arr_date', '抵達日期', 'date', { half: 1 }], ['arr_time', '抵達時間', 'time', { half: 1 }],
    ['pnr', '訂位代號', 'text', { half: 1 }], ['seats', '車廂 / 座位', 'text', { half: 1 }],
    ['station', '上車地點', 'text'], ['price', '金額', 'text'], ['note', '備註', 'textarea']] },
  stay: { title: '住宿', fields: () => [
    ['name', '名稱', 'text', { ph: '飯店 / Airbnb 名稱' }], ['address', '地址', 'text'],
    ['in_date', '入住日期', 'date', { half: 1 }], ['in_time', '入住時間', 'time', { half: 1 }],
    ['out_date', '退房日期', 'date', { half: 1 }], ['out_time', '退房時間', 'time', { half: 1 }],
    ['pnr', '訂位代號', 'text', { half: 1 }], ['platform', '訂房平台', 'text', { half: 1, ph: 'Booking.com' }],
    ['phone', '電話', 'tel', { half: 1 }], ['price', '金額', 'text', { half: 1 }],
    ['note', '備註', 'textarea', { ph: '門禁密碼、自助入住方式…' }]] },
  plan: { title: '行程', fields: () => [
    ['title', '要做什麼', 'text', { ph: '查理大橋看日出' }],
    ['date', '日期', 'date', { half: 1 }], ['time', '時間', 'time', { half: 1 }],
    ['place', '地點', 'text'], ['link', '連結', 'url'], ['note', '備註', 'textarea']] },
  expense: { title: '花費', fields: () => {
    const ppl = travelers();
    return [
      ['title', '項目', 'text', { ph: '晚餐、地鐵票…' }],
      ['amount', '金額', 'number', { half: 1, step: 'any' }], ['currency', '幣別', 'select', { half: 1, options: opt(currencies()) }],
      ['category', '分類', 'select', { half: 1, options: opt(Object.keys(CATS)) }], ['date', '日期', 'date', { half: 1 }],
      ...(ppl.length ? [['payer', '誰付的', 'select', { half: 1, options: opt(ppl) }],
      ['split', '分攤', 'select', { half: 1, options: [['', '全員平分'], ...ppl.map(p => [p, '只算 ' + p])] }]] : []),
      ['note', '備註', 'textarea']];
  } },
  check: { title: '待辦', fields: () => [
    ['text', '內容', 'text'], ['group', '分組', 'select', { half: 1, options: opt(CHECK_GROUPS) }],
    ['done', '狀態', 'select', { half: 1, options: [['', '未完成'], ['1', '已完成']] }]] },
};

let editing = null; // { kind, id }

function fieldHtml([k, label, type, o = {}], val) {
  const v = val ?? '';
  let input;
  if (type === 'select') input = `<select name="${k}">${o.options.map(([ov, ol]) => `<option value="${esc(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea name="${k}" placeholder="${esc(o.ph || '')}">${esc(v)}</textarea>`;
  else input = `<input name="${k}" type="${type}" value="${esc(v)}" placeholder="${esc(o.ph || '')}"${o.step ? ` step="${o.step}"` : ''}${type === 'number' ? ' inputmode="decimal"' : ''}>`;
  return `<label class="${o.half ? 'half' : ''}">${label}${input}</label>`;
}

function openForm(kind, id, preset = {}) {
  const f = FORMS[kind];
  const cur = id ? items.get(id) : null;
  const data = cur ? cur.data : defaultsFor(kind, preset);
  editing = { kind, id };
  $('#sheet-title').textContent = (cur ? '編輯' : '新增') + f.title;
  $('#sheet-body').innerHTML = `<form class="form" id="edit-form">${f.fields().map(fd => fieldHtml(fd, data[fd[0]])).join('')}</form>
    ${kind === 'plan' && (data.place || data.link) ? `<div class="actions">
      ${data.place ? `<a class="btn" href="https://maps.apple.com/?q=${encodeURIComponent(data.place)}" target="_blank" rel="noopener">🗺 Apple 地圖</a><a class="btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.place)}" target="_blank" rel="noopener">Google 地圖</a>` : ''}
      ${data.link ? `<a class="btn" href="${esc(data.link)}" target="_blank" rel="noopener">開啟連結 ↗</a>` : ''}</div>` : ''}
    ${cur ? `<button class="danger" data-action="delete">刪除</button>` : ''}`;
  showSheet();
}

function defaultsFor(kind, preset) {
  const t = today();
  const range = tripRange();
  const inTrip = range && t >= range.start && t <= range.end;
  const d = { ...preset };
  if (kind === 'expense') {
    d.date = d.date || t;
    d.currency = d.currency || (currencies().includes('EUR') ? 'EUR' : S().home);
    d.category = d.category || '餐飲';
    d.payer = d.payer || lsGet(LS.me, travelers()[0] || '');
  }
  if (kind === 'plan' && !d.date) d.date = inTrip ? t : (range ? range.start : t);
  if (kind === 'transport') d.type = d.type || '火車';
  if (kind === 'check') d.group = d.group || '行前準備';
  return d;
}

function saveForm() {
  if (editing?.kind === 'settings') return saveSettings();
  const form = $('#edit-form');
  if (!form || !editing) return;
  const data = { ...(editing.id ? items.get(editing.id)?.data : {}) };
  for (const [k, v] of new FormData(form)) data[k] = typeof v === 'string' ? v.trim() : v;
  if (editing.kind === 'check') data.done = !!data.done;
  if (editing.kind === 'expense' && !(parseFloat(data.amount) > 0)) return toast('請輸入金額');
  if (editing.kind === 'expense' && data.payer) lsSet(LS.me, data.payer);
  put(editing.kind, data, editing.id);
  closeSheet();
}

function showSheet() { $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet() {
  $('#sheet').hidden = true; document.body.style.overflow = ''; editing = null;
  if (pendingRender) render();
}

/* ---------------- settings sheet ---------------- */

function openSettings() {
  const s = S();
  editing = { kind: 'settings' };
  const code = lsGet(LS.code, '');
  const syncOn = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  $('#sheet-title').textContent = '設定';
  $('#sheet-body').innerHTML = `
    <form class="form" id="edit-form">
      ${fieldHtml(['name', '旅程名稱', 'text'], s.name)}
      ${fieldHtml(['start', '開始日期', 'date', { half: 1 }], s.start)}
      ${fieldHtml(['end', '結束日期', 'date', { half: 1 }], s.end)}
      ${fieldHtml(['travelers', '旅伴（用逗號分隔，記帳分帳會用到）', 'text', { ph: '小明, 小華' }], s.travelers)}
      ${fieldHtml(['home', '主要幣別', 'text', { half: 1, ph: 'TWD' }], s.home)}
      <label class="half">&nbsp;<span class="hint" style="margin:8px 0 0">總額都換算成這個幣別</span></label>
      ${fieldHtml(['rates', '匯率（1 外幣 = 多少主要幣別）', 'textarea'], s.rates)}
    </form>

    <div class="settings-block">
      <h3>👥 和旅伴同步</h3>
      ${!syncOn ? `<p class="hint">尚未設定 Supabase（config.js），目前資料只存在這支手機。</p>` : code ? `
        <div class="code-box">${esc(code)}</div>
        <div class="actions"><button class="btn" data-copy="${esc(code)}">複製行程代碼</button><button class="btn" data-action="leave">更換代碼</button></div>
        <p class="hint">把這組代碼傳給旅伴，請對方在自己的 app 裡「加入行程」輸入同一組代碼，就會看到同一份資料。代碼等同密碼，不要公開。</p>` : `
        <div class="actions"><button class="btn primary" data-action="newcode">建立新行程代碼</button></div>
        <p class="hint" style="margin-top:12px">或輸入旅伴給你的代碼：</p>
        <div class="add-row" style="margin-top:6px"><input id="join-code" placeholder="trip-xxxx-xxxx-xxxx-xxxx" autocapitalize="off" autocomplete="off"><button class="btn primary" data-action="join">加入</button></div>`}
    </div>

    <div class="settings-block">
      <h3>💾 備份</h3>
      <div class="actions"><button class="btn" data-action="export">匯出備份</button><button class="btn" data-action="import">匯入備份</button></div>
      <div id="backup-area"></div>
      <p class="hint">資料都存在這支手機上，沒有網路也能看、也能改；連上網路後會自動同步。</p>
    </div>`;
  showSheet();
}

function saveSettings() {
  const data = { ...(items.get('settings')?.data || {}) };
  for (const [k, v] of new FormData($('#edit-form'))) data[k] = v.trim();
  data.home = (data.home || 'TWD').toUpperCase();
  put('settings', data, 'settings');
  closeSheet();
}

function genCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(16));
  const s = [...b].map(x => abc[x % abc.length]).join('');
  return `trip-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
function setCode(code) {
  lsSet(LS.code, code);
  lsSet(LS.cursor, 0);
  // push everything we already have on this phone into the shared trip
  for (const [id, it] of items) items.set(id, { ...it, dirty: true });
  persist();
  sync(true);
}

/* ---------------- sync ---------------- */

let syncState = 'idle', syncTimer = null, syncing = false, fullPullDone = false;

async function rpc(fn, body) {
  const r = await fetch(`${CFG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 1200); }

async function sync(force) {
  const code = lsGet(LS.code, '');
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !code) { syncState = 'off'; renderSyncPill(); return; }
  if (syncing) { if (force) scheduleSync(); return; }
  if (!navigator.onLine) { syncState = 'offline'; renderSyncPill(); return; }
  syncing = true; syncState = 'syncing'; renderSyncPill();
  try {
    const dirty = [...items.values()].filter(i => i.dirty);
    if (dirty.length) {
      await rpc('push_items', { p_code: code, p_items: dirty.map(({ id, kind, data, updated_at, deleted }) => ({ id, kind, data, updated_at, deleted })) });
      // only clear the flag if the item wasn't edited again while we were pushing
      dirty.forEach(i => { if (items.get(i.id) === i) items.set(i.id, { ...i, dirty: false }); });
      persist();
    }
    const since = fullPullDone ? lsGet(LS.cursor, 0) : 0;
    const rows = await rpc('pull_items', { p_code: code, p_since: since }) || [];
    let cursor = since, changed = false;
    for (const r of rows) {
      cursor = Math.max(cursor, Number(r.rev));
      const cur = items.get(r.id);
      const remote = { id: r.id, kind: r.kind, data: r.data, updated_at: Number(r.updated_at), deleted: r.deleted, dirty: false };
      if (!cur || (cur.dirty ? remote.updated_at > cur.updated_at : remote.updated_at >= cur.updated_at)) {
        if (!cur || JSON.stringify(cur.data) !== JSON.stringify(remote.data) || cur.deleted !== remote.deleted) changed = true;
        items.set(r.id, remote);
      }
    }
    fullPullDone = true;
    lsSet(LS.cursor, cursor);
    persist();
    syncState = 'ok';
    if (changed) render();
  } catch (e) {
    console.warn('sync failed', e);
    syncState = navigator.onLine ? 'error' : 'offline';
  } finally {
    syncing = false;
    renderSyncPill();
  }
}

function renderSyncPill() {
  const pill = $('#sync-pill');
  const dirty = [...items.values()].some(i => i.dirty);
  const map = {
    off: ['僅存本機', ''], idle: ['…', ''], syncing: ['同步中…', ''],
    ok: dirty ? ['待同步', ''] : ['已同步 ✓', 'ok'], offline: ['離線中', ''], error: ['同步失敗', 'err'],
  };
  const [label, cls] = map[syncState] || map.idle;
  pill.textContent = label;
  pill.className = 'pill ' + cls;
}

/* ---------------- backup ---------------- */

function exportBackup() {
  const data = { version: 1, exported_at: new Date().toISOString(), items: [...items.values()].filter(i => !i.deleted).map(({ id, kind, data, updated_at }) => ({ id, kind, data, updated_at })) };
  const json = JSON.stringify(data);
  $('#backup-area').innerHTML = `<textarea readonly style="margin-top:10px;font-size:12px;min-height:110px">${esc(json)}</textarea><div class="actions"><button class="btn" data-copy="${esc(json)}">複製全部</button></div>`;
}
function showImport() {
  $('#backup-area').innerHTML = `<textarea id="import-text" placeholder="貼上備份內容" style="margin-top:10px;font-size:12px;min-height:110px"></textarea><div class="actions"><button class="btn primary" data-action="do-import">匯入</button></div>`;
}
function doImport() {
  try {
    const data = JSON.parse($('#import-text').value);
    let n = 0;
    for (const it of data.items || []) {
      if (!it.id || !it.kind) continue;
      const cur = items.get(it.id);
      if (cur && cur.updated_at > (it.updated_at || 0)) continue;
      items.set(it.id, { id: it.id, kind: it.kind, data: it.data || {}, updated_at: Date.now(), deleted: false, dirty: true });
      n++;
    }
    persist(); closeSheet(); render(); scheduleSync();
    toast(`已匯入 ${n} 筆`);
  } catch { toast('格式不正確'); }
}

/* ---------------- events wiring ---------------- */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 1600);
}

async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast('已複製'); }
  catch { toast(s); }
}

document.addEventListener('click', e => {
  if (e.target.closest('a[href]')) return; // map / phone links open normally
  const el = e.target.closest('[data-copy],[data-toggle],[data-edit],[data-new],[data-tab],[data-seg],[data-action]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.copy != null) { e.preventDefault(); return copyText(ds.copy); }
  if (ds.toggle) {
    const c = items.get(ds.toggle);
    return put('check', { ...c.data, done: !c.data.done }, c.id);
  }
  if (ds.edit) { const it = items.get(ds.edit); return it && openForm(it.kind, it.id); }
  if (ds.new) return openForm(ds.new, null, ds.date ? { date: ds.date } : {});
  if (ds.tab) {
    tab = ds.tab; lsSet(LS.tab, tab); render(); window.scrollTo(0, 0);
    if (tab === 'days') requestAnimationFrame(() => document.getElementById('d-' + today())?.scrollIntoView());
    return;
  }
  if (ds.seg) { seg = ds.seg; lsSet(LS.seg, seg); return render(); }
  switch (ds.action) {
    case 'close': return closeSheet();
    case 'save': return saveForm();
    case 'settings': return openSettings();
    case 'sync': return sync(true);
    case 'delete':
      if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = '再按一次確認刪除'; return; }
      remove(editing.id); return closeSheet();
    case 'newcode': setCode(genCode()); return openSettings();
    case 'join': {
      const v = $('#join-code').value.trim().toLowerCase();
      if (v.length < 12) return toast('代碼不正確');
      setCode(v); toast('已加入，正在同步…'); return openSettings();
    }
    case 'leave':
      if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = '確定？再按一次'; return; }
      lsSet(LS.code, ''); syncState = 'off'; return openSettings();
    case 'export': return exportBackup();
    case 'import': return showImport();
    case 'do-import': return doImport();
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.dataset.form === 'quick-check') {
    const fd = new FormData(e.target);
    const text = String(fd.get('text') || '').trim();
    if (!text) return;
    const input = e.target.querySelector('input');
    input.value = ''; input.blur();
    put('check', { text, group: fd.get('group'), done: false, order: Date.now() });
  } else if (e.target.id === 'edit-form') saveForm();
});

document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && $('#sheet').hidden) render(); }, 0));
window.addEventListener('online', () => sync());
window.addEventListener('offline', () => { syncState = 'offline'; renderSyncPill(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); sync(); } });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);

/* ---------------- boot ---------------- */

(function boot() {
  const join = new URLSearchParams(location.search).get('join');
  if (join && !lsGet(LS.code, '')) { setCode(join.trim().toLowerCase()); history.replaceState(null, '', location.pathname); }
  render();
  if (tab === 'days') document.getElementById('d-' + today())?.scrollIntoView();
  sync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
