import {
  filterMessagesForChat,
  filterMessagesForChatAndAccount,
  messageBelongsToChat,
  messageBelongsToChatAndAccount,
} from '@core/common/functions/chatMessageOwnership';

describe('chatMessageOwnership', () => {
  it('checks whether a message belongs to a chat', () => {
    expect(messageBelongsToChat({ chat_id: 'chat-1' }, 'chat-1')).toBe(true);
    expect(messageBelongsToChat({ chat_id: 'chat-2' }, 'chat-1')).toBe(false);
    expect(messageBelongsToChat({ chat_id: '  ' }, 'chat-1')).toBe(false);
    expect(messageBelongsToChat(null, 'chat-1')).toBe(false);
  });

  it('filters messages by chat id', () => {
    const messages = [
      { message_id: 'message-1', chat_id: 'chat-1' },
      { message_id: 'message-2', chat_id: 'chat-2' },
      { message_id: 'message-3', chat_id: 'chat-1' },
    ];

    expect(filterMessagesForChat(messages, 'chat-1')).toEqual([
      messages[0],
      messages[2],
    ]);
  });

  it('checks chat and account ownership together', () => {
    expect(
      messageBelongsToChatAndAccount(
        { chat_id: 'chat-1', account: { id: 'account-1' } },
        'chat-1',
        'account-1'
      )
    ).toBe(true);
    expect(
      messageBelongsToChatAndAccount(
        { chat_id: 'chat-1', account: { id: 'account-2' } },
        'chat-1',
        'account-1'
      )
    ).toBe(false);
    expect(
      messageBelongsToChatAndAccount(
        { chat_id: 'chat-1' },
        'chat-1',
        'account-1'
      )
    ).toBe(false);
  });

  it('filters messages by chat and account id', () => {
    const messages = [
      {
        message_id: 'message-1',
        chat_id: 'chat-1',
        account: { id: 'account-1' },
      },
      {
        message_id: 'message-2',
        chat_id: 'chat-1',
        account: { id: 'account-2' },
      },
      {
        message_id: 'message-3',
        chat_id: 'chat-2',
        account: { id: 'account-1' },
      },
    ];

    expect(
      filterMessagesForChatAndAccount(messages, 'chat-1', 'account-1')
    ).toEqual([messages[0]]);
  });
});
