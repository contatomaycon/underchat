import { Static, Type } from '@sinclair/typebox';

export const editMessageTemplateParamsRequestSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
});

export type EditMessageTemplateParamsRequest = Static<
  typeof editMessageTemplateParamsRequestSchema
>;

const messageStatusSchema = Type.Object({
  message_status_id: Type.String({ format: 'uuid' }),
});

export const updateMessageTemplateRequestSchema = Type.Object({
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  command: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message_status: Type.Optional(Type.Union([messageStatusSchema, Type.Null()])),
});

export type UpdateMessageTemplateRequest = Static<
  typeof updateMessageTemplateRequestSchema
>;
