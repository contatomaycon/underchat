import { describe, expect, it } from '@jest/globals';
import {
  resolveInternalChatMessagePreview,
  resolveInternalChatMessageText,
  resolveInternalChatSenderName,
  resolveInternalChatTextTag,
} from '../utils/internalChatText';
import type { InternalChatMessage } from '../types/internalChat';

function buildMessage(
  overrides: Partial<InternalChatMessage> = {}
): InternalChatMessage {
  return {
    message_id: 'message-1',
    conversation_id: 'conversation-1',
    account_id: 'account-1',
    type_user: 'operator',
    user: {
      id: 'user-1',
      name: 'Ana',
      photo: null,
    },
    content: {
      type: 'text',
      message: 'Olá',
    },
    date: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('internalChatText', () => {
  it('translates preview and system tags', () => {
    expect(resolveInternalChatTextTag('internal_chat_preview_audio')).toBe(
      '[Áudio]'
    );
    expect(
      resolveInternalChatTextTag('internal_chat_system_group_member_added', {
        actor: 'Carlos',
        target: 'Maria',
      })
    ).toBe('Carlos adicionou Maria');
  });

  it('renders system group messages with params', () => {
    const message = buildMessage({
      type_user: 'system',
      user: null,
      content: {
        type: 'system',
        message: 'internal_chat_system_group_created',
        system: {
          key: 'internal_chat_system_group_created',
          params: {
            actor: 'Carlos',
          },
        },
      } as InternalChatMessage['content'],
    });

    expect(resolveInternalChatSenderName(message)).toBe('Sistema');
    expect(resolveInternalChatMessageText(message)).toBe(
      'Carlos criou o grupo'
    );
    expect(resolveInternalChatMessagePreview(message)).toBe(
      'Atualização do grupo'
    );
  });

  it('keeps normal text untouched', () => {
    const message = buildMessage({
      content: {
        type: 'text',
        message: 'Mensagem normal',
      },
    });

    expect(resolveInternalChatMessageText(message)).toBe('Mensagem normal');
  });
});
