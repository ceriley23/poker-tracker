/* Backup & export: one-tap zip backup (JSON + audio + CSVs) and restore. */

function csvEscape(v) {
  let s = v == null ? '' : String(v);
  // Defuse spreadsheet formula interpretation (=SUM…, @cmd, +foo) while
  // leaving plain numbers — including negatives — untouched.
  if (/^[=@+]/.test(s) || (s.startsWith('-') && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\r\n');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function num2(n) {
  return n == null ? '' : (Math.round(n * 100) / 100).toFixed(2);
}

async function buildSessionsCSV() {
  const rows = await DB.allSessionsWithComputed();
  const headers = [
    'date', 'venue', 'game', 'stakes', 'status', 'start_time', 'end_time',
    'hours', 'total_buyin', 'cash_out', 'net', 'expenses', 'net_after_expenses',
    'dollars_per_hour', 'condition_tags', 'table_notes',
  ];
  const data = rows.map((r) => {
    const s = r.session;
    const expenses = Number(s.expenses) || 0;
    return [
      s.date, s.venue, s.game, s.stakes, s.status, s.start_time, s.end_time || '',
      num2(r.hours), num2(r.totalBuyin),
      s.cash_out == null ? '' : num2(s.cash_out),
      r.net == null ? '' : num2(r.net),
      num2(expenses),
      r.net == null ? '' : num2(r.net - expenses),
      r.rate == null ? '' : num2(r.rate),
      (s.condition_tags || []).join('; '),
      s.table_notes || '',
    ];
  });
  return toCSV(headers, data);
}

async function buildHandsCSV() {
  const [hands, sessionRows] = await Promise.all([DB.allHands(), DB.allSessionsWithComputed()]);
  const byId = new Map(sessionRows.map((r) => [r.session.id, r.session]));
  hands.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  const headers = [
    'session_date', 'venue', 'stakes', 'timestamp', 'capture_type', 'position',
    'eff_stack', 'stack_unit', 'action_line', 'villain_notes', 'result', 'tags',
    'transcription', 'review_status', 'has_audio',
  ];
  const data = hands.map((h) => {
    const s = byId.get(h.session_id) || {};
    return [
      s.date || '', s.venue || '', s.stakes || '', h.timestamp, h.capture_type,
      h.position || '', h.eff_stack == null ? '' : h.eff_stack, h.stack_unit || '',
      h.action_line || '', h.villain_notes || '',
      h.result == null ? '' : num2(h.result),
      (h.tags || []).join('; '), h.transcription || '', h.review_status,
      h.audio ? 'yes' : 'no',
    ];
  });
  return toCSV(headers, data);
}

function audioExt(type) {
  if (!type) return 'webm';
  if (type.includes('mp4') || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

function stamp() {
  return localDateStr(new Date());
}

/* Full backup: backup.json (all rows), audio files, plus human-readable CSVs. */
async function exportZipBackup() {
  const [sessions, buyins, hands, metaRows] = await Promise.all([
    db.sessions.toArray(),
    db.buyins.toArray(),
    db.hands.toArray(),
    db.meta.toArray(),
  ]);

  const files = {};
  const handsMeta = [];
  for (const h of hands) {
    const { audio, ...rest } = h;
    if (audio instanceof Blob && audio.size > 0) {
      const name = `audio/${h.id}.${audioExt(audio.type)}`;
      rest.audio_file = name;
      rest.audio_type = audio.type;
      // level 0: audio is already compressed; zipping it again just wastes battery.
      files[name] = [new Uint8Array(await audio.arrayBuffer()), { level: 0 }];
    }
    handsMeta.push(rest);
  }

  const backup = {
    app: 'poker-tracker',
    schema: 1,
    exported_at: new Date().toISOString(),
    sessions,
    buyins,
    hands: handsMeta,
    meta: metaRows.filter((m) => m.key === 'recents'),
  };

  files['backup.json'] = fflate.strToU8(JSON.stringify(backup, null, 2));
  // '﻿' = byte-order mark so Excel on Windows reads the UTF-8 correctly
  files['sessions.csv'] = fflate.strToU8('﻿' + (await buildSessionsCSV()));
  files['hands.csv'] = fflate.strToU8('﻿' + (await buildHandsCSV()));

  const zipped = fflate.zipSync(files);
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), `poker-backup-${stamp()}.zip`);
  await DB.setMeta('lastBackup', new Date().toISOString());
}

async function exportSessionsCSV() {
  downloadBlob(
    new Blob(['﻿' + (await buildSessionsCSV())], { type: 'text/csv;charset=utf-8' }),
    `poker-sessions-${stamp()}.csv`
  );
}

async function exportHandsCSV() {
  downloadBlob(
    new Blob(['﻿' + (await buildHandsCSV())], { type: 'text/csv;charset=utf-8' }),
    `poker-hands-${stamp()}.csv`
  );
}

/* Restore from a backup zip. Merges by id: existing rows with the same id are
   overwritten, everything else is kept — safe to import an old backup. */
async function importZipBackup(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  let unzipped;
  try {
    unzipped = fflate.unzipSync(data);
  } catch (e) {
    throw new Error('That file is not a valid backup zip.');
  }
  if (!unzipped['backup.json']) throw new Error('backup.json not found in the zip.');

  let backup;
  try {
    backup = JSON.parse(fflate.strFromU8(unzipped['backup.json']));
  } catch (e) {
    throw new Error('backup.json is corrupted.');
  }
  if (backup.app !== 'poker-tracker' || !Array.isArray(backup.sessions)) {
    throw new Error('This zip is not a Poker Tracker backup.');
  }

  const hands = (backup.hands || []).map((h) => {
    const { audio_file, audio_type, ...rest } = h;
    if (audio_file && unzipped[audio_file]) {
      rest.audio = new Blob([unzipped[audio_file]], { type: audio_type || 'audio/webm' });
    }
    return rest;
  });

  await db.transaction('rw', db.sessions, db.buyins, db.hands, db.meta, async () => {
    // Never let an older 'active' snapshot overwrite a session completed since
    // the backup was taken — that would silently erase its cash-out and
    // resurrect it as live.
    const locals = await db.sessions.bulkGet(backup.sessions.map((s) => s.id));
    const merged = backup.sessions.map((s, i) =>
      s.status === 'active' && locals[i] && locals[i].status === 'completed' ? locals[i] : s
    );
    await db.sessions.bulkPut(merged);
    await db.buyins.bulkPut(backup.buyins || []);
    await db.hands.bulkPut(hands);
    if (Array.isArray(backup.meta)) {
      await db.meta.bulkPut(backup.meta.filter((m) => m && m.key === 'recents'));
    }
    // Belt and braces: if a restore still produced two live sessions, keep the
    // newest and complete the rest so the live screen stays unambiguous.
    const actives = await db.sessions.where('status').equals('active').toArray();
    if (actives.length > 1) {
      actives.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));
      for (const old of actives.slice(1)) {
        await db.sessions.update(old.id, { status: 'completed', end_time: old.end_time || old.start_time });
      }
    }
  });

  return {
    sessions: backup.sessions.length,
    buyins: (backup.buyins || []).length,
    hands: hands.length,
  };
}
