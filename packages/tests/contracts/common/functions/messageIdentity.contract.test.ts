import {
  buildDeterministicMessageHash,
  buildMessageSendQueueKey,
  buildScheduleSendQueueKey,
  ensureMessageSendHash,
  resolveMessageSendQueueKey,
  resolveMessageSendIdentity,
  resolveMessageSendOperationId,
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

  it('uses the explicit action hash as operation id', () => {
    expect(
      resolveMessageSendOperationId({
        account: { id: 'acc' },
        chat_id: 'chat',
        message_id: 'message-1',
        hash: ' action-1 ',
      })
    ).toBe('action-1');
  });

  it('falls back to the raw message id when no action hash was provided', () => {
    expect(
      resolveMessageSendOperationId({
        account: { id: 'acc' },
        chat_id: 'chat',
        message_id: ' message-1 ',
      })
    ).toBe('message-1');
  });

  it('keeps the message id after a deterministic transport hash is added', () => {
    const payload = {
      account: { id: 'acc' },
      chat_id: 'chat',
      message_id: 'message-1',
      hash: buildDeterministicMessageHash('acc', 'chat', 'message-1'),
    };

    expect(resolveMessageSendOperationId(payload)).toBe('message-1');
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
