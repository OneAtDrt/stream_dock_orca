'use strict';

const STATUS_STYLE = {
  waiting: { color: '#f59e0b', label: 'WAITING' },
  working: { color: '#3b82f6', label: 'WORKING' },
  subagents: { color: '#6366f1', label: 'SUBS' },
  done: { color: '#22c55e', label: 'DONE' },
  idle: { color: '#475569', label: 'IDLE' }
};

const FONT = 'font-family="-apple-system, Helvetica, Arial, sans-serif"';

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function formatAge(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Greedy word wrap; hard-cuts words longer than a line and ellipsizes overflow.
function wrap(text, maxChars, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

function toDataUri(svg) {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

function svgFrame(body, border = '#1e293b', { background = '#0b1120', dashed = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" rx="20" fill="${background}"/>
<rect x="2" y="2" width="140" height="140" rx="18" fill="none" stroke="${border}" stroke-width="4"${dashed ? ' stroke-dasharray="10 6"' : ''}/>
${body}
</svg>`;
}

// Pill right of the agent name: a drawn fork icon plus the running subagent count.
function subagentBadge(count, color) {
  if (!count) return '';
  return `
<rect x="104" y="44" width="30" height="14" rx="7" fill="${color}"/>
<path d="M110 47v8M110 53c0-3 5-3 5-5" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="110" cy="47" r="1.6" fill="#fff"/><circle cx="110" cy="55" r="1.6" fill="#fff"/><circle cx="115" cy="48" r="1.6" fill="#fff"/>
<text x="130" y="55" ${FONT} font-size="11" font-weight="800" fill="#fff" text-anchor="end">${count > 9 ? '9+' : count}</text>`;
}

// What the big text in the middle of an agent key shows: the repository or the chat (task) name.
// 'auto' shows the chat when several agents work in the same repository, where the repo name
// alone can't tell them apart.
function mainTextFor(agent, agents, mode = 'auto') {
  if (!agent.task) return 'project';
  if (mode === 'task' || mode === 'project') return mode;
  return agents.filter((a) => a.project === agent.project).length > 1 ? 'task' : 'project';
}

// Big text block: [lines, fontSize, ys]. Short repo names get large type; chat names wrap to 3 lines.
function mainBlock(text, kind) {
  if (kind === 'task') {
    const lines = wrap(text, 13, 3);
    if (lines.length === 1) return [lines, 20, [88]];
    if (lines.length === 2) return [lines, 18, [79, 99]];
    // Three lines use smaller type; wrap a bit narrower so long (e.g. Cyrillic) words fit the key.
    return [wrap(text, 12, 3), 16, [72, 90, 108]];
  }
  const lines = wrap(text, 11, 2);
  return [lines, lines.length > 1 ? 20 : lines[0].length > 9 ? 21 : 25, lines.length > 1 ? [74, 94] : [80]];
}

function renderAgent(agent, now = Date.now(), blink = false, main = 'project') {
  const style = STATUS_STYLE[agent.status] || STATUS_STYLE.idle;
  const byTask = main === 'task' && agent.task;
  const [project, projectSize, projectY] = mainBlock(byTask ? agent.task : agent.project, byTask ? 'task' : 'project');
  // The other name in small type underneath: the task (2 lines) or, with a chat on top, the repo.
  const task = byTask ? wrap(agent.project, 17, 1) : wrap(agent.task, 17, 2);
  const taskY = byTask ? [131] : [115, 131];
  const agentName = (agent.agent || '').toUpperCase().slice(0, 7);
  const busy = agent.status === 'working' || agent.status === 'subagents';
  const dotOpacity = busy && blink ? 0.35 : 1;
  const subCount = (agent.subagents || []).length;
  // Main turn over, subagents still running: fork icon instead of the dot, plus the count.
  const label = agent.status === 'subagents' ? `${style.label} ×${subCount}` : style.label;
  const marker = agent.status === 'subagents'
    ? `<path d="M20 18.5v13M20 28c0-4.5 7-4.5 7-8.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="${dotOpacity}"/>
<circle cx="20" cy="18.5" r="2.2" fill="#fff" opacity="${dotOpacity}"/><circle cx="20" cy="31.5" r="2.2" fill="#fff" opacity="${dotOpacity}"/><circle cx="27" cy="19.5" r="2.2" fill="#fff" opacity="${dotOpacity}"/>`
    : `<circle cx="23" cy="25" r="5" fill="#fff" opacity="${dotOpacity}"/>`;
  const border = agent.status === 'waiting' && blink ? '#fde68a' : style.color;

  const body = `
<rect x="10" y="10" width="124" height="30" rx="10" fill="${style.color}"/>
${marker}
<text x="33" y="30" ${FONT} font-size="13" font-weight="800" fill="#fff">${escapeXml(label)}</text>
<text x="127" y="30" ${FONT} font-size="13" font-weight="700" fill="#fff" text-anchor="end">${escapeXml(formatAge(now - agent.since))}</text>
${project.map((l, i) => `<text x="72" y="${projectY[i]}" ${FONT} font-size="${projectSize}" font-weight="800" fill="#f8fafc" text-anchor="middle">${escapeXml(l)}</text>`).join('')}
${task.map((l, i) => `<text x="72" y="${taskY[i]}" ${FONT} font-size="13" font-weight="500" fill="#94a3b8" text-anchor="middle">${escapeXml(l)}</text>`).join('')}
${subagentBadge(subCount, style.color)}
<text x="72" y="55" ${FONT} font-size="10" font-weight="700" fill="${style.color}" text-anchor="middle" letter-spacing="1">${escapeXml(agentName)}</text>`;
  return toDataUri(svgFrame(body, border));
}

// A running subagent, shown on the key after its parent: dashed border, darker fill, "↳ SUB i/n" bar.
function renderSubagent(slot, now = Date.now(), blink = false) {
  const style = STATUS_STYLE[slot.status] || STATUS_STYLE.working;
  const desc = wrap(slot.description || slot.agentType || 'subagent', 15, 3);
  const descY = [[94], [85, 103], [76, 94, 112]][desc.length - 1];
  const agentType = (slot.agentType || '').toUpperCase().slice(0, 18);
  const parent = wrap(slot.parentProject, 20, 1)[0] || '';
  const arrowOpacity = slot.status === 'working' && blink ? 0.35 : 1;
  const border = slot.status === 'waiting' && blink ? '#fde68a' : style.color;

  const body = `
<rect x="10" y="10" width="124" height="30" rx="10" fill="${style.color}"/>
<path d="M18 17v8h9M23.5 21.5l3.5 3.5-3.5 3.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="${arrowOpacity}"/>
<text x="33" y="30" ${FONT} font-size="13" font-weight="800" fill="#fff">${escapeXml(`SUB ${slot.index}/${slot.total}`)}</text>
<text x="127" y="30" ${FONT} font-size="13" font-weight="700" fill="#fff" text-anchor="end">${escapeXml(formatAge(now - slot.since))}</text>
<text x="72" y="55" ${FONT} font-size="10" font-weight="700" fill="${style.color}" text-anchor="middle" letter-spacing="1">${escapeXml(agentType)}</text>
${desc.map((l, i) => `<text x="72" y="${descY[i]}" ${FONT} font-size="15" font-weight="700" fill="#e2e8f0" text-anchor="middle">${escapeXml(l)}</text>`).join('')}
<text x="72" y="131" ${FONT} font-size="11" font-weight="600" fill="#64748b" text-anchor="middle">${escapeXml(parent)}</text>`;
  return toDataUri(svgFrame(body, border, { background: '#111a2e', dashed: true }));
}

function renderEmpty(slotIndex) {
  const body = `
<text x="72" y="70" ${FONT} font-size="15" font-weight="700" fill="#334155" text-anchor="middle">no agent</text>
<text x="72" y="92" ${FONT} font-size="12" fill="#334155" text-anchor="middle">slot ${slotIndex + 1}</text>`;
  return toDataUri(svgFrame(body));
}

function renderError(message) {
  const lines = wrap(message, 16, 3);
  const body = `
<text x="72" y="44" ${FONT} font-size="15" font-weight="800" fill="#ef4444" text-anchor="middle">ORCA</text>
${lines.map((l, i) => `<text x="72" y="${72 + i * 18}" ${FONT} font-size="12" fill="#fca5a5" text-anchor="middle">${escapeXml(l)}</text>`).join('')}`;
  return toDataUri(svgFrame(body, '#7f1d1d'));
}

function renderSummary(agents, blink = false) {
  const count = (s) => agents.filter((a) => a.status === s).length;
  const rows = [
    ['waiting', count('waiting')],
    ['working', count('working') + count('subagents')],
    ['done', count('done')]
  ];
  const needsYou = rows[0][1] > 0;
  const border = needsYou ? (blink ? '#fde68a' : STATUS_STYLE.waiting.color) : '#1e293b';
  const body = `
<text x="72" y="30" ${FONT} font-size="13" font-weight="800" fill="#e2e8f0" text-anchor="middle" letter-spacing="1">ORCA · ${agents.length}</text>
${rows.map(([status, n], i) => {
    const y = 44 + i * 30;
    const s = STATUS_STYLE[status];
    return `<rect x="14" y="${y}" width="116" height="24" rx="8" fill="${s.color}" opacity="${n ? 1 : 0.25}"/>
<text x="24" y="${y + 17}" ${FONT} font-size="12" font-weight="800" fill="#fff">${s.label}</text>
<text x="120" y="${y + 18}" ${FONT} font-size="17" font-weight="800" fill="#fff" text-anchor="end">${n}</text>`;
  }).join('\n')}`;
  return toDataUri(svgFrame(body, border));
}

// ---- AI Limits (approved design): Claude + ChatGPT rows on a 176×112 knob panel / 144×144 key ----

const LIM = { bg: '#0b1120', on: '#f8fafc', dim: '#64748b', sub: '#94a3b8', green: '#22c55e', amber: '#f59e0b', red: '#ef4444', track: '#1e293b' };

function limText(x, y, s, size, fill, weight = 700, anchor = 'start') {
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(s)}</text>`;
}

// Own simple badges in the services' brand colours (not the official logos).
function claudeBadge(x, y, s = 30) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `<line x1="${(cx + Math.cos(a) * s * 0.12).toFixed(1)}" y1="${(cy + Math.sin(a) * s * 0.12).toFixed(1)}" x2="${(cx + Math.cos(a) * s * 0.36).toFixed(1)}" y2="${(cy + Math.sin(a) * s * 0.36).toFixed(1)}" stroke="#fff" stroke-width="${s * 0.1}" stroke-linecap="round"/>`;
  }).join('');
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}" fill="#d97757"/>${rays}`;
}

