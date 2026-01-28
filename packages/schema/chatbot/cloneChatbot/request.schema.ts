import { Static, Type } from '@sinclair/typebox';

export const cloneChatbotRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type CloneChatbotRequest = Static<typeof cloneChatbotRequestSchema>;
