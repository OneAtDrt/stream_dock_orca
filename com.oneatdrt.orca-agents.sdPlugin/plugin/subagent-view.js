'use strict';

// Live view of one Claude Code subagent, opened in an Orca terminal by pressing its key:
//   node subagent-view.js <agent-<id>.jsonl> [title]
// Prints the transcript so far (what it said, tools it called, results), then follows new lines.

const fs = require('node:fs');

const POLL_MS = 500;
const ANSI = { dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };

function oneLine(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// The most telling argument of a tool call, e.g. the command, file or pattern.
function toolSummary(input = {}) {
  const key = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'prompt', 'path'].find((k) => input[k]);
  return key ? oneLine(input[key], 140) : '';
}

function resultText(content) {
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join(' ');
  return content;
}

// One transcript line -> printable lines (plain text; colours added by the caller).
function formatEntry(entry) {
  const out = [];
  const content = entry?.message?.content;
  if (entry?.type === 'user') {
    if (typeof content === 'string') out.push({ kind: 'task', text: oneLine(content, 400) });
    else for (const c of content || []) {
      if (c.type === 'tool_result') out.push({ kind: 'result', text: oneLine(resultText(c.content), 200) });
      else if (c.type === 'text') out.push({ kind: 'task', text: oneLine(c.text, 400) });
    }
  } else if (entry?.type === 'assistant') {
    for (const c of content || []) {
      if (c.type === 'text' && c.text.trim()) out.push({ kind: 'say', text: c.text.trim() });
      else if (c.type === 'tool_use') out.push({ kind: 'tool', text: `${c.name} ${toolSummary(c.input)}`.trim() });
    }
  }
  return out;
}

const STYLE = {
  task: (t) => `${ANSI.bold}${ANSI.cyan}▶ ${t}${ANSI.reset}`,
  say: (t) => `${ANSI.green}${t}${ANSI.reset}`,
  tool: (t) => `${ANSI.yellow}⚙ ${t}${ANSI.reset}`,
  result: (t) => `${ANSI.dim}  ↳ ${t}${ANSI.reset}`
};

function printLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  for (const { kind, text } of formatEntry(entry)) console.log(STYLE[kind](text));
}

function follow(file) {
  let offset = 0;
  let partial = '';
  const read = () => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return; // not created yet
    }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const lines = (partial + buf.toString('utf8')).split('\n');
    partial = lines.pop();
    lines.filter(Boolean).forEach(printLine);
  };
  read();
  setInterval(read, POLL_MS);
}

if (require.main === module) {
  const [file, title] = process.argv.slice(2);
  if (!file) {
    console.error('usage: subagent-view.js <agent-transcript.jsonl> [title]');
    process.exit(1);
  }
  if (title) console.log(`${ANSI.bold}${title}${ANSI.reset}  ${ANSI.dim}(live — close this tab when done)${ANSI.reset}\n`);
  follow(file);
}

module.exports = { formatEntry, toolSummary, oneLine };
