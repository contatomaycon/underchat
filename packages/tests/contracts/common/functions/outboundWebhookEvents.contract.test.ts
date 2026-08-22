import {
  OUTBOUND_WEBHOOK_EVENT_CATALOG,
  OUTBOUND_WEBHOOK_EVENT_TYPES,
  resolveChatLifecycleEventTypes,
} from '@core/common/constants/outboundWebhookEvents';
import { EChatStatus } from '@core/common/enums/EChatStatus';

describe('outbound webhook event catalog contract', () => {
  it('keeps event type identifiers unique', () => {
    expect(new Set(OUTBOUND_WEBHOOK_EVENT_TYPES).size).toBe(
      OUTBOUND_WEBHOOK_EVENT_TYPES.length
    );
    expect(OUTBOUND_WEBHOOK_EVENT_CATALOG).toHaveLength(37);
    expect(OUTBOUND_WEBHOOK_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'message.annotation.created',
        'message.system.created',
        'message.delivery.queued',
      ])
    );
  });

  it.each([
    {
      scenario: 'creates a chat',
      input: {
        operation: 'created' as const,
        currentStatus: EChatStatus.queue,
      },
      expected: ['chat.created'],
    },
    {
      scenario: 'joins an active chat',
      input: {
        operation: 'joined' as const,
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.in_chat,
      },
      expected: ['chat.joined'],
    },
    {
      scenario: 'leaves an active chat',
      input: {
        operation: 'left' as const,
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.in_chat,
      },
      expected: ['chat.left'],
    },
    {
      scenario: 'transfers a chat',
      input: {
        operation: 'transferred' as const,
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.queue,
      },
      expected: ['chat.transferred'],
    },
    {
      scenario: 'closes a chat',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.closed,
      },
      expected: ['chat.closed'],
    },
    {
      scenario: 'reopens a closed chat',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.closed,
        currentStatus: EChatStatus.queue,
      },
      expected: ['chat.reopened'],
    },
    {
      scenario: 'queues a chat',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.queue,
      },
      expected: ['chat.queued'],
    },
    {
      scenario: 'attends a queued chat',
      input: {
        operation: 'attended' as const,
        previousStatus: EChatStatus.queue,
        currentStatus: EChatStatus.in_chat,
      },
      expected: ['chat.attended'],
    },
    {
      scenario: 'starts automation',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.queue,
        currentStatus: EChatStatus.ura,
      },
      expected: ['chat.automation.started'],
    },
    {
      scenario: 'finishes automation into the human queue',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.ura,
        currentStatus: EChatStatus.queue,
      },
      expected: ['chat.automation.finished', 'chat.queued'],
    },
    {
      scenario: 'falls back for a non-canonical status transition',
      input: {
        operation: 'status_changed' as const,
        previousStatus: EChatStatus.queue,
        currentStatus: EChatStatus.transmission,
      },
      expected: ['chat.status.changed'],
    },
  ])(
    '$scenario without duplicate or competing lifecycle events',
    ({ input, expected }) => {
      const resolved = resolveChatLifecycleEventTypes(input);

      expect(resolved).toEqual(expected);
      expect(new Set(resolved).size).toBe(resolved.length);

      const specificStatusEvents = resolved.filter((eventType) =>
        [
          'chat.closed',
          'chat.reopened',
          'chat.queued',
          'chat.attended',
        ].includes(eventType)
      );
      if (specificStatusEvents.length > 0) {
        expect(resolved).not.toContain('chat.status.changed');
      }
    }
  );

  it('does not emit an event when a status update is a no-op', () => {
    expect(
      resolveChatLifecycleEventTypes({
        operation: 'status_changed',
        previousStatus: EChatStatus.in_chat,
        currentStatus: EChatStatus.in_chat,
      })
    ).toEqual([]);
  });
});
