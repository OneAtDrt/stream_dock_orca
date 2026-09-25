'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgents, deriveStatus, projectLabel, taskLabel, DONE_FADE_MS } = require('./agents');
const { wrap, formatAge, renderAgent, renderSummary } = require('./render');

const NOW = 1_800_000_000_000;

function term(overrides = {}) {
  return {
    handle: 'term_1', tabId: 'tab', leafId: 'leaf', agentIdentity: 'claude', connected: true, orphaned: false,
    worktreePath: '/Users/x/orca/workspaces/my-api/tuna', title: '✳ Fix login', lastOutputAt: NOW - 1000,
    ...overrides
  };
}

function hook(state, overrides = {}) {
  return { hookEventName: 'Stop', payload: { state }, receivedAt: NOW - 5000, stateStartedAt: NOW - 5000, ...overrides };
}

test('hook states map to display statuses', () => {
  assert.equal(deriveStatus(term(), hook('working'), NOW), 'working');
  for (const s of ['blocked', 'waiting', 'permission']) assert.equal(deriveStatus(term(), hook(s), NOW), 'waiting');
  assert.equal(deriveStatus(term(), hook('done'), NOW), 'done');
  assert.equal(deriveStatus(term(), hook('done', { hookEventName: 'SessionStart' }), NOW), 'idle');
  assert.equal(deriveStatus(term(), hook('done', { stateStartedAt: NOW - DONE_FADE_MS - 1 }), NOW), 'idle');
});

test('falls back to the terminal title glyph without hook data', () => {
  assert.equal(deriveStatus(term({ title: '◑ Busy' }), undefined, NOW), 'working');
  assert.equal(deriveStatus(term({ title: '⠂ Busy' }), undefined, NOW), 'working');
  assert.equal(deriveStatus(term({ title: '✳ Idle' }), undefined, NOW), 'idle');
  assert.equal(deriveStatus(term({ title: 'recording-bot' }), undefined, NOW), 'idle');
});

test('labels', () => {
  assert.equal(projectLabel('/Users/x/orca/workspaces/my-api/tuna'), 'my-api');
  assert.equal(projectLabel('/Users/x/code/notes'), 'notes');
  assert.equal(taskLabel(term({ title: '◑ Mirabox plugin' })), 'Mirabox plugin');
  assert.equal(taskLabel(term({ title: '' }), hook('working', { payload: { prompt: 'do\nthe thing' } })), 'do the thing');
});

test('buildAgents skips plain shells and sorts needs-you, working, done, idle', () => {
  const terminals = [
    term({ handle: 'idle', tabId: 'a' }),
    term({ handle: 'shell', tabId: 'b', agentIdentity: undefined }),
    term({ handle: 'done', tabId: 'c' }),
    term({ handle: 'work', tabId: 'd' }),
    term({ handle: 'wait', tabId: 'e' }),
    term({ handle: 'gone', tabId: 'f', orphaned: true })
  ];
  const hooks = {
    'c:leaf': hook('done'),
    'd:leaf': hook('working'),
    'e:leaf': hook('permission')
  };
  const agents = buildAgents(terminals, hooks, NOW);
  assert.deepEqual(agents.map((a) => a.handle), ['wait', 'work', 'done', 'idle']);
  assert.equal(agents[0].project, 'my-api');
});

test('render helpers', () => {
  assert.deepEqual(wrap('a very long sentence that overflows', 10, 2), ['a very', 'long…']);
  assert.deepEqual(wrap('supercalifragilistic', 8, 3), ['supercal', 'ifragili', 'stic']);
  assert.equal(formatAge(30_000), 'now');
  assert.equal(formatAge(75 * 60_000), '1h');
  const uri = renderAgent({ agent: 'claude', project: 'a<b', task: 'x & y', status: 'working', since: NOW }, NOW);
  assert.match(decodeURIComponent(uri), /a&lt;b/);
  assert.match(decodeURIComponent(renderSummary([])), /ORCA · 0/);
});
