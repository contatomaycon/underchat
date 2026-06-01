import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockApiPatch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPatchWithMessage =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPostWithMessage =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiGet = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../api/client', () => ({
  apiDelete: jest.fn(),
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
  apiPatchWithMessage: mockApiPatchWithMessage,
  apiPatchFormWithMessage: jest.fn(),
  apiPost: jest.fn(),
  apiPostWithMessage: mockApiPostWithMessage,
  apiPostForm: jest.fn(),
  apiPostFormWithMessage: jest.fn(),
  apiPut: jest.fn(),
}));

import {
  transferChat,
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
        annotation: undefined,
        keep_in_chat: true,
        send_message_on_transfer: false,
      }
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
