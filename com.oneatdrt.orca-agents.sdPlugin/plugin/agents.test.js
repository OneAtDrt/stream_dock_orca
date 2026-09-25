'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgents, flattenSlots, deriveStatus, activeSubagents, subagentMetaPath, projectLabel, taskLabel, DONE_FADE_MS, SUBAGENT_STALE_MS
} = require('./agents');
const { wrap, formatAge, renderAgent, renderSubagent, renderSummary } = require('./render');

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

function sub(id, state = 'working', overrides = {}) {
  return { id, state, startedAt: NOW - 60_000, agentType: 'general-purpose', ...overrides };
}

test('activeSubagents keeps running roster entries, oldest first, with descriptions', () => {
  const h = hook('working', {
    receivedAt: NOW - 1000,
    payload: {
      state: 'working',
      subagents: [
        sub('a-late', 'working', { startedAt: NOW - 10_000 }),
        sub('a-idle', 'idle'),
        sub('a-early', 'blocked', { startedAt: NOW - 90_000, description: 'Own  description' }),
        sub('a-gone', 'unverifiable'),
        { state: 'working' }
      ]
    }
  });
  const subs = activeSubagents(h, NOW, { 'a-late': { description: 'Review auth flow' }, 'a-early': { description: 'ignored' } });
  assert.deepEqual(subs.map((s) => [s.id, s.description]), [['a-early', 'Own description'], ['a-late', 'Review auth flow']]);
  assert.deepEqual(activeSubagents(undefined, NOW), []);
  assert.deepEqual(activeSubagents(hook('working'), NOW), []);
  assert.deepEqual(activeSubagents({ ...h, receivedAt: NOW - SUBAGENT_STALE_MS - 1 }, NOW), []);
});

test('subagentMetaPath points next to the session transcript', () => {
  assert.equal(
    subagentMetaPath('/home/x/.claude/projects/my-api/abc-123.jsonl', 'a1b2'),
    '/home/x/.claude/projects/my-api/abc-123/subagents/agent-a1b2.meta.json'
  );
  assert.equal(subagentMetaPath(undefined, 'a1b2'), null);
  assert.equal(subagentMetaPath('/x/s.jsonl', '../evil'), null);
});

