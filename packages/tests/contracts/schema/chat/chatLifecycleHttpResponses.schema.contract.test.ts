import { describe, expect, it } from '@jest/globals';
import { joinChatSchema } from '@core/schema/chat/joinChat';
import { leaveChatSchema } from '@core/schema/chat/leaveChat';
import { transferChatSchema } from '@core/schema/chat/transferChat';
import { updateChatStatusSchema } from '@core/schema/chat/updateChatStatus';

describe('chat lifecycle HTTP response schemas', () => {
  it.each([
    ['status', updateChatStatusSchema],
    ['join', joinChatSchema],
    ['leave', leaveChatSchema],
    ['transfer', transferChatSchema],
  ] as const)('documents a 404 response for %s', (_, schema) => {
    expect(schema.response[404]).toBeDefined();
  });
});
