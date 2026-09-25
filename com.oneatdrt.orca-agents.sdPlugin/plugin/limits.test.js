'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLimits, tightest, worstLeft } = require('./limits');
const { renderLimits } = require('./render');

const NOW = 1_800_000_000_000;
// Shape of `orca account list --json` -> result.rateLimits (values made up).
const result = {
  rateLimits: {
    claude: {
      provider: 'claude', status: 'ok', error: null, updatedAt: NOW,
      session: { usedPercent: 38, windowMinutes: 300, resetsAt: NOW + 134 * 60e3 },
      weekly: { usedPercent: 65, windowMinutes: 10080, resetsAt: NOW + 3 * 86400e3 },
      fableWeekly: { usedPercent: 100, windowMinutes: 10080, resetsAt: NOW + 3 * 86400e3 }
    },
    codex: { provider: 'codex', status: 'ok', session: null, weekly: { usedPercent: 98.4, windowMinutes: 10080, resetsAt: NOW + 2 * 86400e3 } },
    gemini: { provider: 'gemini', status: 'error', error: 'Token refresh failed' }
  }
};

test('parses Claude (5h, weekly, Fable) and ChatGPT windows from Orca', () => {
  const m = parseLimits(result);
  assert.deepEqual(m.claude.windows.map((w) => [w.label, w.left, !!w.model]), [['5h', 62, false], ['wk', 35, false], ['fable', 0, true]]);
  assert.deepEqual(m.gpt.windows.map((w) => [w.label, w.left]), [['wk', 2]]);
  assert.equal(parseLimits({ rateLimits: { claude: { status: 'error' } } }).claude, null);
  assert.deepEqual(parseLimits({}), { claude: null, gpt: null });
});

test('Fable does not drive the big number; the ring follows the lowest provider', () => {
  const m = parseLimits(result);
  assert.equal(tightest(m.claude).label, 'wk'); // 35% left, even though Fable is at 0%
  assert.equal(worstLeft(m), 2); // ChatGPT weekly
  assert.equal(worstLeft({ claude: null, gpt: null }), null);
});

test('limits panel renders both rows, the session countdown and a no-data row', () => {
  const svg = decodeURIComponent(renderLimits(parseLimits(result), { now: NOW }));
  assert.match(svg, />CLAUDE</);
  assert.match(svg, />35%</); // tightest general window
  assert.match(svg, />2h 14m</); // time left in the 5-hour window
  assert.match(svg, />fable</);
  assert.match(svg, />2%</);
  assert.match(svg, /width="176" height="112"/);
  const empty = decodeURIComponent(renderLimits({ claude: null, gpt: null }, { square: true }));
  assert.equal((empty.match(/>no data</g) || []).length, 2);
  assert.match(empty, /width="144" height="144"/);
});

test('limits pages: overview, Claude detail and ChatGPT detail fill the key', () => {
  const m = parseLimits(result);
  const page = (p, square) => decodeURIComponent(renderLimits(m, { now: NOW, square, page: p }));
  assert.match(page(1, true), />5-hour</);
  assert.match(page(1, true), />Fable</);
  assert.match(page(1, true), /viewBox="0 0 144 144"/); // native square layout, not the letterboxed panel
  assert.match(page(2, true), />CHATGPT</);
  assert.match(page(2, false), />Week</);
  assert.equal((page(0, true).match(/<circle cx="\d+(\.\d+)?" cy="139" r="2.6"/g) || []).length, 3); // page dots
});