test('main turn over but subagents running gets its own "subagents" status', () => {
  const withSub = (overrides = {}) => hook('done', {
    receivedAt: NOW - 1000, payload: { state: 'done', subagents: [sub('a1', 'working', { startedAt: NOW - 90_000 })] }, ...overrides
  });
  // Main agent finished its turn (Stop) or only subagent events arrive since: subagents.
  assert.equal(deriveStatus(term(), withSub(), NOW, 1), 'subagents');
  assert.equal(deriveStatus(term(), withSub({ hookEventName: 'PreToolUse', toolAgentId: 'a1', payload: { state: 'working' } }), NOW, 1), 'subagents');
  // Main agent's own mid-turn event, or a busy title: working.
  assert.equal(deriveStatus(term(), withSub({ hookEventName: 'PostToolUse', payload: { state: 'working' } }), NOW, 1), 'working');
  assert.equal(deriveStatus(term({ title: '◐ Busy' }), withSub(), NOW, 1), 'working');
  // Needing the user still wins.
  assert.equal(deriveStatus(term(), hook('permission'), NOW, 1), 'waiting');

  const [agent] = buildAgents([term()], { 'tab:leaf': withSub() }, NOW, { a1: { description: 'Write tests' } });
  assert.equal(agent.status, 'subagents');
  assert.equal(agent.since, NOW - 90_000);
  assert.deepEqual(agent.subagents.map((s) => s.description), ['Write tests']);
  assert.deepEqual(buildAgents([term()], {}, NOW)[0].subagents, []);

  // Sorts with working agents (oldest first) and counts as WORKING on the summary key.
  const agents = buildAgents(
    [term({ handle: 'done', tabId: 'a' }), term({ handle: 'subs', tabId: 'b' }), term({ handle: 'work', tabId: 'c' })],
    { 'a:leaf': hook('done'), 'b:leaf': withSub(), 'c:leaf': hook('working', { stateStartedAt: NOW - 1000 }) },
    NOW
  );
  assert.deepEqual(agents.map((a) => a.handle), ['subs', 'work', 'done']);
  assert.match(decodeURIComponent(renderSummary(agents)), /WORKING<\/text>\s*<text[^>]*>2</);
  assert.match(decodeURIComponent(renderAgent(agents[0], NOW)), /SUBS ×1/);
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

test('flattenSlots puts each running subagent right after its parent', () => {
  const terminals = [
    term({ handle: 'solo', tabId: 'a' }),
    term({ handle: 'p2', tabId: 'b' }),
    term({ handle: 'p1', tabId: 'c' }),
    term({ handle: 'wait', tabId: 'd' })
  ];
  const withSubs = (subs, stateStartedAt) => hook('working', { receivedAt: NOW - 1000, stateStartedAt, payload: { state: 'working', subagents: subs } });
  const hooks = {
    'b:leaf': withSubs([sub('b-new', 'working', { startedAt: NOW - 5000 }), sub('b-old', 'blocked', { startedAt: NOW - 9000 })], NOW - 20_000),
    'c:leaf': withSubs([sub('c1')], NOW - 60_000),
    'd:leaf': hook('permission')
  };
  const slots = flattenSlots(buildAgents(terminals, hooks, NOW, { 'b-old': { description: 'Scan docs' } }));
  assert.deepEqual(slots.map((s) => (s.kind === 'agent' ? s.handle : `${s.handle}/${s.id}`)),
    ['wait', 'p1', 'p1/c1', 'p2', 'p2/b-old', 'p2/b-new', 'solo']);
  const oldSub = slots[4];
  assert.deepEqual([oldSub.index, oldSub.total, oldSub.status, oldSub.description, oldSub.parentProject],
    [1, 2, 'waiting', 'Scan docs', 'my-api']);
  assert.equal(slots[5].status, 'working');
});

test('a subagent slot disappears once Orca marks it idle', () => {
  const at = (state) => ({ 'tab:leaf': hook('done', { receivedAt: NOW - 1000, payload: { state: 'done', subagents: [sub('a1', state)] } }) });
  assert.deepEqual(flattenSlots(buildAgents([term()], at('working'), NOW)).map((s) => s.kind), ['agent', 'subagent']);
  const after = flattenSlots(buildAgents([term()], at('idle'), NOW));
  assert.deepEqual(after.map((s) => s.kind), ['agent']);
  assert.equal(after[0].status, 'done');
});

test('subagent key and parent badge render', () => {
  const agent = { agent: 'claude', project: 'my-api', task: 'Refactor login', status: 'working', since: NOW };
  assert.doesNotMatch(decodeURIComponent(renderAgent(agent, NOW)), /<path/);
  const parent = decodeURIComponent(renderAgent({ ...agent, subagents: [{ id: 'a1' }, { id: 'a2' }] }, NOW));
  assert.match(parent, />2<\/text>/);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}` }));
  assert.match(decodeURIComponent(renderAgent({ ...agent, subagents: many }, NOW)), />9\+<\/text>/);

  const slot = { kind: 'subagent', handle: 'term_1', parentProject: 'my-api', index: 2, total: 3,
    agentType: 'explore', description: 'Check <auth> flow in the api', status: 'working', since: NOW - 120_000 };
  const svg = decodeURIComponent(renderSubagent(slot, NOW));
  assert.match(svg, /SUB 2\/3/);
  assert.match(svg, /EXPLORE/);
  assert.match(svg, /Check &lt;auth&gt;/);
  assert.match(svg, />my-api</);
  assert.match(svg, />2m</);
  assert.match(svg, /stroke-dasharray/);
  assert.match(decodeURIComponent(renderSubagent({ ...slot, description: '', agentType: '' }, NOW)), />subagent</);
});
