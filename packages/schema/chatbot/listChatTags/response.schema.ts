import { Static, Type } from '@sinclair/typebox';

export const chatbotChatTagResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export type ChatbotChatTagResponse = Static<
  typeof chatbotChatTagResponseSchema
>;
