import { buildMessageUpdateEventId } from '@core/common/functions/messageUpdateIdentity';
import type { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';

function makeUpdate(providerMessageId: string): IUpdateMessage {
  return {
    worker_id: 'worker-1',
    message: {
      key: {
        id: providerMessageId,
        fromMe: true,
      },
    },
    data: {
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      chat_id: 'chat-1',
      message_id: 'internal-message-1',
    } as IUpdateMessage['data'],
  };
}

describe('messageUpdateIdentity', () => {
  it('converges provider serialization of the same physical stanza', () => {
    expect(
      buildMessageUpdateEventId(
        makeUpdate('true_5511999999999@s.whatsapp.net_PROVIDER-STANZA-1')
      )
    ).toBe(buildMessageUpdateEventId(makeUpdate('PROVIDER-STANZA-1')));
  });

  it('keeps distinct provider stanza ids as distinct operations', () => {
    expect(buildMessageUpdateEventId(makeUpdate('PROVIDER-STANZA-1'))).not.toBe(
      buildMessageUpdateEventId(makeUpdate('PROVIDER-STANZA-2'))
    );
  });
});
