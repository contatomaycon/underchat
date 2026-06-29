import { describe, expect, it } from '@jest/globals';
import type { ListMessageResult, MessageContent } from '../types/chat';
import { pt } from '../locales/pt';
import {
  getSystemMessageText,
  isGhostEmptyTextMessage,
  isGhostPinMessage,
  shouldRenderChatMessage,
} from '../utils/chatSystemMessages';

function message(content: MessageContent): ListMessageResult {
  return {
    message_id: `message-${Math.random()}`,
    chat_id: 'chat-1',
    type_user: 'system',
    content,
    date: '2026-06-28T12:00:00.000Z',
  };
}

describe('chatSystemMessages', () => {
  it('renders pin and unpin system messages', () => {
    expect(
      getSystemMessageText(
        message({
          type: 'system',
          pin: { pin_action: 'PIN', pin_user_name: 'Maycon' },
        })
      )
    ).toBe('Maycon fixou uma mensagem');

    expect(
      getSystemMessageText(
        message({
          type: 'system',
          pin: { pin_action: 'UNPIN', pin_user_phone: '+5561999990000' },
        })
      )
    ).toBe('+5561999990000 desfixou uma mensagem');
  });

  it('filters invalid pin ghost messages', () => {
    const invalidPin = message({
      type: 'system',
      message: '',
      pin: { pin_action: 'UNKNOWN' },
    });

    expect(getSystemMessageText(invalidPin)).toBeNull();
    expect(isGhostPinMessage(invalidPin)).toBe(true);
    expect(shouldRenderChatMessage(invalidPin)).toBe(false);
  });

  it('renders ephemeral system messages with user, phone and fallback', () => {
    expect(
      getSystemMessageText(
        message({
          type: 'system',
          ephemeral: { enabled: true, user_name: 'Maycon' },
        })
      )
    ).toBe(
      `Maycon ativou as mensagens temporárias.\n${pt.message_ephemeral_activated_description}`
    );

    expect(
      getSystemMessageText(
        message({
          type: 'system',
          ephemeral: { enabled: false, user_phone: '+5561999990000' },
        })
      )
    ).toBe('+5561999990000 desativou as mensagens temporárias.');

    expect(
      getSystemMessageText(
        message({
          type: 'system',
          ephemeral: { enabled: false },
        })
      )
    ).toBe(pt.message_ephemeral_deactivated_default);
  });

  it('filters empty text ghosts but keeps renderable content', () => {
    const emptyText = message({
      type: 'text',
      message: '\u200B',
    });
    const linkPreview = message({
      type: 'text',
      message: '',
      link_preview: { 'matched-text': 'https://under.chat' },
    });

    expect(isGhostEmptyTextMessage(emptyText)).toBe(true);
    expect(shouldRenderChatMessage(emptyText)).toBe(false);
    expect(isGhostEmptyTextMessage(linkPreview)).toBe(false);
    expect(shouldRenderChatMessage(linkPreview)).toBe(true);
  });
});
