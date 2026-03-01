import type { ListChatsResult } from '../types/chat';
import {
  hasChatAccessPermission,
  canUseUserAndSectorFilters,
  canViewChatbotTab,
  canPickQueueChat,
  canPreviewChatContent,
  canViewChat,
} from './chatAuthorization';

function buildChat(overrides: Partial<ListChatsResult> = {}): ListChatsResult {
  return {
    chat_id: 'chat-1',
    account: { id: 'acc-1', name: 'Account' },
    worker: { id: 'channel-1', name: 'Main Channel' },
    phone: '5511999999999',
    name: 'Contato',
    status: 'queue',
    date: new Date().toISOString(),
    ...overrides,
  };
}

describe('chatAuthorization', () => {
  it('grants chat access with chat_access and equivalent permissions', () => {
    expect(hasChatAccessPermission(['chat_access'])).toBe(true);
    expect(hasChatAccessPermission(['full_access'])).toBe(true);
    expect(hasChatAccessPermission(['full_access_group'])).toBe(true);
    expect(hasChatAccessPermission(['chat_group'])).toBe(true);
    expect(hasChatAccessPermission(['view_chatbot_messages'])).toBe(false);
  });

  it('detects permission for user/sector filters', () => {
    expect(canUseUserAndSectorFilters(['list_all_chats_in_sector'])).toBe(true);
    expect(
      canUseUserAndSectorFilters(['list_all_chats_without_sector_limit'])
    ).toBe(true);
    expect(canUseUserAndSectorFilters(['pick_queue_chat'])).toBe(false);
  });

  it('detects chatbot tab permission', () => {
    expect(canViewChatbotTab(['view_chatbot_messages'])).toBe(true);
    expect(canViewChatbotTab(['chat_group'])).toBe(true);
    expect(canViewChatbotTab(['pick_queue_chat'])).toBe(false);
  });

  it('detects pick queue chat permission', () => {
    expect(canPickQueueChat(['pick_queue_chat'])).toBe(true);
    expect(canPickQueueChat(['chat_group'])).toBe(true);
    expect(canPickQueueChat(['preview_chat'])).toBe(false);
  });

  it('detects preview chat permission', () => {
    expect(canPreviewChatContent(['preview_chat'])).toBe(true);
    expect(canPreviewChatContent(['chat_group'])).toBe(true);
    expect(canPreviewChatContent(['pick_queue_chat'])).toBe(false);
  });

  it('blocks chat when user channel list does not include chat channel', () => {
    const chat = buildChat({ worker: { id: 'channel-2', name: 'Other' } });

    const result = canViewChat(chat, {
      permissions: ['list_all_chats_without_sector_limit'],
      userId: 'u1',
      userSectors: [],
      userChannels: [{ id: 'channel-1', name: 'Main' }],
    });

    expect(result).toBe(false);
  });

  it('allows own in_chat even without broad permissions', () => {
    const chat = buildChat({
      status: 'in_chat',
      user: { id: 'u1', name: 'Current User' },
    });

    const result = canViewChat(chat, {
      permissions: [],
      userId: 'u1',
      userSectors: [],
      userChannels: [],
    });

    expect(result).toBe(true);
  });

  it('allows queue chat by sector when list_all_chats_in_sector is present', () => {
    const chat = buildChat({
      status: 'queue',
      sector: { id: 'sector-1', name: 'Support', color: '#000000' },
    });

    const result = canViewChat(chat, {
      permissions: ['list_all_chats_in_sector'],
      userId: 'u1',
      userSectors: ['sector-1'],
      userChannels: [],
    });

    expect(result).toBe(true);
  });

  it('blocks queue chat outside user sectors when no global permission exists', () => {
    const chat = buildChat({
      status: 'queue',
      sector: { id: 'sector-2', name: 'Sales', color: '#000000' },
    });

    const result = canViewChat(chat, {
      permissions: ['list_all_chats_in_sector'],
      userId: 'u1',
      userSectors: ['sector-1'],
      userChannels: [],
    });

    expect(result).toBe(false);
  });

  it('allows chatbot status chat for own chat even without preview permissions', () => {
    const chat = buildChat({
      status: 'ura',
      user: { id: 'u1', name: 'Current User' },
    });

    const result = canViewChat(chat, {
      permissions: [],
      userId: 'u1',
      userSectors: [],
      userChannels: [],
    });

    expect(result).toBe(true);
  });
});
