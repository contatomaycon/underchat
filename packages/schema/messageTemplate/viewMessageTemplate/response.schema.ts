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
  channel_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  account: accountSchema,
  message_status: Type.Union([messageStatusSchema, Type.Null()]),
  command: Type.String(),
  message: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.String(),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  auto_send: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewMessageTemplateResponse = Static<
  typeof viewMessageTemplateResponseSchema
>;
