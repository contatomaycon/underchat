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
  listPinnedChats,
  pinChat,
  transferChat,
  unpinChat,
  updateChatAttendanceInactivity,
  updateChatStatusDetailed,
  viewChatAttendanceInactivity,
} from '../api/chatApi';

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
});
