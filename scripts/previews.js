#!/usr/bin/env node
'use strict';

// Renders the README preview images with the plugin's real agents.js + render.js into
// docs/previews/<name>.png at 2× device scale. Needs Google Chrome (headless). Usage: node scripts/previews.js
// All sample content is made up: generic project names, tasks and subagent descriptions.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { buildAgents, flattenSlots } = require('../com.oneatdrt.orca-agents.sdPlugin/plugin/agents');
const { renderAgent, renderSubagent, renderSummary, renderEmpty, renderLimits } = require('../com.oneatdrt.orca-agents.sdPlugin/plugin/render');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '..', 'docs', 'previews');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-previews-'));
const KEY = 144;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Headless Chrome writes the screenshot but doesn't always exit, so wait for the file, then stop it.
async function screenshot(html, width, height, out, scale = 2) {
  const page = path.join(TMP, 'page.html');
  fs.writeFileSync(page, html);
  fs.rmSync(out, { force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(TMP, 'profile')}`, `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`
  ], { stdio: 'ignore', detached: true });
  let exited = false;
  chrome.on('exit', () => { exited = true; });
  try {
    for (let waited = 0; !fs.existsSync(out); waited += 100) {
      if (exited || waited > 30000) throw new Error(`Chrome produced no screenshot for ${path.basename(out)}`);
      await sleep(100);
    }
    await sleep(300); // let the write finish
  } finally {
    if (!exited) {
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
      while (!exited) await sleep(50);
    }
  }
  return out;
}

const pageHtml = (body, style = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000;overflow:hidden}img{display:block}${style}</style></head><body>${body}</body></html>`;

// Sample Orca data (terminals + hook entries) run through the plugin's own status logic.
const NOW = Date.now();
const min = (n) => NOW - n * 60000;
const terminal = (handle, agent, project, title) => ({
  handle, agentIdentity: agent, tabId: handle, leafId: 'pane', worktreePath: `/home/dev/code/${project}`, title
});
const hook = (state, since, extra = {}) => ({
  payload: { state, ...extra.payload }, hookEventName: extra.event || 'Stop', stateStartedAt: since, receivedAt: extra.receivedAt || since
});

const TERMINALS = [
  terminal('t1', 'claude', 'backend', 'Audit test coverage'),
  terminal('t2', 'codex', 'my-api', 'Add rate limiting to login'),
  terminal('t3', 'claude', 'web-app', 'Dark mode for settings page'),
  terminal('t4', 'claude', 'docs-site', 'Fix broken links in guides'),
  terminal('t5', 'claude', 'mobile-app', 'Refactor auth flow')
];
const HOOKS = {
  't1:pane': hook('working', min(9), {
    receivedAt: min(0.5),
    payload: {
      subagents: [
        { id: 'a1', state: 'working', agentType: 'Explore', description: 'Find untested modules', startedAt: min(6) },
        { id: 'a2', state: 'working', agentType: 'general-purpose', description: 'Write tests for the CSV parser', startedAt: min(3) }
      ]
    }
  }),
  't2:pane': hook('waiting', min(1), { event: 'Notification' }),
  't3:pane': hook('working', min(4), { event: 'PreToolUse' }),
  't4:pane': hook('done', min(12)),
  't5:pane': hook('done', min(180))
};

// Made-up limits in the shape the plugin reads from Orca.
const LIMITS = {
  claude: { windows: [
    { label: '5h', left: 62, resetAt: NOW + 134 * 60e3 },
    { label: 'wk', left: 45, resetAt: NOW + (3 * 24 + 4) * 3600e3 },
    { label: 'fable', left: 72, resetAt: NOW + (3 * 24 + 4) * 3600e3, model: true }
  ] },
  gpt: { windows: [
    { label: '5h', left: 88, resetAt: NOW + 201 * 60e3 },
    { label: 'wk', left: 18, resetAt: NOW + 2 * 86400e3 }
  ] }
};

function previews() {
  const agents = buildAgents(TERMINALS, HOOKS, NOW);
  const slots = flattenSlots(agents);
  const byProject = (p, kind = 'agent') => slots.find((s) => s.kind === kind && (s.project || s.parentProject) === p);
  const subs = slots.filter((s) => s.kind === 'subagent');
  const list = [
    ['agent-waiting', renderAgent(byProject('my-api'), NOW), 'WAITING: needs your input'],
    ['agent-working', renderAgent(byProject('web-app'), NOW), 'WORKING'],
    ['agent-subagents', renderAgent(byProject('backend'), NOW), 'SUBS ×2: turn over, 2 subagents running'],
    ['subagent-1', renderSubagent(subs[0], NOW), 'Subagent 1 of 2'],
    ['subagent-2', renderSubagent(subs[1], NOW), 'Subagent 2 of 2'],
    ['agent-done', renderAgent(byProject('docs-site'), NOW), 'DONE: finished in the last 30 min'],
    ['agent-idle', renderAgent(byProject('mobile-app'), NOW), 'IDLE'],
    ['summary', renderSummary(agents), 'Orca Summary'],
    ['empty', renderEmpty(7), 'Empty slot'],
    ['agent-chat-name', renderAgent({ ...byProject('web-app'), task: 'Migrate billing to the new API' }, NOW, false, 'task'), 'Main text: chat name'],
    ['limits-overview', renderLimits(LIMITS, { square: true, now: NOW, page: 0 }), 'AI Limits: overview'],
    ['limits-claude', renderLimits(LIMITS, { square: true, now: NOW, page: 1 }), 'AI Limits: Claude'],
    ['limits-chatgpt', renderLimits(LIMITS, { square: true, now: NOW, page: 2 }), 'AI Limits: ChatGPT']
  ];
  for (const [name, uri] of list) if (!uri) throw new Error(`no image for ${name}`);
  return list;
}

// A realistic row of keys: an agent with its two subagent keys, another agent, the summary.
const GALLERY = ['agent-subagents', 'subagent-1', 'subagent-2', 'agent-waiting', 'summary', 'limits-overview'];

function checkPng(file, width, height) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(/pixelWidth: (\d+)/.exec(out)[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(out)[1]);
  if (w !== width || h !== height) throw new Error(`${path.basename(file)}: ${w}×${h}, expected ${width}×${height}`);
  // A blank screenshot compresses to almost nothing.
  if (fs.statSync(file).size < 2000) throw new Error(`${path.basename(file)} looks blank`);
  return `${w}×${h}`;
}

async function gallery(items) {
  const pad = 20;
  const gap = 14;
  const W = pad * 2 + items.length * KEY + (items.length - 1) * gap;
  const H = pad * 2 + KEY;
  const cells = items.map(([, uri]) => `<img width="${KEY}" height="${KEY}" src="${uri}">`).join('');
  const html = pageHtml(`<div class="row">${cells}</div>`, `
body{background:#0a0a0a}.row{display:flex;gap:${gap}px;padding:${pad}px}`);
  const file = await screenshot(html, W, H, path.join(OUT, 'gallery.png'));
  console.log(`gallery.png ${checkPng(file, W * 2, H * 2)}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const list = previews();
  for (const [name, uri] of list) {
    const file = await screenshot(pageHtml(`<img width="${KEY}" height="${KEY}" src="${uri}">`), KEY, KEY, path.join(OUT, `${name}.png`));
    console.log(`${name}.png ${checkPng(file, KEY * 2, KEY * 2)}`);
  }
  await gallery(GALLERY.map((n) => list.find((p) => p[0] === n)));
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(TMP, { recursive: true, force: true }));
