import {
  buildMessageStatusEventId,
  ensureMessageStatusEventId,
} from '@core/common/functions/messageStatusIdentity';
import type { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';

function status(
  overrides: Partial<IMessageStatusUpdate> = {}
): IMessageStatusUpdate {
  return {
    account_id: 'account-1',
    worker_id: 'worker-1',
    message_id: 'physical-message-1',
    patch: { is_seen: true },
    ...overrides,
  };
}

describe('message status identity', () => {
  it('does not include provider, runtime generation, or connection epoch', () => {
    const baileys = status({
      source_provider: 'baileys',
      runtime_generation: 1,
      connection_epoch: 'baileys-epoch',
    });
    const wwebjs = status({
      source_provider: 'wwebjs',
      runtime_generation: 2,
      connection_epoch: 'wwebjs-epoch',
    });

    expect(ensureMessageStatusEventId(baileys)).toBe(
      ensureMessageStatusEventId(wwebjs)
    );
    expect(baileys.event_id).toBe(wwebjs.event_id);
  });

  it('keeps distinct physical messages and status revisions distinct', () => {
    const seen = buildMessageStatusEventId(status());
    const delivered = buildMessageStatusEventId(
      status({ patch: { is_delivered: true } })
    );
    const anotherMessage = buildMessageStatusEventId(
      status({ message_id: 'physical-message-2' })
    );

    expect(seen).not.toBe(delivered);
    expect(seen).not.toBe(anotherMessage);
  });

  it('converges a WWebJS serialized id with the raw socket stanza id', () => {
    const raw = status({ message_id: 'physical-message-1' });
    const serialized = status({
      message_id: 'true_5511999999999@s.whatsapp.net_physical-message-1',
    });

    expect(buildMessageStatusEventId(serialized)).toBe(
      buildMessageStatusEventId(raw)
    );
  });

  it('preserves an explicit operational event id', () => {
    const input = status({ event_id: 'operation-status-1' });

    expect(ensureMessageStatusEventId(input)).toBe('operation-status-1');
    expect(input.event_id).toBe('operation-status-1');
  });
});
