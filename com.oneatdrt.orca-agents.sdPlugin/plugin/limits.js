'use strict';

// AI subscription limits (Claude, ChatGPT/Codex) as Orca already fetched them: `orca account list
// --json` carries `rateLimits`. Reusing Orca's copy means no Keychain access and no extra calls to
// the heavily rate-limited usage APIs.

const { execFile } = require('node:child_process');

const ORCA_BIN = process.env.ORCA_BIN || '/Applications/Orca.app/Contents/Resources/bin/orca';

function runOrca(args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(ORCA_BIN, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

const left = (w) => Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)));

// One Orca rate-limit window -> { label, left, resetAt, model? }, or null when absent/invalid.
function toWindow(w, label, model = false) {
  if (!w || !Number.isFinite(w.usedPercent)) return null;
  return { label, left: left(w), resetAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null, ...(model ? { model: true } : {}) };
}

// Orca's provider entry -> { windows, updatedAt } or null (not signed in / no data / error).
function toProvider(entry, fableKey) {
  if (!entry || entry.status !== 'ok') return null;
  const windows = [
    toWindow(entry.session, '5h'),
    toWindow(entry.weekly, 'wk'),
    fableKey ? toWindow(entry[fableKey], 'fable', true) : null
  ].filter(Boolean);
  return windows.length ? { windows, updatedAt: entry.updatedAt || null } : null;
}

function parseLimits(result) {
  const rl = result?.rateLimits || {};
  return { claude: toProvider(rl.claude, 'fableWeekly'), gpt: toProvider(rl.codex) };
}

async function loadLimits() {
  const json = JSON.parse(await runOrca(['account', 'list', '--json']));
  if (!json.ok) throw new Error('orca account list failed');
  return parseLimits(json.result);
}

// The window that decides the big number: the tightest general window (model-specific limits
// like Fable don't count: other models still work when only that quota is gone).
function tightest(provider) {
  const general = provider.windows.filter((w) => !w.model);
  return (general.length ? general : provider.windows).reduce((a, b) => (b.left < a.left ? b : a));
}

// Lowest remaining % across both providers, for the knob ring (null when nothing is known).
function worstLeft(model) {
  const values = [model.claude, model.gpt].filter(Boolean).map((p) => tightest(p).left);
  return values.length ? Math.min(...values) : null;
}

module.exports = { loadLimits, parseLimits, tightest, worstLeft };
