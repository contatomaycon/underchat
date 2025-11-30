import { Static, Type } from '@sinclair/typebox';

export const createChatbotRequestSchema = Type.Object({
  name: Type.String(),
});

export type CreateChatbotRequest = Static<typeof createChatbotRequestSchema>;
