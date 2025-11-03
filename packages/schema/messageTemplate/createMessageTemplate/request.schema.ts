import { Static, Type } from '@sinclair/typebox';

const messageStatusSchema = Type.Object({
  message_status_id: Type.String({ format: 'uuid' }),
});

export const createMessageTemplateRequestSchema = Type.Object({
  message: Type.String(),
  command: Type.String(),
  message_status: messageStatusSchema,
});

export type CreateMessageTemplateRequest = Static<
  typeof createMessageTemplateRequestSchema
>;
