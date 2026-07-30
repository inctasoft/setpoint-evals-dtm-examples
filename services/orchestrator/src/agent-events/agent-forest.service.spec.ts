import { Logger } from '@nestjs/common';
import type { AgentEvent } from '@dtm/core';
import { EventsGateway } from '../websocket/events.gateway';
import { AgentForestService } from './agent-forest.service';
import { validateAgentEvent } from './agent-event.guards';

/**
 * Agent-event/1 server-plane evals — merge parity with reconstruct.py and the
 * fail-closed structural guards.
 *
 * A done-then-vanished reconcile is N/A server-side: this plane only reports
 * what it saw — it never synthesizes a `lost_connection` event for a node that
 * stopped emitting (SE-RECONCILE-NO-SYNTH). Server-side stickiness of a
 * previously-seen typed error_reason IS covered below.
 */

// Ascending ULIDs (Crockford base32) — lexicographic order IS mint order.
const ULID_1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ULID_3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const ULID_4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const eventsGateway = { broadcast: jest.fn() };

function makeService(): AgentForestService {
  return new AgentForestService(eventsGateway as unknown as EventsGateway);
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    schema: 'agent-event/1',
    event_id: ULID_1,
    ts: '2026-07-30T12:00:00Z',
    provider: 'claude',
    kind: 'subagent',
    lifecycle: 'spawn',
    agent_id: 'agent-1',
    parent_id: null,
    root_id: 'session-1',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('AgentForestService — agent-event/1 merge (reconstruct.py parity)', () => {
  it('parent_id takes the first NON-null value ever seen (done merged before a late-arriving spawn)', () => {
    const svc = makeService();
    // Arrival order is spawn-then-done, but (event_id, ts) sort puts the done
    // FIRST — the node materializes parentless, then the spawn supplies it.
    svc.ingest([
      makeEvent({ event_id: ULID_2, lifecycle: 'spawn', parent_id: 'parent-1' }),
      makeEvent({ event_id: ULID_1, lifecycle: 'done', parent_id: null }),
    ]);

    const forest = svc.snapshot('session-1');
    expect(forest).toBeDefined();
    expect(forest!.nodes).toHaveLength(1);
    expect(forest!.nodes[0].parent_id).toBe('parent-1');
  });

  it('lifecycle is last-writer in ULID mint order, not arrival order', () => {
    const svc = makeService();
    svc.ingest([
      makeEvent({ event_id: ULID_2, lifecycle: 'done' }),
      makeEvent({ event_id: ULID_1, lifecycle: 'spawn' }),
    ]);

    const node = svc.snapshot('session-1')!.nodes[0];
    expect(node.lifecycle).toBe('done');
    expect(node.event_count).toBe(2);
  });

  it('error_reason is sticky across a later non-error event', () => {
    const svc = makeService();
    svc.ingest([
      makeEvent({ event_id: ULID_1, lifecycle: 'spawn' }),
      makeEvent({ event_id: ULID_2, lifecycle: 'error', error_reason: 'timeout' }),
      makeEvent({ event_id: ULID_3, lifecycle: 'done' }),
    ]);

    const node = svc.snapshot('session-1')!.nodes[0];
    expect(node.lifecycle).toBe('done');
    expect(node.error_reason).toBe('timeout');
  });

  it('PROVIDER-DRIFT: a provider change for a known agent_id is warned + skipped + never counted', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = makeService();

    svc.ingest([
      makeEvent({ event_id: ULID_1, lifecycle: 'spawn', provider: 'claude' }),
      makeEvent({ event_id: ULID_2, lifecycle: 'active', provider: 'kimi' }),
    ]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PROVIDER-DRIFT'));

    // The drifted event was never merged: provider, lifecycle and count all
    // reflect only the first event.
    const node = svc.snapshot('session-1')!.nodes[0];
    expect(node.provider).toBe('claude');
    expect(node.lifecycle).toBe('spawn');
    expect(node.event_count).toBe(1);

    // ...and never went out on the wire as an agent_event.
    const agentEventBroadcasts = eventsGateway.broadcast.mock.calls.filter(
      ([e]) => e.type === 'agent_event',
    );
    expect(agentEventBroadcasts).toHaveLength(1);
    expect(agentEventBroadcasts[0][0].event.event_id).toBe(ULID_1);
  });

  it('snapshot: roots are the parent_id===null nodes; nodes carry first_ts/last_ts/event_count', () => {
    const svc = makeService();
    svc.ingest([
      makeEvent({ event_id: ULID_1, agent_id: 'root-agent', parent_id: null }),
      makeEvent({
        event_id: ULID_2,
        agent_id: 'child-agent',
        parent_id: 'root-agent',
        label: 'Explore: find the seam',
        ts: '2026-07-30T12:00:01Z',
      }),
      makeEvent({
        event_id: ULID_3,
        agent_id: 'child-agent',
        lifecycle: 'active',
        parent_id: 'root-agent',
        ts: '2026-07-30T12:00:02Z',
      }),
    ]);

    const forest = svc.snapshot('session-1');
    expect(forest).toBeDefined();
    expect(forest!.schema).toBe('agent-forest/1');
    expect(forest!.root_id).toBe('session-1');
    expect(forest!.roots).toEqual(['root-agent']);
    expect(forest!.nodes).toHaveLength(2);

    const root = forest!.nodes.find((n) => n.agent_id === 'root-agent')!;
    expect(root.parent_id).toBeNull();
    expect(root.event_count).toBe(1);

    const child = forest!.nodes.find((n) => n.agent_id === 'child-agent')!;
    expect(child.parent_id).toBe('root-agent');
    expect(child.lifecycle).toBe('active');
    expect(child.label).toBe('Explore: find the seam');
    expect(child.event_count).toBe(2);
    expect(child.first_ts).toBe('2026-07-30T12:00:01Z');
    expect(child.last_ts).toBe('2026-07-30T12:00:02Z');
  });

  it('broadcasts every accepted event plus one snapshot per touched root', () => {
    const svc = makeService();
    svc.ingest([
      makeEvent({ event_id: ULID_1, agent_id: 'agent-a', root_id: 'root-1' }),
      makeEvent({ event_id: ULID_2, agent_id: 'agent-b', root_id: 'root-2' }),
    ]);

    expect(eventsGateway.broadcast).toHaveBeenCalledTimes(4);
    const types = eventsGateway.broadcast.mock.calls.map(([e]) => e.type).sort();
    expect(types).toEqual(['agent_event', 'agent_event', 'agent_forest', 'agent_forest']);

    const agentEvent = eventsGateway.broadcast.mock.calls.find(
      ([e]) => e.type === 'agent_event',
    )![0];
    expect(agentEvent).toMatchObject({
      type: 'agent_event',
      event: { event_id: ULID_1, schema: 'agent-event/1' },
    });
    expect(typeof agentEvent.timestamp).toBe('string');

    const agentForest = eventsGateway.broadcast.mock.calls.find(
      ([e]) => e.type === 'agent_forest',
    )![0];
    expect(agentForest.forest.schema).toBe('agent-forest/1');
    expect(typeof agentForest.timestamp).toBe('string');
  });

  it('resyncForests re-broadcasts every forest (server-authoritative resync); no-op when empty', () => {
    const svc = makeService();

    svc.resyncForests();
    expect(eventsGateway.broadcast).not.toHaveBeenCalled();

    svc.ingest([makeEvent({ event_id: ULID_1 })]);
    eventsGateway.broadcast.mockClear();

    svc.resyncForests();
    expect(eventsGateway.broadcast).toHaveBeenCalledTimes(1);
    expect(eventsGateway.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_forest',
        forest: expect.objectContaining({ schema: 'agent-forest/1', root_id: 'session-1' }),
      }),
    );
  });

  it('snapshot returns undefined for an unknown root', () => {
    const svc = makeService();
    svc.ingest([makeEvent({ event_id: ULID_1 })]);
    expect(svc.snapshot('no-such-root')).toBeUndefined();
  });
});

