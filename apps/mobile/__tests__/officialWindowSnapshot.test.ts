import { describe, expect, it } from '@jest/globals';
import type { ListChatsResult, OfficialWindow } from '../types/chat';
import { mergeChatOfficialWindowSnapshot } from '../utils/officialWindowSnapshot';

const createChat = (
  chatId: string,
  officialWindow: OfficialWindow | null
): ListChatsResult =>
  ({
    chat_id: chatId,
    account: { id: 'account-1', name: 'Conta' },
    worker: { id: 'worker-1', name: 'Canal', is_official: true },
    name: 'Contato',
    phone: '5511999999999',
    status: 'in_chat',
    date: '2026-07-21T13:18:16.517Z',
    official_window: officialWindow,
  }) as ListChatsResult;

const awaitingWindow: OfficialWindow = {
  is_official: true,
  state: 'awaiting_contact_reply',
  reason: 'customer_reply_required',
  can_send_freeform: false,
  can_send_template: false,
};

const openWindow: OfficialWindow = {
  is_official: true,
  state: 'open',
  reason: 'customer_service_window_open',
  can_send_freeform: true,
  can_send_template: true,
  last_inbound_at: '2026-07-21T13:18:16.517Z',
};

describe('official window message snapshot', () => {
  it('unlocks the requested chat when the message response reports an open window', () => {
    const current = createChat('chat-1', awaitingWindow);

    const updated = mergeChatOfficialWindowSnapshot(current, 'chat-1', {
      official_window: openWindow,
    });

    expect(updated).not.toBe(current);
    expect(updated.official_window).toBe(openWindow);
  });

  it('does not apply a late response from another chat', () => {
    const current = createChat('chat-2', awaitingWindow);

    const updated = mergeChatOfficialWindowSnapshot(current, 'chat-1', {
      official_window: openWindow,
    });

    expect(updated).toBe(current);
    expect(updated.official_window).toBe(awaitingWindow);
  });

  it('preserves the current value when an older API omits the snapshot', () => {
    const current = createChat('chat-1', awaitingWindow);

    expect(mergeChatOfficialWindowSnapshot(current, 'chat-1', {})).toBe(
      current
    );
  });

  it('honors an explicit null snapshot', () => {
    const current = createChat('chat-1', awaitingWindow);

    const updated = mergeChatOfficialWindowSnapshot(current, 'chat-1', {
      official_window: null,
    });

    expect(updated.official_window).toBeNull();
  });

  it('keeps a newer realtime window when an older API snapshot arrives later', () => {
    const currentWindow: OfficialWindow = {
      ...openWindow,
      updated_at: '2026-07-21T13:20:00.000Z',
    };
    const staleWindow: OfficialWindow = {
      ...awaitingWindow,
      updated_at: '2026-07-21T13:19:00.000Z',
    };

    const current = createChat('chat-1', currentWindow);
    const updated = mergeChatOfficialWindowSnapshot(current, 'chat-1', {
      official_window: staleWindow,
    });

    expect(updated).toBe(current);
    expect(updated.official_window).toBe(currentWindow);
  });

  it('applies a newer uncertain provider outcome without treating it as open', () => {
    const uncertainWindow: OfficialWindow = {
      is_official: true,
      state: 'send_uncertain',
      reason: 'template_send_uncertain',
      can_send_freeform: false,
      can_send_template: false,
      updated_at: '2026-07-21T13:21:00.000Z',
    };
    const current = createChat('chat-1', {
      ...awaitingWindow,
      updated_at: '2026-07-21T13:20:00.000Z',
    });

    const updated = mergeChatOfficialWindowSnapshot(current, 'chat-1', {
      official_window: uncertainWindow,
    });

    expect(updated.official_window).toBe(uncertainWindow);
    expect(updated.official_window?.can_send_template).toBe(false);
  });
});
