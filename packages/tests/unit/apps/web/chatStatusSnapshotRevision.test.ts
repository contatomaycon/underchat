import {
  compareChatStatusRevisions,
  hasDifferentIncomingStatusRevision,
  mergeChatStatusMetadata,
  selectNewestChatStatusSnapshot,
} from '@core/common/functions/chatStatusSnapshotRevision';

describe('compareChatStatusRevisions', () => {
  it('accepts a newer revision even when the status rank goes backwards', () => {
    const result = compareChatStatusRevisions(
      {
        status: 'in_chat',
        meta: { status_epoch: 10, status_event_id: 'event-10' },
      },
      {
        status: 'ura_output',
        meta: { status_epoch: 11, status_event_id: 'event-11' },
      }
    );

    expect(result).toBeGreaterThan(0);
  });

  it('rejects an older status revision', () => {
    const result = compareChatStatusRevisions(
      {
        status: 'closed',
        meta: { status_epoch: 20, status_event_id: 'event-20' },
      },
      {
        status: 'in_chat',
        meta: { status_epoch: 19, status_event_id: 'event-19' },
      }
    );

    expect(result).toBeLessThan(0);
  });

  it('uses the event id as a deterministic tie breaker', () => {
    const existing = {
      status: 'queue',
      meta: { status_epoch: 30, status_event_id: 'event-b' },
    };

    expect(
      compareChatStatusRevisions(existing, {
        status: 'in_chat',
        meta: { status_epoch: 30, status_event_id: 'event-c' },
      })
    ).toBeGreaterThan(0);
    expect(
      compareChatStatusRevisions(existing, {
        status: 'in_chat',
        meta: { status_epoch: 30, status_event_id: 'event-a' },
      })
    ).toBeLessThan(0);
  });

  it('prefers revised snapshots over legacy snapshots during rollout', () => {
    expect(
      compareChatStatusRevisions(
        {
          status: 'queue',
          meta: { status_epoch: 40, status_event_id: 'event-40' },
        },
        { status: 'in_chat' }
      )
    ).toBeLessThan(0);

    expect(
      compareChatStatusRevisions(
        { status: 'in_chat' },
        {
          status: 'ura_output',
          meta: { status_epoch: 41, status_event_id: 'event-41' },
        }
      )
    ).toBeGreaterThan(0);

    expect(
      compareChatStatusRevisions(
        {
          status: 'queue',
          meta: { status_epoch: 40, status_event_id: 'event-40' },
        },
        {
          status: 'in_chat',
          meta: { status_epoch: 40 },
        }
      )
    ).toBeLessThan(0);
  });

  it('rejects a changed status carried with the same revision snapshot', () => {
    expect(
      compareChatStatusRevisions(
        {
          status: 'in_chat',
          meta: { status_epoch: 50, status_event_id: 'event-50' },
        },
        {
          status: 'ura_output',
          meta: { status_epoch: 50, status_event_id: 'event-50' },
        }
      )
    ).toBe(0);
  });

  it('does not order snapshots when the status is unchanged', () => {
    expect(
      compareChatStatusRevisions(
        {
          status: 'in_chat',
          meta: { status_epoch: 50, status_event_id: 'event-new' },
        },
        {
          status: 'in_chat',
          meta: { status_epoch: 49, status_event_id: 'event-old' },
        }
      )
    ).toBeNull();
  });

  it('keeps the newest revision while merging a same-status update', () => {
    expect(
      mergeChatStatusMetadata(
        {
          status_epoch: 100,
          status_event_id: 'event-100',
          status_source: 'chatbot',
          assignment_epoch: 1,
        },
        {
          status_epoch: 90,
          status_event_id: 'event-90',
          status_source: 'chat_service',
          assignment_epoch: 2,
        }
      )
    ).toEqual(
      expect.objectContaining({
        status_epoch: 100,
        status_event_id: 'event-100',
        status_source: 'chatbot',
        assignment_epoch: 2,
      })
    );
  });
});

describe('selectNewestChatStatusSnapshot', () => {
  it('keeps a newer human status when an older automation snapshot arrives last', () => {
    const humanSnapshot = {
      status: 'in_chat',
      meta: { status_epoch: 200, status_event_id: 'human-200' },
    };
    const staleAutomationSnapshot = {
      status: 'ura_output',
      meta: { status_epoch: 100, status_event_id: 'automation-100' },
    };

    expect(
      selectNewestChatStatusSnapshot(humanSnapshot, staleAutomationSnapshot)
    ).toBe(humanSnapshot);
  });

  it('selects newer same-status metadata regardless of arrival order', () => {
    const olderSnapshot = {
      status: 'queue',
      meta: { status_epoch: 300, status_event_id: 'queue-300' },
    };
    const newerSnapshot = {
      status: 'queue',
      meta: { status_epoch: 301, status_event_id: 'queue-301' },
    };

    expect(selectNewestChatStatusSnapshot(olderSnapshot, newerSnapshot)).toBe(
      newerSnapshot
    );
    expect(selectNewestChatStatusSnapshot(newerSnapshot, olderSnapshot)).toBe(
      newerSnapshot
    );
  });

  it('uses last arrival for legacy snapshots and valid same-revision updates', () => {
    const legacyFirst = { status: 'queue', value: 'first' };
    const legacyLast = { status: 'in_chat', value: 'last' };
    const sameRevisionFirst = {
      status: 'queue',
      value: 'first',
      meta: { status_epoch: 400, status_event_id: 'queue-400' },
    };
    const sameRevisionLast = {
      status: 'queue',
      value: 'last',
      meta: { status_epoch: 400, status_event_id: 'queue-400' },
    };

    expect(selectNewestChatStatusSnapshot(legacyFirst, legacyLast)).toBe(
      legacyLast
    );
    expect(
      selectNewestChatStatusSnapshot(sameRevisionFirst, sameRevisionLast)
    ).toBe(sameRevisionLast);
  });
});

describe('hasDifferentIncomingStatusRevision', () => {
  const activeSnapshot = {
    status: 'queue',
    meta: { status_epoch: 500, status_event_id: 'queue-500' },
  };

  it('detects newer and older same-status revisions', () => {
    expect(
      hasDifferentIncomingStatusRevision(activeSnapshot, {
        status: 'queue',
        meta: { status_epoch: 501, status_event_id: 'queue-501' },
      })
    ).toBe(true);
    expect(
      hasDifferentIncomingStatusRevision(activeSnapshot, {
        status: 'queue',
        meta: { status_epoch: 499, status_event_id: 'queue-499' },
      })
    ).toBe(true);
  });

  it('keeps the summary fast path for the same or a legacy revision', () => {
    expect(
      hasDifferentIncomingStatusRevision(activeSnapshot, {
        status: 'queue',
        meta: { status_epoch: 500, status_event_id: 'queue-500' },
      })
    ).toBe(false);
    expect(
      hasDifferentIncomingStatusRevision(activeSnapshot, { status: 'queue' })
    ).toBe(false);
  });
});