describe('validateAgentEvent — fail-closed on structure, fail-open on taxonomy', () => {
  function validRaw(): Record<string, unknown> {
    return {
      schema: 'agent-event/1',
      event_id: ULID_4,
      ts: '2026-07-30T12:00:00Z',
      provider: 'claude',
      kind: 'subagent',
      lifecycle: 'spawn',
      agent_id: 'agent-1',
      parent_id: null,
      root_id: 'session-1',
      label: 'Explore: find the seam',
      attrs: { tool_use_id: 'toolu_01J', spawn_depth: 1 },
    };
  }

  it('accepts a fully-populated valid event', () => {
    const result = validateAgentEvent(validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.schema).toBe('agent-event/1');
      expect(result.event.parent_id).toBeNull();
      expect(result.event.attrs).toEqual({ tool_use_id: 'toolu_01J', spawn_depth: 1 });
    }
  });

  it('accepts unknown provider/kind strings (fail-open on taxonomy)', () => {
    const result = validateAgentEvent({ ...validRaw(), provider: 'mistral', kind: 'conjurer' });
    expect(result.ok).toBe(true);
  });

  it('accepts an error event carrying a typed error_reason', () => {
    const result = validateAgentEvent({
      ...validRaw(),
      lifecycle: 'error',
      error_reason: 'tool_denied',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.error_reason).toBe('tool_denied');
  });

  it('rejects a lifecycle outside the closed 5-value enum', () => {
    const result = validateAgentEvent({ ...validRaw(), lifecycle: 'running' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('lifecycle');
  });

  it('rejects lifecycle=error without error_reason', () => {
    const result = validateAgentEvent({ ...validRaw(), lifecycle: 'error' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('error_reason');
  });

  it('rejects error_reason on a non-error lifecycle (forbidden otherwise)', () => {
    const result = validateAgentEvent({
      ...validRaw(),
      lifecycle: 'done',
      error_reason: 'timeout',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('forbidden');
  });

  it('rejects an unknown top-level key (additionalProperties: false)', () => {
    const result = validateAgentEvent({ ...validRaw(), zeta: 'surprise' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('zeta');
  });

  it('rejects a bad ULID event_id (wrong length / wrong alphabet)', () => {
    for (const event_id of [
      '01ARZ3NDEKTSV4RRFFQ69G5FA', // 25 chars
      '01arz3ndektsv4rrffq69g5fav', // lowercase
      '01ARZ3NDEKTSV4RRFFQ69G5FAI', // 'I' is not Crockford base32
      12345,
    ]) {
      const result = validateAgentEvent({ ...validRaw(), event_id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('event_id');
    }
  });

  it('rejects a missing required field (root_id) and a wrong schema version', () => {
    const missingRoot = validRaw();
    delete missingRoot.root_id;
    expect(validateAgentEvent(missingRoot).ok).toBe(false);
    expect(validateAgentEvent({ ...validRaw(), schema: 'agent-event/2' }).ok).toBe(false);
  });
});
