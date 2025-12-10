import { Static, Type } from '@sinclair/typebox';

export const deleteMessageTemplateRequestSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
});

export type DeleteMessageTemplateRequest = Static<
  typeof deleteMessageTemplateRequestSchema
>;
