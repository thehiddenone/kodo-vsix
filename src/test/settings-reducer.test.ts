import * as assert from 'assert';

import { reducer, initial } from '../settings-webview/reducer';
import type { AgentInstallResult, AgentScanResult, AgentsState } from '../settings-webview/types';

// The Kōdo Settings panel is seeded and refreshed through one merge-patch
// reducer; a field the reducer does not copy is silently stuck at its initial
// value, which is how the Agents section came to show "No agents installed"
// over a server that was listing them.
suite('settings reducer — agents', () => {
  const agents: AgentsState = {
    root: '/home/u/.kodo/agents',
    agents: [{
      name: 'researcher', kind: 'agent', version: '0.1.0', label: 'Researcher',
      description: 'Read-only research.', path: '/home/u/.kodo/agents/researcher', error: '',
    }],
  };

  test('a patch carrying the agent listing reaches the state', () => {
    const next = reducer(initial, { type: 'patch', data: { agents } });
    assert.deepStrictEqual(next.agents, agents);
  });

  test('a patch without the listing keeps the previous one', () => {
    const seeded = reducer(initial, { type: 'patch', data: { agents } });
    const next = reducer(seeded, { type: 'patch', data: { rules: [] } });
    assert.deepStrictEqual(next.agents, agents);
  });

  test('scan and install results reach the state, and null clears them', () => {
    const scan: AgentScanResult = {
      source: '/src', ok: true, candidates: [], conflicts: '', error: '',
    };
    const install: AgentInstallResult = {
      source: '/src', ok: true, installed: ['researcher'], kept: [], skipped: [], missing: [], error: '',
    };
    const filled = reducer(initial, { type: 'patch', data: { agentScan: scan, agentInstall: install } });
    assert.deepStrictEqual(filled.agentScan, scan);
    assert.deepStrictEqual(filled.agentInstall, install);

    const cleared = reducer(filled, { type: 'patch', data: { agentScan: null, agentInstall: null } });
    assert.strictEqual(cleared.agentScan, null);
    assert.strictEqual(cleared.agentInstall, null);
  });
});
