import { Static, Type } from '@sinclair/typebox';

export const listQuickMessageTemplatesResponseSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
  command: Type.String(),
  message: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.String(),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export const listQuickMessageTemplatesFinalResponseSchema = Type.Object({
  results: Type.Array(listQuickMessageTemplatesResponseSchema),
});

export type ListQuickMessageTemplatesResponse = Static<
  typeof listQuickMessageTemplatesResponseSchema
>;
export type ListQuickMessageTemplatesFinalResponse = Static<
  typeof listQuickMessageTemplatesFinalResponseSchema
>;
