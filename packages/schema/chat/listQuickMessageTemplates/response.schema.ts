import { Static, Type } from '@sinclair/typebox';

export const listQuickMessageTemplatesResponseSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
  command: Type.String(),
  message: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.String(),
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
