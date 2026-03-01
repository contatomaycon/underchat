import {
  canViewChat,
  hasContactsModuleAccess,
} from '../constants/chatAuthorization';
import type { ListChatsResult } from '../types/chat';

const baseChat: ListChatsResult = {
  chat_id: 'chat-1',
  account: { id: 'acc-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Canal 1' },
  sector: { id: 'sector-1', name: 'Setor 1' },
  user: { id: 'user-2', name: 'Outro atendente' },
  contact: null,
  photo: null,
  name: 'Contato 1',
  phone: '62999999999',
  status: 'in_chat',
  date: new Date().toISOString(),
  summary: {
    last_message: 'Oi',
    last_date: new Date().toISOString(),
    unread_count: 0,
  },
};

describe('chatAuthorization contacts module access', () => {
  it('returns true when user has chat access permission', () => {
    expect(hasContactsModuleAccess(['chat_access'])).toBe(true);
  });

  it('returns true when user has full access permission', () => {
    expect(hasContactsModuleAccess(['full_access'])).toBe(true);
  });

  it('returns false when user has no required permission', () => {
    expect(hasContactsModuleAccess(['contact_view'])).toBe(false);
  });
});

describe('chatAuthorization channel visibility rules', () => {
  it('blocks chat when worker channel is not in user channels', () => {
    const result = canViewChat(baseChat, {
      permissions: ['chat_group'],
      userId: 'user-1',
      userSectors: ['sector-1'],
      userChannels: [{ id: 'worker-2', name: 'Canal 2' }],
    });

    expect(result).toBe(false);
  });

  it('allows own chat in allowed channel without extra sector permission', () => {
    const result = canViewChat(
      {
        ...baseChat,
        user: { id: 'user-1', name: 'Eu' },
      },
      {
        permissions: ['chat_access'],
        userId: 'user-1',
        userSectors: [],
        userChannels: [{ id: 'worker-1', name: 'Canal 1' }],
      }
    );

    expect(result).toBe(true);
  });
});
