import { selectNewestChatSnapshotRevision } from '@core/common/functions/chatSnapshotRevision';

const windowSnapshot = (
  state: 'open' | 'awaiting_contact_reply' | 'closed',
  updatedAt: string
) => ({
  is_official: true as const,
  state,
  reason:
    state === 'open'
      ? ('customer_service_window_open' as const)
      : ('customer_reply_required' as const),
  can_send_freeform: state === 'open',
  can_send_template: state !== 'awaiting_contact_reply',
  updated_at: updatedAt,
});

describe('selectNewestChatSnapshotRevision', () => {
  it('keeps the newest official window when the incoming event has a newer status', () => {
    const newestWindow = windowSnapshot('open', '2026-08-17T12:02:00.000Z');
    const olderWindow = windowSnapshot(
      'awaiting_contact_reply',
      '2026-08-17T12:01:00.000Z'
    );

    const result = selectNewestChatSnapshotRevision(
      {
        status: 'queue',
        meta: { status_epoch: 10, status_event_id: 'status-10' },
        official_window: newestWindow,
      },
      {
        status: 'in_chat',
        meta: { status_epoch: 11, status_event_id: 'status-11' },
        official_window: olderWindow,
      }
    );

    expect(result.status).toBe('in_chat');
    expect(result.meta?.status_epoch).toBe(11);
    expect(result.official_window).toBe(newestWindow);
  });

  it('applies a newer official window even when it arrives on an older status event', () => {
    const olderWindow = windowSnapshot(
      'awaiting_contact_reply',
      '2026-08-17T12:01:00.000Z'
    );
    const newestWindow = windowSnapshot('open', '2026-08-17T12:02:00.000Z');

    const result = selectNewestChatSnapshotRevision(
      {
        status: 'in_chat',
        meta: { status_epoch: 11, status_event_id: 'status-11' },
        official_window: olderWindow,
      },
      {
        status: 'queue',
        meta: { status_epoch: 10, status_event_id: 'status-10' },
        official_window: newestWindow,
      }
    );

    expect(result.status).toBe('in_chat');
    expect(result.meta?.status_epoch).toBe(11);
    expect(result.official_window).toBe(newestWindow);
  });
});
