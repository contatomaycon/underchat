import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockApiPatch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPatchWithMessage =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPostWithMessage =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPost = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiDelete = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiGet = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../api/client', () => ({
  apiDelete: mockApiDelete,
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
  apiPatchWithMessage: mockApiPatchWithMessage,
  apiPatchFormWithMessage: jest.fn(),
  apiPost: mockApiPost,
  apiPostWithMessage: mockApiPostWithMessage,
  apiPostForm: jest.fn(),
  apiPostFormWithMessage: jest.fn(),
  apiPut: jest.fn(),
}));

import {
  listChats,
  listMessages,
  listPinnedChats,
  bulkActionChats,
  pinChat,
  sendOfficialTemplateToChat,
  startChatWithContact,
  startChatWithContactDetailed,
  transferChat,
  unpinChat,
  updateChatAttendanceInactivity,
  updateChatStatusDetailed,
  viewChatAttendanceInactivity,
  viewOfficialConversationContext,
  viewOfficialOpeningContext,
  reactToMessage,
  deleteMessage,
  editMessage,
  forwardMessage,
} from '../api/chatApi';
import type { OfficialTemplateMessageRequest } from '../types/chat';

describe('chatApi attendance lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the structured closure-comment reason', async () => {
    mockApiPatchWithMessage.mockResolvedValue({
      status: false,
      message: 'Informe o motivo do encerramento.',
      data: { reason: 'closure_comment_required' },
    });

    const result = await updateChatStatusDetailed('chat-1', 'closed');

    expect(result).toEqual({
      ok: false,
      message: 'Informe o motivo do encerramento.',
      data: null,
      reason: 'closure_comment_required',
    });
  });

  it('sends transfer auto-message option when provided', async () => {
    mockApiPostWithMessage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { chat_id: 'chat-1', status: true },
    });

    await transferChat('chat-1', {
      worker_id: 'worker-1',
      keep_in_chat: true,
      send_message_on_transfer: false,
    });

    expect(mockApiPostWithMessage).toHaveBeenCalledWith(
      '/chat/chat-1/transfer',
      {
        worker_id: 'worker-1',
        user_id: undefined,
        sector_id: undefined,
        chatbot_id: undefined,
        annotation: undefined,
        keep_in_chat: true,
        send_message_on_transfer: false,
      }
    );
  });

  it('sends chatbot_id when transferring to chatbot', async () => {
    mockApiPostWithMessage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { chat_id: 'chat-1', status: true },
    });

    await transferChat('chat-1', {
      worker_id: 'worker-1',
      chatbot_id: 'chatbot-1',
      keep_in_chat: false,
    });

    expect(mockApiPostWithMessage).toHaveBeenCalledWith(
      '/chat/chat-1/transfer',
      {
        worker_id: 'worker-1',
        user_id: undefined,
        sector_id: undefined,
        chatbot_id: 'chatbot-1',
        annotation: undefined,
        keep_in_chat: false,
      }
    );
  });

  it('posts bulk chat actions and returns the structured result', async () => {
    const payload = {
      action: 'transfer' as const,
      selection_mode: 'filtered' as const,
      category: 'queue' as const,
      search: 'maycon',
      transfer_payload: {
        worker_id: 'worker-1',
        user_id: 'user-1',
        keep_in_chat: true,
      },
    };
    const data = {
      total_targeted: 3,
      success_count: 2,
      failed_count: 1,
      failures: [{ chat_id: 'chat-3', message: 'erro' }],
    };
    mockApiPostWithMessage.mockResolvedValue({
      status: true,
      message: 'ok',
      data,
    });

    await expect(bulkActionChats(payload)).resolves.toEqual({
      ok: true,
      message: 'ok',
      data,
    });

    expect(mockApiPostWithMessage).toHaveBeenCalledWith(
      '/chat/bulk-action',
      payload
    );
  });

  it('lists pinned chats', async () => {
    const pinnedChats = [{ chat_id: 'chat-1', status: 'in_chat' }];
    mockApiGet.mockResolvedValue({ status: true, data: pinnedChats });

    await expect(listPinnedChats()).resolves.toBe(pinnedChats);

    expect(mockApiGet).toHaveBeenCalledWith('/chat/pinned');
  });

  it('pins and unpins chats', async () => {
    mockApiPost.mockResolvedValue({ status: true, data: null });
    mockApiDelete.mockResolvedValue({ status: true, data: null });

    await expect(pinChat('chat-1')).resolves.toBe(true);
    await expect(unpinChat('chat-1')).resolves.toBe(true);

    expect(mockApiPost).toHaveBeenCalledWith('/chat/pinned/chat-1', {});
    expect(mockApiDelete).toHaveBeenCalledWith('/chat/pinned/chat-1');
  });

  it('preserves chat remote JID fields when listing chats', async () => {
    mockApiGet.mockResolvedValue({
      data: {
        pagings: {
          current_page: 1,
          total_pages: 1,
          per_page: 25,
          count: 1,
          total: 1,
        },
        results: [
          {
            chat_id: 'chat-1',
            remote_jid: '158733669765176@lid',
            remote_jid_alt: '5511999999999@s.whatsapp.net',
            message_key: {
              remote_jid: '158733669765176@lid',
              remote_jid_alt: '5511999999999@s.whatsapp.net',
            },
            status: 'queue',
          },
        ],
      },
    });

    const result = await listChats({
      status: 'queue',
      current_page: 1,
      per_page: 25,
    });

    expect(result?.results[0]).toEqual(
      expect.objectContaining({
        remote_jid: '158733669765176@lid',
        remote_jid_alt: '5511999999999@s.whatsapp.net',
        message_key: {
          remote_jid: '158733669765176@lid',
          remote_jid_alt: '5511999999999@s.whatsapp.net',
        },
      })
    );
  });

  it('preserves the authoritative official window returned with messages', async () => {
    const officialWindow = {
      is_official: true as const,
      state: 'open' as const,
      reason: 'customer_service_window_open' as const,
      can_send_freeform: true,
      can_send_template: true,
      last_inbound_at: '2026-07-21T13:18:16.517Z',
      service_window_expires_at: '2026-07-22T13:18:16.517Z',
    };
    mockApiGet.mockResolvedValue({
      data: {
        pagings: {
          current_page: 1,
          total_pages: 1,
          per_page: 50,
          count: 1,
          total: 1,
        },
        results: [{ message_id: 'message-1', chat_id: 'chat-1' }],
        official_window: officialWindow,
      },
    });

    const result = await listMessages('chat-1');

    expect(result?.official_window).toEqual(officialWindow);
    expect(mockApiGet).toHaveBeenCalledWith('/chat/chat-1', {
      current_page: 1,
      per_page: 50,
    });
  });

  it('reads and updates attendance inactivity state', async () => {
    mockApiGet.mockResolvedValue({ status: true, data: { disabled: true } });
    mockApiPatch.mockResolvedValue({ status: true, data: { success: true } });

    await expect(viewChatAttendanceInactivity('chat-1')).resolves.toEqual({
      disabled: true,
    });
    await expect(updateChatAttendanceInactivity('chat-1', false)).resolves.toBe(
      true
    );

    expect(mockApiGet).toHaveBeenCalledWith(
      '/chat/chat-1/attendance-inactivity'
    );
    expect(mockApiPatch).toHaveBeenCalledWith(
      '/chat/chat-1/attendance-inactivity',
      { disabled: false }
    );
  });

  it('loads official contexts and sends official template payloads', async () => {
    const officialTemplate: OfficialTemplateMessageRequest = {
      name: 'informacao_importante',
      language: 'pt_BR',
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          button_index: null,
          value: 'Maycon',
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce({
      status: true,
      data: { worker_id: 'worker-1', templates: [] },
    });
    mockApiGet.mockResolvedValueOnce({
      status: true,
      data: { chat_id: 'chat-1', templates: [] },
    });
    mockApiPost.mockResolvedValue({
      status: true,
      data: { chat_id: 'chat-1' },
    });

    await viewOfficialOpeningContext('worker-1', 'contact-1');
    await viewOfficialConversationContext('chat-1');
    await startChatWithContact(
      'contact-1',
      'worker-1',
      'sector-1',
      officialTemplate
    );
    await sendOfficialTemplateToChat('chat-1', officialTemplate);

    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      '/chat/official-opening/context',
      {
        worker_id: 'worker-1',
        contact_id: 'contact-1',
      }
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      '/chat/chat-1/official-conversation/context'
    );
    expect(mockApiPost).toHaveBeenNthCalledWith(1, '/chat/start-with-contact', {
      contact_id: 'contact-1',
      worker_id: 'worker-1',
      sector_id: 'sector-1',
      official_template: officialTemplate,
    });
    expect(mockApiPost).toHaveBeenNthCalledWith(
      2,
      '/chat/chat-1/official-template',
      officialTemplate
    );
  });

  it('preserves the refresh reason when the official window expires', async () => {
    mockApiPostWithMessage.mockResolvedValue({
      status: false,
      message: 'A janela encerrou. Atualize o contexto.',
      data: { reason: 'official_window_requires_template_refresh' },
      requestId: 'request-409',
      httpStatus: 409,
    });

    const result = await startChatWithContactDetailed('contact-1', 'worker-1');

    expect(result).toEqual({
      status: false,
      chat: null,
      reason: 'official_window_requires_template_refresh',
      message: 'A janela encerrou. Atualize o contexto.',
      requestId: 'request-409',
      httpStatus: 409,
    });
  });

  it('reuses an awaiting official conversation without resending a template', async () => {
    const chat = {
      chat_id: 'chat-awaiting',
      official_window: {
        is_official: true,
        state: 'awaiting_contact_reply',
        reason: 'customer_reply_required',
        can_send_freeform: false,
        can_send_template: false,
        awaiting_contact_reply_since: '2026-07-21T12:00:00.000Z',
      },
    };
    mockApiPostWithMessage.mockResolvedValue({
      status: true,
      message: 'ok',
      data: chat,
      requestId: 'request-awaiting',
      httpStatus: 200,
    });

    const result = await startChatWithContactDetailed(
      'contact-1',
      'worker-1',
      'sector-1'
    );

    expect(mockApiPostWithMessage).toHaveBeenCalledWith(
      '/chat/start-with-contact',
      {
        contact_id: 'contact-1',
        worker_id: 'worker-1',
        sector_id: 'sector-1',
      }
    );
    expect(result).toEqual({
      status: true,
      chat,
      reason: null,
      message: 'ok',
      requestId: 'request-awaiting',
      httpStatus: 200,
    });
  });

  it.each([
    [
      'reaction',
      () =>
        reactToMessage('chat-1', 'message-1', '👍', {
          operationId: 'operation-1',
        }),
      '/chat/chat-1/message/message-1/react',
      { emoji: '👍', operation_id: 'operation-1' },
    ],
    [
      'delete',
      () =>
        deleteMessage('chat-1', 'message-1', {
          operationId: 'operation-1',
        }),
      '/chat/chat-1/message/message-1/delete',
      { operation_id: 'operation-1' },
    ],
    [
      'edit',
      () =>
        editMessage('chat-1', 'message-1', 'edited', {
          operationId: 'operation-1',
        }),
      '/chat/chat-1/message/message-1/edit',
      { message: 'edited', operation_id: 'operation-1' },
    ],
  ] as const)(
    'preserves the exact operation for a PubAck-unknown %s retry',
    async (_, invoke, path, body) => {
      mockApiPostWithMessage.mockResolvedValue({
        status: false,
        data: { acceptance: 'unknown', operation_id: 'operation-1' },
        httpStatus: 503,
      });

      await expect(invoke()).resolves.toEqual({
        status: 'unknown',
        operationId: 'operation-1',
      });
      expect(mockApiPostWithMessage).toHaveBeenNthCalledWith(1, path, body);
      expect(mockApiPostWithMessage).toHaveBeenNthCalledWith(2, path, body);
    }
  );

  it('sends and verifies the stable base identity for forward fan-out', async () => {
    mockApiPostWithMessage.mockResolvedValue({
      status: true,
      data: { requested: 1, sent: 1, failed: 0, results: [] },
      idempotencyKey: '019a0000-0000-7000-8000-000000000001',
      httpStatus: 200,
    });

    await expect(
      forwardMessage(
        'chat-1',
        'message-1',
        { target_chat_ids: ['target-1'] },
        {
          operationId: '019a0000-0000-7000-8000-000000000001',
          retryOf: '019a0000-0000-7000-8000-000000000002',
        }
      )
    ).resolves.toEqual({
      status: 'accepted',
      operationId: '019a0000-0000-7000-8000-000000000001',
      data: { requested: 1, sent: 1, failed: 0, results: [] },
    });
    expect(mockApiPostWithMessage).toHaveBeenCalledWith(
      '/chat/chat-1/message/message-1/forward',
      {
        target_chat_ids: ['target-1'],
        idempotency_key: '019a0000-0000-7000-8000-000000000001',
        retry_of: '019a0000-0000-7000-8000-000000000002',
      }
    );
  });
});