function gptBadge(x, y, s = 30) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const petals = Array.from({ length: 6 }, (_, i) => `<ellipse cx="${cx}" cy="${cy - s * 0.14}" rx="${s * 0.1}" ry="${s * 0.22}" fill="none" stroke="#0b1120" stroke-width="${s * 0.075}" transform="rotate(${i * 60} ${cx} ${cy})"/>`).join('');
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}" fill="#f8fafc"/>${petals}`;
}

const leftColor = (v) => (v == null ? LIM.dim : v > 50 ? LIM.green : v > 20 ? LIM.amber : LIM.red);

function formatReset(ms) {
  if (ms == null) return '';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ${min % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function stopwatch(x, y, color) {
  return `<circle cx="${x + 5}" cy="${y + 6}" r="4.2" fill="none" stroke="${color}" stroke-width="1.4"/><line x1="${x + 5}" y1="${y + 6}" x2="${x + 5}" y2="${y + 3.4}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/><line x1="${x + 3.6}" y1="${y}" x2="${x + 6.4}" y2="${y}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`;
}

// One provider row: badge, big "% left" of the tightest general window, top right the time left in
// the 5-hour session window (grey weekly reset when there is none), one thin bar per window.
function limitsRow(y, badge, name, p, now) {
  if (!p) return `${badge}${limText(46, y + 13, name, 11, LIM.sub, 800)}${limText(46, y + 32, 'no data', 15, LIM.dim, 800)}`;
  const general = p.windows.filter((w) => !w.model);
  const tight = (general.length ? general : p.windows).reduce((a, b) => (b.left < a.left ? b : a));
  const session = p.windows.find((w) => w.label === '5h') || general[0] || p.windows[0];
  const sessionText = formatReset(session.resetAt == null ? null : session.resetAt - now);
  const sessionColor = session.label === '5h' ? LIM.on : LIM.dim;
  const step = p.windows.length > 2 ? 10 : 11;
  const bars = p.windows.map((w, i) => {
    const by = y + 19 + i * step;
    const right = w.model ? `${w.left}%` : w === session ? '' : formatReset(w.resetAt == null ? null : w.resetAt - now);
    return `${limText(104, by + 6, w.label, 8, w.model ? LIM.sub : LIM.dim, 700, 'end')}<rect x="107" y="${by}" width="30" height="5" rx="2.5" fill="${LIM.track}"/><rect x="107" y="${by}" width="${Math.max(2, (w.left / 100) * 30).toFixed(1)}" height="5" rx="2.5" fill="${leftColor(w.left)}"/>${limText(166, by + 6, right, 8, w.model ? leftColor(w.left) : LIM.sub, 800, 'end')}`;
  }).join('');
  return `${badge}
${limText(46, y + 13, name, 11, LIM.sub, 800)}
${sessionText ? stopwatch(166 - sessionText.length * 6.4 - 14, y + 3, sessionColor) + limText(166, y + 13, sessionText, 11, sessionColor, 800, 'end') : ''}
${limText(46, y + 35, `${tight.left}%`, 22, leftColor(tight.left), 800)}
${bars}`;
}

const LIMIT_PAGES = ['overview', 'claude', 'gpt'];
const PROVIDERS = { claude: { name: 'CLAUDE', badge: claudeBadge }, gpt: { name: 'CHATGPT', badge: gptBadge } };
const WINDOW_NAMES = { '5h': '5-hour', wk: 'Week', fable: 'Fable' };

function limitDots(page, cx, y) {
  return LIMIT_PAGES.map((_, i) => `<circle cx="${cx + (i - 1) * 9}" cy="${y}" r="2.6" fill="${i === page ? LIM.on : LIM.dim}"/>`).join('');
}

// Time left in the 5-hour session window (else the first general window's reset), for a provider.
function sessionInfo(p, now) {
  const general = p.windows.filter((w) => !w.model);
  const session = p.windows.find((w) => w.label === '5h') || general[0] || p.windows[0];
  return { text: formatReset(session.resetAt == null ? null : session.resetAt - now), isSession: session.label === '5h' };
}

// ---- 144×144 key layouts (use the whole key; big type) ----

function keyOverviewHalf(y, key, p, now) {
  const { name, badge } = PROVIDERS[key];
  if (!p) return `${badge(10, y + 10, 30)}${limText(48, y + 26, name, 11, LIM.sub, 800)}${limText(48, y + 48, 'no data', 16, LIM.dim, 800)}`;
  const tight = (p.windows.filter((w) => !w.model).length ? p.windows.filter((w) => !w.model) : p.windows).reduce((a, b) => (b.left < a.left ? b : a));
  const ses = sessionInfo(p, now);
  const color = ses.isSession ? LIM.on : LIM.dim;
  return `${badge(10, y + 8, 30)}
${limText(134, y + 38, `${tight.left}%`, 34, leftColor(tight.left), 800, 'end')}
${ses.text ? stopwatch(10, y + 48, color) + limText(24, y + 59, ses.text, 13, color, 800) : ''}
<rect x="${ses.text ? 84 : 10}" y="${y + 51}" width="${ses.text ? 50 : 124}" height="6" rx="3" fill="${LIM.track}"/><rect x="${ses.text ? 84 : 10}" y="${y + 51}" width="${Math.max(3, (tight.left / 100) * (ses.text ? 50 : 124)).toFixed(1)}" height="6" rx="3" fill="${leftColor(tight.left)}"/>`;
}

function keyDetail(key, p, now) {
  const { name, badge } = PROVIDERS[key];
  const head = `${badge(10, 8, 24)}${limText(40, 26, name, 13, LIM.on, 800)}`;
  if (!p) return `${head}${limText(72, 84, 'no data', 18, LIM.dim, 800, 'middle')}`;
  const rows = p.windows.slice(0, 3);
  if (rows.length === 1) return head + singleWindow(rows[0], now, { cx: 72, labelY: 52, numY: 98, numSize: 50, barX: 12, barW: 120, barY: 108, resetY: 128 });
  // Fewer windows -> taller rows and bigger numbers, so the key is always filled.
  const [h, size] = rows.length === 1 ? [88, 40] : rows.length === 2 ? [46, 28] : [31, 22];
  return head + rows.map((w, i) => {
    const y = 38 + i * h;
    const reset = formatReset(w.resetAt == null ? null : w.resetAt - now);
    const barY = y + h - 12;
    return `${limText(10, y + 15, WINDOW_NAMES[w.label] || w.label, 13, w.model ? LIM.sub : LIM.on, 800)}
${limText(134, barY - 4, `${w.left}%`, size, leftColor(w.left), 800, 'end')}
<rect x="10" y="${barY}" width="${reset ? 70 : 124}" height="5" rx="2.5" fill="${LIM.track}"/><rect x="10" y="${barY}" width="${Math.max(2, (w.left / 100) * (reset ? 70 : 124)).toFixed(1)}" height="5" rx="2.5" fill="${leftColor(w.left)}"/>
${reset ? limText(134, barY + 6, `↻ ${reset}`, 10, LIM.sub, 700, 'end') : ''}`;
  }).join('');
}

// A provider with a single window (e.g. ChatGPT with only a weekly limit): centred window name, one
// big number, a thick full-width bar under it and the reset time, so the key isn't half empty.
function singleWindow(w, now, g) {
  const reset = formatReset(w.resetAt == null ? null : w.resetAt - now);
  const color = leftColor(w.left);
  return `${limText(g.cx, g.labelY, WINDOW_NAMES[w.label] || w.label, 13, w.model ? LIM.sub : LIM.on, 800, 'middle')}
${limText(g.cx, g.numY, `${w.left}%`, g.numSize, color, 800, 'middle')}
<rect x="${g.barX}" y="${g.barY}" width="${g.barW}" height="8" rx="4" fill="${LIM.track}"/><rect x="${g.barX}" y="${g.barY}" width="${Math.max(4, (w.left / 100) * g.barW).toFixed(1)}" height="8" rx="4" fill="${color}"/>
${reset ? limText(g.cx, g.resetY, `↻ ${reset}`, 12, LIM.sub, 700, 'middle') : ''}`;
}

// ---- 176×112 knob panel: overview (two rows) or one provider in detail ----

function panelDetail(key, p, now) {
  const { name, badge } = PROVIDERS[key];
  const head = `${badge(8, 6, 20)}${limText(34, 21, name, 12, LIM.on, 800)}`;
  if (!p) return `${head}${limText(88, 70, 'no data', 18, LIM.dim, 800, 'middle')}`;
  const rows = p.windows.slice(0, 3);
  if (rows.length === 1) return head + singleWindow(rows[0], now, { cx: 88, labelY: 44, numY: 80, numSize: 38, barX: 14, barW: 148, barY: 88, resetY: 106 });
  const [h, size] = rows.length === 2 ? [38, 22] : [26, 17];
  return head + rows.map((w, i) => {
    const y = 34 + i * h;
    const reset = formatReset(w.resetAt == null ? null : w.resetAt - now);
    const mid = y + Math.min(h, 26) / 2 + 2;
    return `${limText(8, mid + 4, WINDOW_NAMES[w.label] || w.label, 12, w.model ? LIM.sub : LIM.on, 800)}
<rect x="56" y="${mid - 3}" width="40" height="6" rx="3" fill="${LIM.track}"/><rect x="56" y="${mid - 3}" width="${Math.max(2, (w.left / 100) * 40).toFixed(1)}" height="6" rx="3" fill="${leftColor(w.left)}"/>
${limText(134, mid + size * 0.36, `${w.left}%`, size, leftColor(w.left), 800, 'end')}
${reset ? limText(172, mid + 4, reset.replace(/ /g, ''), 9, LIM.sub, 700, 'end') : ''}`;
  }).join('');
}

// page: 0 = overview, 1 = Claude, 2 = ChatGPT (press cycles).
function renderLimits(model, { square = false, now = Date.now(), page = 0 } = {}) {
  const which = LIMIT_PAGES[page] || 'overview';
  let body;
  if (square) {
    body = which === 'overview'
      ? `${keyOverviewHalf(0, 'claude', model?.claude, now)}<line x1="10" y1="66.5" x2="134" y2="66.5" stroke="${LIM.track}"/>${keyOverviewHalf(66, 'gpt', model?.gpt, now)}${limitDots(0, 72, 139)}`
      : `${keyDetail(which, model?.[which], now)}${limitDots(page, 72, 139)}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${LIM.bg}"/>${body}</svg>`;
    return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
  }
  body = which === 'overview'
    ? `${limitsRow(6, claudeBadge(8, 8), 'CLAUDE', model?.claude, now)}<line x1="8" y1="56.5" x2="168" y2="56.5" stroke="${LIM.track}"/>${limitsRow(60, gptBadge(8, 62), 'CHATGPT', model?.gpt, now)}`
    : `${panelDetail(which, model?.[which], now)}${limitDots(page, 154, 14)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="112" viewBox="0 0 176 112"><rect width="176" height="112" fill="${LIM.bg}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

module.exports = { mainTextFor, renderLimits, LIMIT_PAGES, leftColor, renderAgent, renderSubagent, renderEmpty, renderError, renderSummary, formatAge, wrap };
