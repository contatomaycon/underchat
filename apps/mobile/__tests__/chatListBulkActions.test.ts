import { describe, expect, it } from '@jest/globals';

import {
  buildBulkSelectionPayload,
  isBulkSelectableChat,
  resolveBulkCategory,
  resolveBulkTargetCount,
} from '../utils/chatListBulkActions';
import type { ListChatsResult } from '../types/chat';

function makeChat(
  overrides: Partial<ListChatsResult> & Pick<ListChatsResult, 'chat_id'>
): ListChatsResult {
  return {
    account: { id: 'account-1', name: 'Conta' },
    worker: { id: 'worker-1', name: 'Canal' },
    sector: null,
    user: null,
    secondary_users: null,
    contact: null,
    photo: null,
    name: null,
    phone: '5511999999999',
    status: 'queue',
    date: '2026-01-01T00:00:00.000Z',
    ...overrides,
    chat_id: overrides.chat_id,
  };
}

describe('chatListBulkActions', () => {
  it('maps mobile tabs to backend bulk categories', () => {
    expect(resolveBulkCategory('in_chat')).toBe('in_chat');
    expect(resolveBulkCategory('queue')).toBe('queue');
    expect(resolveBulkCategory('all')).toBe('my_chats');
    expect(resolveBulkCategory('chatbot', 'ura')).toBe('chatbot');
    expect(resolveBulkCategory('chatbot', 'ura_schedule')).toBe('scheduled');
    expect(resolveBulkCategory('closed')).toBeNull();
  });

  it('checks whether visible chats are selectable for each category', () => {
    const inChat = makeChat({ chat_id: 'chat-1', status: 'in_chat' });
    const queue = makeChat({ chat_id: 'chat-2', status: 'queue' });
    const myPrimary = makeChat({
      chat_id: 'chat-3',
      status: 'in_chat',
      user: { id: 'user-1', name: 'Maycon' },
    });
    const mySecondary = makeChat({
      chat_id: 'chat-4',
      status: 'queue',
      secondary_users: [{ id: 'user-1', name: 'Maycon' }],
    });
    const chatbot = makeChat({ chat_id: 'chat-5', status: 'ura_output' });
    const scheduled = makeChat({ chat_id: 'chat-6', status: 'ura_schedule' });

    expect(isBulkSelectableChat(inChat, 'in_chat', 'user-1')).toBe(true);
    expect(isBulkSelectableChat(queue, 'in_chat', 'user-1')).toBe(false);
    expect(isBulkSelectableChat(queue, 'queue', 'user-1')).toBe(true);
    expect(isBulkSelectableChat(myPrimary, 'my_chats', 'user-1')).toBe(true);
    expect(isBulkSelectableChat(mySecondary, 'my_chats', 'user-1')).toBe(true);
    expect(isBulkSelectableChat(queue, 'my_chats', 'user-1')).toBe(false);
    expect(isBulkSelectableChat(chatbot, 'chatbot', 'user-1')).toBe(true);
    expect(isBulkSelectableChat(scheduled, 'chatbot', 'user-1')).toBe(false);
    expect(isBulkSelectableChat(scheduled, 'scheduled', 'user-1')).toBe(true);
  });

  it('builds selected or filtered selection payloads', () => {
    expect(
      buildBulkSelectionPayload({
        selectAllFiltered: false,
        selectedChatIds: [' chat-1 ', 'chat-1', '', 'chat-2'],
        category: 'queue',
      })
    ).toEqual({
      selection_mode: 'selected',
      chat_ids: ['chat-1', 'chat-2'],
    });

    expect(
      buildBulkSelectionPayload({
        selectAllFiltered: true,
        selectedChatIds: ['chat-1'],
        category: 'chatbot',
      })
    ).toEqual({
      selection_mode: 'filtered',
      category: 'chatbot',
    });
  });

  it('resolves target counts from selected count or filtered counters', () => {
    const counts = {
      total: 100,
      queue: 8,
      in_chat: 12,
      chatbot: 5,
      schedule: 2,
      my_chats: 3,
      in_chat_mine: 4,
      chatbot_schedule: 7,
    };

    expect(
      resolveBulkTargetCount({
        category: 'queue',
        selectAllFiltered: false,
        selectedCount: 2,
        counts,
        visibleSelectableCount: 8,
      })
    ).toBe(2);
    expect(
      resolveBulkTargetCount({
        category: 'in_chat',
        selectAllFiltered: true,
        selectedCount: 0,
        counts,
        visibleSelectableCount: 12,
        inChatScope: 'all',
      })
    ).toBe(12);
    expect(
      resolveBulkTargetCount({
        category: 'in_chat',
        selectAllFiltered: true,
        selectedCount: 0,
        counts,
        visibleSelectableCount: 4,
        inChatScope: 'mine',
      })
    ).toBe(4);
    expect(
      resolveBulkTargetCount({
        category: 'scheduled',
        selectAllFiltered: true,
        selectedCount: 0,
        counts,
        visibleSelectableCount: 2,
      })
    ).toBe(7);
  });
});
