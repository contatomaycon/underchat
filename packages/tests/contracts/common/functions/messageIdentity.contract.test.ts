import {
  buildDeterministicMessageHash,
  buildMessageSendQueueKey,
  buildScheduleSendQueueKey,
  ensureMessageSendHash,
  resolveMessageSendQueueKey,
  resolveMessageSendIdentity,
} from '@core/common/functions/messageIdentity';

describe('messageIdentity', () => {
  it('buildDeterministicMessageHash is stable for same inputs', () => {
    const hashA = buildDeterministicMessageHash('acc', 'chat', 'msg');
    const hashB = buildDeterministicMessageHash('acc', 'chat', 'msg');
    const hashC = buildDeterministicMessageHash('acc', 'chat', 'msg-2');

    expect(hashA).toHaveLength(64);
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });

  it('resolveMessageSendIdentity returns null for invalid payload', () => {
    expect(resolveMessageSendIdentity(null)).toBeNull();
    expect(resolveMessageSendIdentity({})).toBeNull();
    expect(
      resolveMessageSendIdentity({
        account: { id: 'acc' },
        chat_id: 'chat',
      })
    ).toBeNull();
  });

  it('uses provided hash when available', () => {
    expect(
      resolveMessageSendIdentity({
        account: { id: '  acc  ' },
        chat_id: ' chat ',
        message_id: ' msg ',
        hash: ' provided-hash ',
      })
    ).toEqual({
      accountId: 'acc',
      chatId: 'chat',
      messageId: 'msg',
      hash: 'provided-hash',
    });
  });

  it('computes hash when payload has no valid hash', () => {
    const identity = resolveMessageSendIdentity({
      account: { id: 'acc' },
      chat_id: 'chat',
      message_id: 'msg',
      hash: '   ',
    });

    expect(identity).toEqual(
      expect.objectContaining({
        accountId: 'acc',
        chatId: 'chat',
        messageId: 'msg',
      })
    );
    expect(identity?.hash).toHaveLength(64);
  });

  it('ensureMessageSendHash sets and returns hash when identity is valid', () => {
    const message: {
      account: { id: string };
      chat_id: string;
      message_id: string;
      hash?: string;
    } = {
      account: { id: 'acc' },
      chat_id: 'chat',
      message_id: 'msg',
      hash: undefined,
    };

    const hash = ensureMessageSendHash(message as never);

    expect(hash).toHaveLength(64);
    expect(message.hash).toBe(hash);
  });

  it('ensureMessageSendHash returns null when identity cannot be resolved', () => {
    const message = { chat_id: 'chat' } as never;
    expect(ensureMessageSendHash(message)).toBeNull();
  });

  it('builds queue keys used by Kafka producers and ordered consumers', () => {
    expect(buildMessageSendQueueKey(' acc ', ' chat ')).toBe('chat:acc:chat');
    expect(buildScheduleSendQueueKey(' acc ', ' worker ')).toBe(
      'account:acc:channel:worker'
    );
    expect(
      resolveMessageSendQueueKey({
        account: { id: 'acc' },
        chat_id: 'chat',
        message_id: 'msg',
      })
    ).toBe('chat:acc:chat');
  });
});
