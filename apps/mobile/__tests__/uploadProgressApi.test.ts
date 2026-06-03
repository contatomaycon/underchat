import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockApiPostFormWithMessage =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../api/client', () => ({
  apiDelete: jest.fn(),
  apiGet: jest.fn(),
  apiPatch: jest.fn(),
  apiPatchFormWithMessage: jest.fn(),
  apiPatchWithMessage: jest.fn(),
  apiPost: jest.fn(),
  apiPostForm: jest.fn(),
  apiPostFormWithMessage: mockApiPostFormWithMessage,
  apiPostWithMessage: jest.fn(),
  apiPut: jest.fn(),
}));

import { createMessageWithFormData } from '../api/chatApi';
import { createInternalChatMessageWithFormData } from '../api/internalChatApi';

describe('upload progress API propagation', () => {
  beforeEach(() => {
    mockApiPostFormWithMessage.mockReset();
    mockApiPostFormWithMessage.mockResolvedValue({
      status: true,
      data: null,
      message: null,
    });
  });

  it('passes upload progress options to normal chat media messages', async () => {
    const formData = {} as FormData;
    const options = { onUploadProgress: jest.fn() };

    await createMessageWithFormData('chat-1', formData, options);

    expect(mockApiPostFormWithMessage).toHaveBeenCalledWith(
      '/chat/chat-1',
      formData,
      options
    );
  });

  it('passes upload progress options to internal chat media messages', async () => {
    const formData = {} as FormData;
    const options = { onUploadProgress: jest.fn() };

    await createInternalChatMessageWithFormData(
      'conversation-1',
      formData,
      options
    );

    expect(mockApiPostFormWithMessage).toHaveBeenCalledWith(
      '/internal-chat/conversation-1/messages',
      formData,
      options
    );
  });
});
