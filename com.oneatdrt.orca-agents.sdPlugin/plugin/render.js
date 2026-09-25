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

function renderAgent(agent, now = Date.now(), blink = false) {
  const style = STATUS_STYLE[agent.status] || STATUS_STYLE.idle;
  const project = wrap(agent.project, 11, 2);
  const task = wrap(agent.task, 17, 2);
  const projectSize = project.length > 1 ? 20 : project[0].length > 9 ? 21 : 25;
  const projectY = project.length > 1 ? [74, 94] : [80];
  const taskY = [115, 131];
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

module.exports = { renderAgent, renderSubagent, renderEmpty, renderError, renderSummary, formatAge, wrap };
