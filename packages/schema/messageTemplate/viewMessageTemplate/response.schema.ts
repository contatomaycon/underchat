import { Static, Type } from '@sinclair/typebox';

const messageStatusSchema = Type.Object({
  message_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const viewMessageTemplateResponseSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  message_status: Type.Union([messageStatusSchema, Type.Null()]),
  command: Type.String(),
  message: Type.String(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewMessageTemplateResponse = Static<
  typeof viewMessageTemplateResponseSchema
>;
