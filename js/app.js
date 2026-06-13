/* Poker Tracker — views, routing, and interactions. */

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function parseNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.round(n * 100) / 100;
  const prefix = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  const hasCents = Math.abs(v) % 1 !== 0;
  return prefix + '$' + Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function netClass(n) {
  if (n == null) return 'muted';
  return n >= 0 ? 'pos' : 'neg';
}

function fmtDur(hours) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDateNice(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- modal (bottom sheet) ----------
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><div class="sheet">${html}</div></div>`;
  const overlay = $('.overlay', root);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  return root;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

// Wrap an async click handler so a double-tap can't fire it twice (which would
// write duplicate rows). Disables the button for the duration; re-enables it
// afterward so a validation failure can be corrected and retried.
function guardedClick(btn, handler) {
  if (!btn) return;
  let busy = false;
  btn.addEventListener('click', async (e) => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      await handler(e);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}

function confirmModal({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const root = openModal(`
      <h2>${esc(title)}</h2>
      <p class="muted" style="margin-top:0">${esc(body)}</p>
      <button id="cm-ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirmLabel)}</button>
      <button id="cm-cancel" class="btn">Cancel</button>
    `);
    const overlay = $('.overlay', root);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) resolve(false);
    });
    $('#cm-ok', root).addEventListener('click', () => { closeModal(); resolve(true); });
    $('#cm-cancel', root).addEventListener('click', () => { closeModal(); resolve(false); });
  });
}

// ---------- app state ----------
const App = {
  rec: null,          // active MediaRecorder
  recStart: 0,
  recTimer: null,
  liveTimer: null,
  audioUrls: [],
  installPrompt: null,
  reviewFilter: 'raw',
  statsFilters: { from: '', to: '', venue: '', stakes: '', game: '' },
};

const POSITIONS = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const PRESET_TAGS = ['3bet-pot', '4bet-pot', 'bluff', 'bluff-catch', 'value', 'cooler', 'big-pot', 'review'];
const CONDITION_TAGS = ['A-game', 'B-game', 'C-game', 'well-rested', 'tired', 'tilted', 'focused', 'distracted'];

// ---------- router ----------
async function render() {
  // cleanup from previous view
  if (App.rec && App.rec.state !== 'inactive') {
    try { App.rec.stop(); } catch (e) { /* already stopped */ }
  }
  clearInterval(App.liveTimer); App.liveTimer = null;
  clearInterval(App.recTimer); App.recTimer = null;
  App.audioUrls.forEach((u) => URL.revokeObjectURL(u));
  App.audioUrls = [];

  const hash = location.hash.slice(1) || 'home';
  const [name, arg] = hash.split('/');

  try {
    if (name === 'home') await renderHome();
    else if (name === 'session' && arg) await renderSessionDetail(arg);
    else if (name === 'session') await renderActive();
    else if (name === 'review') await renderReview();
    else if (name === 'stats') await renderStats();
    else { location.hash = 'home'; return; }
  } catch (err) {
    $('#view').innerHTML = `<div class="empty">Something went wrong: ${esc(err.message)}</div>`;
  }

  $$('#tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === (arg && name === 'session' ? 'home' : name));
  });
  updateReviewBadge();
}

async function updateReviewBadge() {
  const n = await DB.rawHandCount();
  const badge = $('#review-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : n;
}

function audioUrlFor(hand) {
  if (!(hand.audio instanceof Blob) || hand.audio.size === 0) return null;
  const url = URL.createObjectURL(hand.audio);
  App.audioUrls.push(url);
  return url;
}

// ---------- HOME ----------
async function renderHome() {
  const rows = await DB.allSessionsWithComputed();
  const active = rows.find((r) => r.session.status === 'active');
  const completed = rows.filter((r) => r.session.status === 'completed' && r.net != null);
  const st = computeStats(completed);
  const lastBackup = await DB.getMeta('lastBackup');

  const backupAge = lastBackup ? (Date.now() - new Date(lastBackup)) / 8.64e7 : null;
  const backupLine = lastBackup
    ? `Last backup: ${fmtDateTime(lastBackup)}${backupAge > 7 ? ' ⚠️' : ''}`
    : 'No backup yet ⚠️ — your phone is the only copy of this data.';

  const recent = rows.slice(0, 10);

  $('#view').innerHTML = `
    <h1>Poker Tracker</h1>

    ${active ? `
      <button id="resume-btn" class="btn primary giant">▶ Resume live session — ${esc(active.session.venue)}</button>
    ` : `
      <button id="start-btn" class="btn primary giant">♠ Start Session</button>
    `}

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Lifetime net</div><div class="value ${netClass(st.totalNet)}">${st.count ? fmtMoney(st.totalNet, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">$ / hour</div><div class="value ${netClass(st.rate)}">${st.rate != null ? fmtMoney(st.rate, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">Hours played</div><div class="value">${fmtDur(st.totalHours)}</div></div>
      <div class="stat-card"><div class="label">Sessions</div><div class="value">${st.count}</div></div>
    </div>

    <h3>Recent sessions</h3>
    ${recent.length ? recent.map((r) => sessionRowHTML(r)).join('') : `
      <div class="empty">No sessions yet.<br>Tap <b>Start Session</b> when you sit down with chips.</div>
    `}

    <h3>Backup</h3>
    <div class="card">
      <div class="small ${lastBackup && backupAge <= 7 ? 'muted' : 'backup-warn'}" style="margin-bottom:10px">${backupLine}</div>
      ${App.persisted === false ? `<div class="small backup-warn" style="margin-bottom:10px">⚠️ Storage isn’t marked persistent yet — Chrome could clear this data if the phone runs low on space. Installing the app to your home screen fixes this; until then, keep a recent backup.</div>` : ''}
      <button id="export-zip" class="btn">⬇ Export full backup (zip)</button>
      <div class="row2">
        <button id="export-sessions" class="btn">Sessions CSV</button>
        <button id="export-hands" class="btn">Hands CSV</button>
      </div>
      <button id="import-btn" class="btn">⬆ Restore from backup</button>
      <input id="import-file" type="file" accept=".zip,application/zip" hidden>
      <div class="small muted">Export regularly and save the zip to Google Drive — this app stores everything on your phone only.</div>
    </div>

    ${App.installPrompt ? `<button id="install-btn" class="btn">➕ Install to home screen</button>` : ''}
  `;

  if (active) $('#resume-btn').addEventListener('click', () => { location.hash = 'session'; });
  else $('#start-btn').addEventListener('click', openStartSessionModal);

  $$('.session-row').forEach((el) => {
    el.addEventListener('click', () => { location.hash = 'session/' + el.dataset.id; });
  });

  $('#export-zip').addEventListener('click', async () => {
    try {
      await exportZipBackup();
      toast('Backup downloaded');
      render();
    } catch (e) { toast('Export failed: ' + e.message); }
  });
  $('#export-sessions').addEventListener('click', () => exportSessionsCSV().then(() => toast('Sessions CSV downloaded')).catch((e) => toast('Export failed: ' + e.message)));
  $('#export-hands').addEventListener('click', () => exportHandsCSV().then(() => toast('Hands CSV downloaded')).catch((e) => toast('Export failed: ' + e.message)));

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmModal({
      title: 'Restore from backup?',
      body: 'Rows from the backup are added back. If a session already exists on this phone, the backup version replaces it. Nothing else is deleted.',
      confirmLabel: 'Restore',
    });
    if (!ok) { e.target.value = ''; return; }
    try {
      const res = await importZipBackup(file);
      toast(`Restored ${res.sessions} sessions, ${res.hands} hands`);
      render();
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });

  const installBtn = $('#install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      App.installPrompt.prompt();
      await App.installPrompt.userChoice;
      App.installPrompt = null;
      render();
    });
  }
}

function sessionRowHTML(r) {
  const s = r.session;
  const live = s.status === 'active';
  return `
    <div class="session-row" data-id="${esc(s.id)}">
      <div class="main">
        <span class="title">${esc(s.venue)} · ${esc(s.stakes)}</span>
        <span class="sub">${fmtDateNice(s.date)} · ${esc(s.game)} · ${fmtDur(r.hours)}${live ? ' · LIVE' : ''}</span>
      </div>
      <span class="net ${live ? 'muted' : netClass(r.net)}">${live ? `In ${fmtMoney(r.totalBuyin)}` : fmtMoney(r.net, { sign: true })}</span>
    </div>
  `;
}

async function openStartSessionModal() {
  const recents = await DB.getRecents();
  const root = openModal(`
    <h2>Start Session</h2>
    <label class="field"><span>Venue</span>
      <input id="f-venue" type="text" list="venues-list" placeholder="e.g. Bellagio" value="${esc(recents.venues[0] || '')}" autocomplete="off">
      <datalist id="venues-list">${recents.venues.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    </label>
    <div class="row2">
      <label class="field"><span>Stakes</span>
        <input id="f-stakes" type="text" list="stakes-list" placeholder="2/5" value="${esc(recents.stakes[0] || '')}" autocomplete="off">
        <datalist id="stakes-list">${recents.stakes.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      </label>
      <label class="field"><span>Game</span>
        <select id="f-game">
          <option>NLHE</option><option>PLO</option><option>Mixed</option><option>Other</option>
        </select>
      </label>
    </div>
    <label class="field"><span>Buy-in ($)</span>
      <input id="f-buyin" class="num" type="text" inputmode="decimal" value="${recents.lastBuyin != null ? esc(recents.lastBuyin) : ''}" placeholder="500">
    </label>
    <button id="f-start" class="btn primary giant">Start ♠</button>
  `);

  guardedClick($('#f-start', root), async () => {
    const venue = $('#f-venue', root).value.trim();
    const stakes = $('#f-stakes', root).value.trim();
    const game = $('#f-game', root).value;
    const buyin = parseNum($('#f-buyin', root).value);
    if (!venue) { toast('Enter a venue'); return; }
    if (!stakes) { toast('Enter stakes'); return; }
    if (buyin == null || buyin <= 0) { toast('Enter your buy-in'); return; }
    await DB.createSession({ venue, stakes, game, buyin });
    closeModal();
    location.hash = 'session';
  });
}

// ---------- ACTIVE SESSION (Live) ----------
async function renderActive() {
  const session = await DB.getActiveSession();
  if (!session) {
    $('#view').innerHTML = `
      <h1>Live</h1>
      <div class="empty">No session running.</div>
      <button id="start-btn" class="btn primary giant">♠ Start Session</button>
    `;
    $('#start-btn').addEventListener('click', openStartSessionModal);
    return;
  }

  const r = await DB.sessionWithComputed(session.id);
  const hands = await DB.handsFor(session.id);
  const recentHands = hands.slice(-5).reverse();

  $('#view').innerHTML = `
    <div class="live-header">
      <div class="venue">${esc(session.venue)}</div>
      <div class="meta">${esc(session.stakes)} ${esc(session.game)} · started ${fmtTime(session.start_time)}</div>
      <div class="timer-row">
        <span id="live-timer">0:00:00</span>
        <span>In: ${fmtMoney(r.totalBuyin)}</span>
      </div>
    </div>

    <button id="voice-btn" class="btn giant">🎤 Voice Hand <span id="rec-time"></span></button>
    <button id="quick-btn" class="btn giant">⌨️ Quick Hand</button>
    <button id="rebuy-btn" class="btn">💵 Rebuy</button>

    <div class="notice">Most rooms don’t allow recording at the table — save voice memos for breaks and walks. Quick Hand just looks like texting.</div>

    <h3>Hands this session (${hands.length})</h3>
    ${recentHands.length
      ? recentHands.map((h) => handCardHTML(h, session, { actions: false })).join('')
      : '<div class="empty">No hands logged yet.</div>'}
    ${hands.length > 5 ? `<div class="small muted" style="text-align:center;margin-bottom:10px">Showing last 5 — the rest are in Review.</div>` : ''}

    <button id="end-btn" class="btn danger giant">End Session</button>
  `;

  // running clock
  const tick = () => {
    const el = $('#live-timer');
    if (el) el.textContent = fmtClock(Date.now() - new Date(session.start_time).getTime());
  };
  tick();
  App.liveTimer = setInterval(tick, 1000);

  $('#voice-btn').addEventListener('click', () => toggleVoice(session.id));
  $('#quick-btn').addEventListener('click', () => openHandModal({ sessionId: session.id, onSaved: render }));
  $('#rebuy-btn').addEventListener('click', () => openRebuyModal(session.id));
  $('#end-btn').addEventListener('click', () => openEndSessionModal(session.id));
}

async function toggleVoice(sessionId) {
  if (App.rec && App.rec.state !== 'inactive') {
    App.rec.stop(); // onstop saves the hand
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast('Voice recording not supported in this browser');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast('Microphone unavailable — check permissions');
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    App.rec = null;
    clearInterval(App.recTimer);
    App.recTimer = null;
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    if (blob.size === 0) {
      toast('Recording was empty — nothing saved');
    } else {
      try {
        await DB.addHand({ session_id: sessionId, capture_type: 'voice', audio: blob });
        toast('🎤 Voice hand saved');
      } catch (err) {
        toast('Could not save the recording — storage may be full');
      }
    }
    if (location.hash.slice(1) === 'session') render();
    else updateReviewBadge();
  };

  rec.start();
  App.rec = rec;
  App.recStart = Date.now();

  const btn = $('#voice-btn');
  if (btn) {
    btn.classList.add('recording');
    btn.childNodes[0].textContent = '⏹ Stop & save ';
  }
  App.recTimer = setInterval(() => {
    const el = $('#rec-time');
    if (el) el.textContent = fmtClock(Date.now() - App.recStart);
  }, 500);
}

async function openRebuyModal(sessionId) {
  const recents = await DB.getRecents();
  const mine = await DB.buyinsFor(sessionId);
  const last = mine.length ? mine[mine.length - 1].amount : recents.lastBuyin;
  const root = openModal(`
    <h2>Rebuy</h2>
    <label class="field"><span>Amount ($)</span>
      <input id="rb-amount" class="num" type="text" inputmode="decimal" value="${last != null ? esc(last) : ''}">
    </label>
    <button id="rb-save" class="btn primary giant">Add Rebuy</button>
  `);
  const input = $('#rb-amount', root);
  input.focus();
  input.select();
  guardedClick($('#rb-save', root), async () => {
    const amount = parseNum(input.value);
    if (amount == null || amount <= 0) { toast('Enter an amount'); return; }
    await DB.addBuyin(sessionId, amount);
    closeModal();
    toast(`Rebuy ${fmtMoney(amount)} added`);
    render();
  });
}

function openEndSessionModal(sessionId) {
  const root = openModal(`
    <h2>End Session</h2>
    <label class="field"><span>Cash out ($) — what you’re walking away with</span>
      <input id="es-cashout" class="num" type="text" inputmode="decimal" placeholder="0">
    </label>
    <label class="field"><span>Expenses ($) — tips, meals, travel (optional)</span>
      <input id="es-expenses" class="num" type="text" inputmode="decimal" placeholder="0">
    </label>
    <label class="field"><span>Table notes (optional)</span>
      <textarea id="es-notes" placeholder="Lineup, dynamics, anything worth remembering"></textarea>
    </label>
    <span class="small muted" style="display:block;margin-bottom:6px">How did you play?</span>
    <div class="chip-row" id="es-conditions">
      ${CONDITION_TAGS.map((t) => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <button id="es-save" class="btn danger giant">End Session</button>
  `);

  $$('#es-conditions .chip', root).forEach((c) => {
    c.addEventListener('click', () => c.classList.toggle('selected'));
  });

  guardedClick($('#es-save', root), async () => {
    const cash_out = parseNum($('#es-cashout', root).value);
    if (cash_out == null || cash_out < 0) { toast('Enter your cash-out (0 if you lost it all)'); return; }
    const expenses = parseNum($('#es-expenses', root).value) || 0;
    const table_notes = $('#es-notes', root).value.trim();
    const condition_tags = $$('#es-conditions .chip.selected', root).map((c) => c.dataset.tag);
    await DB.completeSession(sessionId, { cash_out, expenses, table_notes, condition_tags });
    const r = await DB.sessionWithComputed(sessionId);
    const hands = await DB.handsFor(sessionId);
    openSummaryModal(r, hands.length);
  });
}

function openSummaryModal(r, handCount) {
  const s = r.session;
  const root = openModal(`
    <h2>Session complete</h2>
    <div class="card flat" style="text-align:center">
      <div style="font-size:34px;font-weight:800" class="${netClass(r.net)}">${fmtMoney(r.net, { sign: true })}</div>
      <div class="muted small" style="margin-top:4px">${esc(s.venue)} · ${esc(s.stakes)} ${esc(s.game)}</div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Duration</div><div class="value">${fmtDur(r.hours)}</div></div>
      <div class="stat-card"><div class="label">$ / hour</div><div class="value ${netClass(r.rate)}">${r.rate != null ? fmtMoney(r.rate, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">Total in</div><div class="value">${fmtMoney(r.totalBuyin)}</div></div>
      <div class="stat-card"><div class="label">Hands logged</div><div class="value">${handCount}</div></div>
    </div>
    <button id="sum-done" class="btn primary giant">Done</button>
  `);
  $('#sum-done', root).addEventListener('click', () => {
    closeModal();
    if (location.hash.slice(1) === 'home') render();
    else location.hash = 'home';
  });
}

// ---------- HAND CARD + MODAL (shared) ----------
function handCardHTML(h, session, { actions = true, transcription = false } = {}) {
  const url = audioUrlFor(h);
  const resultStr = h.result != null ? fmtMoney(h.result, { sign: true }) : '';
  const head = [
    h.capture_type === 'voice' ? '🎤' : '⌨️',
    h.position ? esc(h.position) : '',
    h.eff_stack != null ? `${esc(h.eff_stack)} ${esc(h.stack_unit || 'BB')}` : '',
  ].filter(Boolean).join(' · ');

  return `
    <div class="card hand-card" data-id="${esc(h.id)}">
      <div class="hand-top">
        <span><b>${head}</b> ${resultStr ? `<span class="${netClass(h.result)}">${resultStr}</span>` : ''}</span>
        <span class="when">${session ? esc(session.date) + ' · ' : ''}${fmtTime(h.timestamp)}</span>
      </div>
      ${h.action_line ? `<div class="action-line">${esc(h.action_line)}</div>` : ''}
      ${url ? `<audio controls preload="metadata" src="${url}"></audio>` : ''}
      ${h.capture_type === 'voice' && !url ? '<div class="small muted">(audio missing)</div>' : ''}
      ${transcription && h.capture_type === 'voice' ? `
        <label class="field" style="margin-top:8px"><span>Transcription / notes from listening</span>
          <textarea class="tr-text" placeholder="Type what matters from the memo…">${esc(h.transcription)}</textarea>
        </label>` : ''}
      ${h.villain_notes ? `<div class="small muted">👤 ${esc(h.villain_notes)}</div>` : ''}
      ${(h.tags || []).length ? `<div class="tags">${h.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${actions ? `
        <div class="hand-actions">
          ${transcription && h.capture_type === 'voice' ? `<button class="btn inline" data-act="save-tr">Save text</button>` : ''}
          <button class="btn inline" data-act="edit">Edit</button>
          <button class="btn inline" data-act="toggle-review">${h.review_status === 'raw' ? '✓ Mark reviewed' : '↩ Reopen'}</button>
          <button class="btn inline danger" data-act="delete">Delete</button>
        </div>` : ''}
    </div>
  `;
}

function wireHandCards(container, refresh) {
  $$('.hand-card [data-act]', container).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const card = e.target.closest('.hand-card');
      const id = card.dataset.id;
      const act = btn.dataset.act;
      const hand = await DB.getHand(id);
      if (!hand) return;

      if (act === 'edit') {
        openHandModal({ sessionId: hand.session_id, hand, onSaved: refresh });
      } else if (act === 'toggle-review') {
        const changes = { review_status: hand.review_status === 'raw' ? 'reviewed' : 'raw' };
        const tr = $('.tr-text', card); // don't lose transcription typed but not yet saved
        if (tr) changes.transcription = tr.value;
        await DB.updateHand(id, changes);
        refresh();
      } else if (act === 'delete') {
        const ok = await confirmModal({
          title: 'Delete this hand?',
          body: hand.capture_type === 'voice' ? 'The voice recording is deleted too. This cannot be undone.' : 'This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) { await DB.deleteHand(id); toast('Hand deleted'); refresh(); }
      } else if (act === 'save-tr') {
        const text = $('.tr-text', card).value;
        await DB.updateHand(id, { transcription: text });
        toast('Saved');
      }
    });
  });
}

function openHandModal({ sessionId, hand = null, onSaved = () => {} }) {
  const h = hand || {};
  const isEdit = !!hand;
  const won = h.result == null || h.result >= 0;
  const amt = h.result != null ? Math.abs(h.result) : '';
  const tags = new Set(h.tags || []);
  const allTags = [...new Set([...PRESET_TAGS, ...tags])];

  const root = openModal(`
    <h2>${isEdit ? 'Edit Hand' : 'Quick Hand'}</h2>

    <span class="small muted" style="display:block;margin-bottom:6px">Position</span>
    <div class="chip-row" id="qh-pos">
      ${POSITIONS.map((p) => `<button class="chip ${h.position === p ? 'selected' : ''}" data-pos="${p}">${p}</button>`).join('')}
    </div>

    <div class="row2">
      <label class="field"><span>Effective stack</span>
        <input id="qh-stack" class="num" type="text" inputmode="decimal" value="${h.eff_stack != null ? esc(h.eff_stack) : ''}" placeholder="100">
      </label>
      <div>
        <span class="small muted" style="display:block;margin-bottom:6px">Unit</span>
        <div class="seg" id="qh-unit">
          <button data-val="BB" class="${(h.stack_unit || 'BB') === 'BB' ? 'selected' : ''}">BB</button>
          <button data-val="$" class="${h.stack_unit === '$' ? 'selected' : ''}">$</button>
        </div>
      </div>
    </div>

    <label class="field"><span>Action line</span>
      <textarea id="qh-action" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"
        placeholder="co open 15, btn 3b 45, h call. flop K72r x/c 35…">${esc(h.action_line || '')}</textarea>
    </label>

    <span class="small muted" style="display:block;margin-bottom:6px">Result</span>
    <div class="row2">
      <div class="seg" id="qh-sign">
        <button data-val="won" class="${won ? 'selected' : ''}">Won</button>
        <button data-val="lost" class="${!won ? 'selected' : ''}">Lost</button>
      </div>
      <input id="qh-result" class="num" type="text" inputmode="decimal" value="${esc(amt)}" placeholder="$ (optional)">
    </div>

    <label class="field" style="margin-top:14px"><span>Villain notes (optional)</span>
      <textarea id="qh-villain" placeholder="Reads, history, sizing tells…">${esc(h.villain_notes || '')}</textarea>
    </label>

    ${isEdit && h.capture_type === 'voice' ? `
      <label class="field"><span>Transcription</span>
        <textarea id="qh-tr">${esc(h.transcription || '')}</textarea>
      </label>` : ''}

    <span class="small muted" style="display:block;margin-bottom:6px">Tags</span>
    <div class="chip-row" id="qh-tags">
      ${allTags.map((t) => `<button class="chip ${tags.has(t) ? 'selected' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div class="row2" style="margin-bottom:14px">
      <input id="qh-newtag" type="text" placeholder="custom tag" autocapitalize="off" autocomplete="off">
      <button id="qh-addtag" class="btn" style="margin-bottom:0">Add tag</button>
    </div>

    <button id="qh-save" class="btn primary giant">${isEdit ? 'Save changes' : 'Save Hand'}</button>
  `);

  // position: single-select
  $$('#qh-pos .chip', root).forEach((c) => {
    c.addEventListener('click', () => {
      const was = c.classList.contains('selected');
      $$('#qh-pos .chip', root).forEach((x) => x.classList.remove('selected'));
      if (!was) c.classList.add('selected');
    });
  });
  // segs
  for (const segId of ['#qh-unit', '#qh-sign']) {
    $$(segId + ' button', root).forEach((b) => {
      b.addEventListener('click', () => {
        $$(segId + ' button', root).forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
    });
  }
  // tags: multi-select
  const wireTag = (c) => c.addEventListener('click', () => c.classList.toggle('selected'));
  $$('#qh-tags .chip', root).forEach(wireTag);
  $('#qh-addtag', root).addEventListener('click', () => {
    const v = $('#qh-newtag', root).value.trim().toLowerCase();
    if (!v) return;
    if (!$$('#qh-tags .chip', root).some((c) => c.dataset.tag === v)) {
      const chip = document.createElement('button');
      chip.className = 'chip selected';
      chip.dataset.tag = v;
      chip.textContent = v;
      wireTag(chip);
      $('#qh-tags', root).appendChild(chip);
    }
    $('#qh-newtag', root).value = '';
  });

  guardedClick($('#qh-save', root), async () => {
    const posChip = $('#qh-pos .chip.selected', root);
    const amount = parseNum($('#qh-result', root).value);
    const sign = $('#qh-sign button.selected', root)?.dataset.val === 'lost' ? -1 : 1;
    const fields = {
      position: posChip ? posChip.dataset.pos : '',
      eff_stack: parseNum($('#qh-stack', root).value),
      stack_unit: $('#qh-unit button.selected', root)?.dataset.val || 'BB',
      action_line: $('#qh-action', root).value.trim(),
      villain_notes: $('#qh-villain', root).value.trim(),
      result: amount == null ? null : sign * Math.abs(amount),
      tags: $$('#qh-tags .chip.selected', root).map((c) => c.dataset.tag),
    };
    if (isEdit && h.capture_type === 'voice') {
      const tr = $('#qh-tr', root);
      if (tr) fields.transcription = tr.value;
    }
    if (isEdit) {
      await DB.updateHand(h.id, fields);
      toast('Hand updated');
    } else {
      await DB.addHand({ session_id: sessionId, capture_type: 'text', ...fields });
      toast('Hand saved');
    }
    closeModal();
    onSaved();
  });
}

// ---------- REVIEW ----------
async function renderReview() {
  const [hands, sessionRows] = await Promise.all([DB.allHands(), DB.allSessionsWithComputed()]);
  const sessions = new Map(sessionRows.map((r) => [r.session.id, r.session]));
  const filtered = App.reviewFilter === 'raw' ? hands.filter((x) => x.review_status === 'raw') : hands;
  const rawCount = hands.filter((x) => x.review_status === 'raw').length;

  // group by session, newest session first, hands oldest-first within
  const groups = new Map();
  for (const h of filtered) {
    if (!groups.has(h.session_id)) groups.set(h.session_id, []);
    groups.get(h.session_id).push(h);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const sa = sessions.get(a[0]), sb = sessions.get(b[0]);
    return (sa?.start_time || '') < (sb?.start_time || '') ? 1 : -1;
  });
  for (const [, list] of ordered) list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

  $('#view').innerHTML = `
    <h1>Hand Review</h1>
    <div class="seg" id="rev-filter">
      <button data-val="raw" class="${App.reviewFilter === 'raw' ? 'selected' : ''}">To review (${rawCount})</button>
      <button data-val="all" class="${App.reviewFilter === 'all' ? 'selected' : ''}">All hands (${hands.length})</button>
    </div>
    ${ordered.length ? ordered.map(([sid, list]) => {
      const s = sessions.get(sid);
      return `
        <h3>${s ? `${fmtDateNice(s.date)} · ${esc(s.venue)} · ${esc(s.stakes)}` : 'Unknown session'}</h3>
        ${list.map((h) => handCardHTML(h, null, { actions: true, transcription: true })).join('')}
      `;
    }).join('') : `
      <div class="empty">${App.reviewFilter === 'raw'
        ? 'Nothing to review — nice and caught up. 🎉'
        : 'No hands logged yet. Use 🎤 Voice Hand or ⌨️ Quick Hand during a live session.'}</div>
    `}
  `;

  $$('#rev-filter button').forEach((b) => {
    b.addEventListener('click', () => { App.reviewFilter = b.dataset.val; render(); });
  });
  wireHandCards($('#view'), render);
}

// ---------- STATS ----------
async function renderStats() {
  const all = await DB.allSessionsWithComputed();
  const completed = all.filter((r) => r.session.status === 'completed' && r.net != null);
  const f = App.statsFilters;

  const opts = (values, current) =>
    values.map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const venues = [...new Set(completed.map((r) => r.session.venue))].sort();
  const stakesList = [...new Set(completed.map((r) => r.session.stakes))].sort();
  const games = [...new Set(completed.map((r) => r.session.game))].sort();

  const filtered = completed.filter((r) => {
    const s = r.session;
    if (f.venue && s.venue !== f.venue) return false;
    if (f.stakes && s.stakes !== f.stakes) return false;
    if (f.game && s.game !== f.game) return false;
    if (f.from && s.date < f.from) return false;
    if (f.to && s.date > f.to) return false;
    return true;
  });
  const st = computeStats(filtered);
  const rawCount = await DB.rawHandCount();

  const groupTable = (title, groups) => `
    <h3>${title}</h3>
    <div class="card" style="padding:6px 10px">
      <table class="mini">
        <tr><th>${title === 'By stakes' ? 'Stakes' : 'Venue'}</th><th class="r">Sessions</th><th class="r">Hours</th><th class="r">Net</th><th class="r">$/hr</th></tr>
        ${groups.map((g) => `
          <tr>
            <td>${esc(g.key)}</td>
            <td class="r">${g.count}</td>
            <td class="r">${(Math.round(g.hours * 10) / 10).toFixed(1)}</td>
            <td class="r ${netClass(g.net)}">${fmtMoney(g.net, { sign: true })}</td>
            <td class="r ${netClass(g.rate)}">${g.rate != null ? fmtMoney(g.rate, { sign: true }) : '—'}</td>
          </tr>`).join('')}
      </table>
    </div>
  `;

  $('#view').innerHTML = `
    <h1>Stats</h1>
    <div class="filter-bar">
      <input id="sf-from" type="date" value="${esc(f.from)}" aria-label="From date">
      <input id="sf-to" type="date" value="${esc(f.to)}" aria-label="To date">
      <select id="sf-venue"><option value="">All venues</option>${opts(venues, f.venue)}</select>
      <select id="sf-stakes"><option value="">All stakes</option>${opts(stakesList, f.stakes)}</select>
      <select id="sf-game"><option value="">All games</option>${opts(games, f.game)}</select>
      <button id="sf-clear" class="btn" style="margin-bottom:0;min-height:44px;font-size:14px">Clear filters</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="label">Net</div><div class="value ${netClass(st.totalNet)}">${st.count ? fmtMoney(st.totalNet, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">$ / hour</div><div class="value ${netClass(st.rate)}">${st.rate != null ? fmtMoney(st.rate, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">Hours</div><div class="value">${fmtDur(st.totalHours)}</div></div>
      <div class="stat-card"><div class="label">Sessions</div><div class="value">${st.count}</div></div>
      <div class="stat-card"><div class="label">Win rate (sessions)</div><div class="value">${st.winRate != null ? Math.round(st.winRate * 100) + '%' : '—'}</div></div>
      <div class="stat-card"><div class="label">Std dev / session</div><div class="value">${st.stdDev != null ? fmtMoney(st.stdDev) : '—'}</div></div>
      <div class="stat-card"><div class="label">Biggest win</div><div class="value pos">${st.biggestWin != null ? fmtMoney(st.biggestWin, { sign: true }) : '—'}</div></div>
      <div class="stat-card"><div class="label">Biggest loss</div><div class="value ${st.biggestLoss != null && st.biggestLoss < 0 ? 'neg' : ''}">${st.biggestLoss != null ? fmtMoney(st.biggestLoss, { sign: true }) : '—'}</div></div>
    </div>

    ${st.totalExpenses ? `<div class="small muted" style="margin-bottom:10px">Expenses in range: ${fmtMoney(st.totalExpenses)} · Net after expenses: <span class="${netClass(st.totalNet - st.totalExpenses)}">${fmtMoney(st.totalNet - st.totalExpenses, { sign: true })}</span></div>` : ''}

    <h3>Cumulative result</h3>
    <div class="card"><canvas id="chart"></canvas></div>

    ${groupTable('By stakes', st.byStake)}
    ${groupTable('By venue', st.byVenue)}

    ${rawCount ? `<div class="notice">📋 ${rawCount} hand${rawCount === 1 ? '' : 's'} waiting in Review.</div>` : ''}
  `;

  const setFilter = (key, value) => { App.statsFilters[key] = value; render(); };
  $('#sf-from').addEventListener('change', (e) => setFilter('from', e.target.value));
  $('#sf-to').addEventListener('change', (e) => setFilter('to', e.target.value));
  $('#sf-venue').addEventListener('change', (e) => setFilter('venue', e.target.value));
  $('#sf-stakes').addEventListener('change', (e) => setFilter('stakes', e.target.value));
  $('#sf-game').addEventListener('change', (e) => setFilter('game', e.target.value));
  $('#sf-clear').addEventListener('click', () => {
    App.statsFilters = { from: '', to: '', venue: '', stakes: '', game: '' };
    render();
  });

  requestAnimationFrame(() => {
    const canvas = $('#chart');
    if (canvas) drawCumulativeChart(canvas, st.cumulative);
  });
}

// ---------- SESSION DETAIL ----------
async function renderSessionDetail(id) {
  const r = await DB.sessionWithComputed(id);
  if (!r) {
    $('#view').innerHTML = '<div class="empty">Session not found.</div>';
    return;
  }
  const s = r.session;
  const buyins = await DB.buyinsFor(id);
  const hands = await DB.handsFor(id);
  const live = s.status === 'active';

  $('#view').innerHTML = `
    <h1>${esc(s.venue)} · ${esc(s.stakes)}</h1>
    <div class="card">
      <div class="small muted">${fmtDateNice(s.date)} · ${esc(s.game)} · ${fmtTime(s.start_time)}${s.end_time ? ' – ' + fmtTime(s.end_time) : ' – live'}</div>
      <div class="stat-grid" style="margin-top:10px;margin-bottom:0">
        <div class="stat-card flat"><div class="label">Net</div><div class="value ${netClass(r.net)}">${r.net != null ? fmtMoney(r.net, { sign: true }) : 'live'}</div></div>
        <div class="stat-card flat"><div class="label">$ / hour</div><div class="value ${netClass(r.rate)}">${r.rate != null ? fmtMoney(r.rate, { sign: true }) : '—'}</div></div>
        <div class="stat-card flat"><div class="label">Total in</div><div class="value">${fmtMoney(r.totalBuyin)}</div></div>
        <div class="stat-card flat"><div class="label">Cash out</div><div class="value">${s.cash_out != null ? fmtMoney(s.cash_out) : '—'}</div></div>
      </div>
      ${Number(s.expenses) ? `<div class="small muted" style="margin-top:8px">Expenses: ${fmtMoney(Number(s.expenses))}</div>` : ''}
      ${(s.condition_tags || []).length ? `<div class="tags" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${s.condition_tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${s.table_notes ? `<div class="small" style="margin-top:8px;white-space:pre-wrap">${esc(s.table_notes)}</div>` : ''}
    </div>

    ${live ? `<button id="goto-live" class="btn primary">▶ Go to live screen</button>` : ''}
    <button id="edit-session" class="btn">✏ Edit session</button>

    <h3>Buy-ins (${buyins.length})</h3>
    ${buyins.map((b) => `
      <div class="session-row" data-buyin="${esc(b.id)}" style="cursor:default">
        <div class="main"><span class="title">${fmtMoney(b.amount)}</span><span class="sub">${fmtDateTime(b.timestamp)}</span></div>
        <button class="btn inline danger" data-del-buyin="${esc(b.id)}" style="margin:0">✕</button>
      </div>`).join('') || '<div class="empty">No buy-ins recorded.</div>'}

    <h3>Hands (${hands.length})</h3>
    ${hands.map((h) => handCardHTML(h, null, { actions: true, transcription: true })).join('') || '<div class="empty">No hands logged.</div>'}

    <button id="delete-session" class="btn danger">Delete session</button>
  `;

  if (live) $('#goto-live').addEventListener('click', () => { location.hash = 'session'; });

  $('#edit-session').addEventListener('click', () => openEditSessionModal(s));

  $$('[data-del-buyin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete this buy-in?',
        body: 'Removes it from the session’s totals.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) { await DB.deleteBuyin(btn.dataset.delBuyin); render(); }
    });
  });

  wireHandCards($('#view'), render);

  $('#delete-session').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Delete this entire session?',
      body: `Deletes the session, ${buyins.length} buy-in(s) and ${hands.length} hand(s) including audio. This cannot be undone.`,
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (ok) {
      await DB.deleteSessionCascade(id);
      toast('Session deleted');
      location.hash = 'home';
    }
  });
}

function openEditSessionModal(s) {
  const completed = s.status === 'completed';
  const root = openModal(`
    <h2>Edit session</h2>
    <label class="field"><span>Venue</span><input id="ed-venue" type="text" value="${esc(s.venue)}" autocomplete="off"></label>
    <div class="row2">
      <label class="field"><span>Stakes</span><input id="ed-stakes" type="text" value="${esc(s.stakes)}" autocomplete="off"></label>
      <label class="field"><span>Game</span>
        <select id="ed-game">
          ${['NLHE', 'PLO', 'Mixed', 'Other'].map((g) => `<option ${s.game === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </label>
    </div>
    ${completed ? `
      <div class="row2">
        <label class="field"><span>Cash out ($)</span><input id="ed-cashout" class="num" type="text" inputmode="decimal" value="${s.cash_out != null ? esc(s.cash_out) : ''}"></label>
        <label class="field"><span>Expenses ($)</span><input id="ed-expenses" class="num" type="text" inputmode="decimal" value="${esc(s.expenses || 0)}"></label>
      </div>` : ''}
    <label class="field"><span>Table notes</span><textarea id="ed-notes">${esc(s.table_notes || '')}</textarea></label>
    <span class="small muted" style="display:block;margin-bottom:6px">Condition tags</span>
    <div class="chip-row" id="ed-conditions">
      ${CONDITION_TAGS.map((t) => `<button class="chip ${(s.condition_tags || []).includes(t) ? 'selected' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <button id="ed-save" class="btn primary giant">Save</button>
  `);

  $$('#ed-conditions .chip', root).forEach((c) => {
    c.addEventListener('click', () => c.classList.toggle('selected'));
  });

  guardedClick($('#ed-save', root), async () => {
    const venue = $('#ed-venue', root).value.trim();
    const stakes = $('#ed-stakes', root).value.trim();
    if (!venue || !stakes) { toast('Venue and stakes are required'); return; }
    const changes = {
      venue,
      stakes,
      game: $('#ed-game', root).value,
      table_notes: $('#ed-notes', root).value.trim(),
      condition_tags: $$('#ed-conditions .chip.selected', root).map((c) => c.dataset.tag),
    };
    if (completed) {
      const cashOut = parseNum($('#ed-cashout', root).value);
      if (cashOut == null || cashOut < 0) { toast('Enter a valid cash-out'); return; }
      changes.cash_out = cashOut;
      changes.expenses = parseNum($('#ed-expenses', root).value) || 0;
    }
    await DB.updateSession(s.id, changes);
    closeModal();
    toast('Session updated');
    render();
  });
}

// ---------- boot ----------
async function init() {
  $$('#tabbar button').forEach((b) => {
    b.addEventListener('click', () => {
      if (location.hash.slice(1) === b.dataset.nav) render();
      else location.hash = b.dataset.nav;
    });
  });
  window.addEventListener('hashchange', render);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    try {
      App.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch (e) {
      App.persisted = undefined; // API unavailable — don't show a false alarm
    }
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    App.installPrompt = e;
    if ((location.hash.slice(1) || 'home') === 'home') render();
  });

  const active = await DB.getActiveSession();
  if (!location.hash) {
    location.hash = active ? 'session' : 'home'; // triggers hashchange -> render
  } else {
    render();
  }
}

init();
