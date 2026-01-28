import { Static, Type } from '@sinclair/typebox';

export const cloneChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account_id: Type.String({ format: 'uuid' }),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type CloneChatbotResponse = Static<typeof cloneChatbotResponseSchema>;
