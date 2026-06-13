/* Stats: pure computations over completed sessions + the cumulative chart. */

// rows: array of { session, totalBuyin, net, hours, rate } from DB,
// already filtered to completed sessions (net != null).
function computeStats(rows) {
  const count = rows.length;
  const nets = rows.map((r) => r.net);
  const totalNet = nets.reduce((a, b) => a + b, 0);
  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const totalExpenses = rows.reduce((a, r) => a + (Number(r.session.expenses) || 0), 0);
  const rate = totalHours > 0 ? totalNet / totalHours : null;
  const wins = nets.filter((n) => n > 0).length;
  const winRate = count > 0 ? wins / count : null;

  let stdDev = null;
  if (count > 1) {
    const mean = totalNet / count;
    const variance = nets.reduce((a, n) => a + (n - mean) ** 2, 0) / (count - 1);
    stdDev = Math.sqrt(variance);
  }

  const biggestWin = count ? Math.max(...nets) : null;
  const biggestLoss = count ? Math.min(...nets) : null;

  const groupBy = (keyFn) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyFn(r) || '(none)';
      if (!map.has(key)) map.set(key, { key, count: 0, net: 0, hours: 0 });
      const g = map.get(key);
      g.count += 1;
      g.net += r.net;
      g.hours += r.hours;
    }
    const list = [...map.values()];
    for (const g of list) g.rate = g.hours > 0 ? g.net / g.hours : null;
    list.sort((a, b) => b.net - a.net);
    return list;
  };

  // Cumulative line, oldest first.
  const ordered = [...rows].sort((a, b) =>
    a.session.start_time < b.session.start_time ? -1 : 1
  );
  let cum = 0;
  const cumulative = ordered.map((r) => {
    cum += r.net;
    return { date: r.session.date, cum };
  });

  return {
    count,
    totalNet,
    totalHours,
    totalExpenses,
    rate,
    winRate,
    stdDev,
    biggestWin,
    biggestLoss,
    byStake: groupBy((r) => r.session.stakes),
    byVenue: groupBy((r) => r.session.venue),
    cumulative,
  };
}

function drawCumulativeChart(canvas, points) {
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = canvas.clientHeight || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const css = getComputedStyle(document.documentElement);
  const colGrid = css.getPropertyValue('--border').trim() || '#2e333d';
  const colText = css.getPropertyValue('--muted').trim() || '#9aa1ac';
  const colLine = css.getPropertyValue('--accent').trim() || '#4ade80';
  const colRed = css.getPropertyValue('--red').trim() || '#ef4444';

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.font = '11px system-ui, sans-serif';

  if (!points.length) {
    ctx.fillStyle = colText;
    ctx.textAlign = 'center';
    ctx.fillText('No completed sessions in this filter', cssWidth / 2, cssHeight / 2);
    return;
  }

  const pad = { l: 48, r: 12, t: 12, b: 24 };
  const w = cssWidth - pad.l - pad.r;
  const h = cssHeight - pad.t - pad.b;

  const values = points.map((p) => p.cum);
  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const ySpan = yMax - yMin;
  yMin -= ySpan * 0.08;
  yMax += ySpan * 0.08;

  const xAt = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const yAt = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * h;

  // y gridlines + labels
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    const y = yAt(v);
    ctx.strokeStyle = colGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.fillStyle = colText;
    ctx.fillText('$' + Math.round(v).toLocaleString(), pad.l - 6, y);
  }

  // zero line
  if (yMin < 0 && yMax > 0) {
    const y0 = yAt(0);
    ctx.strokeStyle = colRed;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, y0);
    ctx.lineTo(pad.l + w, y0);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // line
  ctx.strokeStyle = colLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.cum);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots (only when sparse enough to be readable)
  if (points.length <= 60) {
    ctx.fillStyle = colLine;
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(p.cum), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // x labels: first + last date
  ctx.fillStyle = colText;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(points[0].date, pad.l, pad.t + h + 6);
  if (points.length > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length - 1].date, pad.l + w, pad.t + h + 6);
  }
}
