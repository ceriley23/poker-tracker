/* Data layer: Dexie (IndexedDB) schema + all reads/writes live here. */

const db = new Dexie('poker-tracker');

db.version(1).stores({
  sessions: 'id, status, date, venue, stakes, game, start_time',
  buyins: 'id, session_id, timestamp',
  hands: 'id, session_id, timestamp, review_status',
  meta: 'key',
});

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DB = {
  uuid() {
    return (crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Math.random().toString(36).slice(2) + '-' + performance.now().toString(36);
  },

  // ---------- meta / recents ----------
  async getMeta(key) {
    const row = await db.meta.get(key);
    return row ? row.value : null;
  },
  async setMeta(key, value) {
    await db.meta.put({ key, value });
  },
  async getRecents() {
    return (await this.getMeta('recents')) || { venues: [], stakes: [], lastBuyin: null };
  },
  async bumpRecents({ venue, stakes, lastBuyin }) {
    const r = await this.getRecents();
    const bump = (list, v) => {
      if (!v) return list;
      return [v, ...list.filter((x) => x !== v)].slice(0, 8);
    };
    r.venues = bump(r.venues, venue);
    r.stakes = bump(r.stakes, stakes);
    if (lastBuyin != null && lastBuyin > 0) r.lastBuyin = lastBuyin;
    await this.setMeta('recents', r);
  },

  // ---------- sessions ----------
  async createSession({ venue, game, stakes, buyin }) {
    const now = new Date();
    const session = {
      id: this.uuid(),
      status: 'active',
      date: localDateStr(now),
      venue: (venue || '').trim(),
      game: game || 'NLHE',
      stakes: (stakes || '').trim(),
      start_time: now.toISOString(),
      end_time: null,
      cash_out: null,
      table_notes: '',
      condition_tags: [],
      expenses: 0,
    };
    await db.sessions.add(session);
    if (buyin > 0) await this.addBuyin(session.id, buyin);
    await this.bumpRecents({ venue: session.venue, stakes: session.stakes, lastBuyin: buyin });
    return session;
  },

  async getActiveSession() {
    return db.sessions.where('status').equals('active').first();
  },

  async getSession(id) {
    return db.sessions.get(id);
  },

  async updateSession(id, changes) {
    await db.sessions.update(id, changes);
  },

  async completeSession(id, { cash_out, expenses, table_notes, condition_tags }) {
    await db.sessions.update(id, {
      status: 'completed',
      end_time: new Date().toISOString(),
      cash_out,
      expenses: expenses || 0,
      table_notes: table_notes || '',
      condition_tags: condition_tags || [],
    });
    return this.getSession(id);
  },

  async deleteSessionCascade(id) {
    await db.transaction('rw', db.sessions, db.buyins, db.hands, async () => {
      await db.buyins.where('session_id').equals(id).delete();
      await db.hands.where('session_id').equals(id).delete();
      await db.sessions.delete(id);
    });
  },

  // Computed money/time numbers for one session. Active sessions measure
  // duration up to "now" so the live header can show a running clock.
  computeSession(session, buyins) {
    const mine = buyins.filter((b) => b.session_id === session.id);
    const totalBuyin = mine.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const net = session.cash_out != null ? session.cash_out - totalBuyin : null;
    const end = session.end_time ? new Date(session.end_time) : new Date();
    const hours = Math.max((end - new Date(session.start_time)) / 3.6e6, 0);
    const rate = net != null && hours > 0 ? net / hours : null;
    return { session, totalBuyin, net, hours, rate };
  },

  // All sessions joined with computed numbers, newest first.
  async allSessionsWithComputed() {
    const [sessions, buyins] = await Promise.all([db.sessions.toArray(), db.buyins.toArray()]);
    sessions.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));
    return sessions.map((s) => this.computeSession(s, buyins));
  },

  async sessionWithComputed(id) {
    const session = await db.sessions.get(id);
    if (!session) return null;
    const buyins = await db.buyins.where('session_id').equals(id).toArray();
    return this.computeSession(session, buyins);
  },

  // ---------- buy-ins ----------
  async addBuyin(session_id, amount) {
    const row = {
      id: this.uuid(),
      session_id,
      amount: Number(amount),
      timestamp: new Date().toISOString(),
    };
    await db.buyins.add(row);
    await this.bumpRecents({ lastBuyin: row.amount });
    return row;
  },

  async buyinsFor(session_id) {
    const rows = await db.buyins.where('session_id').equals(session_id).toArray();
    rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    return rows;
  },

  async deleteBuyin(id) {
    await db.buyins.delete(id);
  },

  // ---------- hands ----------
  async addHand(fields) {
    const hand = {
      id: this.uuid(),
      session_id: fields.session_id,
      timestamp: new Date().toISOString(),
      capture_type: fields.capture_type || 'text',
      audio: fields.audio || null,            // Blob (voice hands only)
      transcription: fields.transcription || '',
      position: fields.position || '',
      eff_stack: fields.eff_stack != null ? fields.eff_stack : null,
      stack_unit: fields.stack_unit || 'BB',
      action_line: fields.action_line || '',
      villain_notes: fields.villain_notes || '',
      result: fields.result != null ? fields.result : null,
      tags: fields.tags || [],
      review_status: 'raw',
    };
    await db.hands.add(hand);
    return hand;
  },

  async updateHand(id, changes) {
    await db.hands.update(id, changes);
  },

  async deleteHand(id) {
    await db.hands.delete(id);
  },

  async getHand(id) {
    return db.hands.get(id);
  },

  async handsFor(session_id) {
    const rows = await db.hands.where('session_id').equals(session_id).toArray();
    rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    return rows;
  },

  async allHands() {
    return db.hands.toArray();
  },

  async rawHandCount() {
    return db.hands.where('review_status').equals('raw').count();
  },
};
