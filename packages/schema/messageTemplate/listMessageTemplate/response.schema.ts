import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const messageStatusSchema = Type.Object({
  message_status_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listMessageTemplateResponseSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  message_status: Type.Union([messageStatusSchema, Type.Null()]),
  command: Type.String(),
  message: Type.String(),
  attachment_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listMessageTemplateFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listMessageTemplateResponseSchema),
});

export type ListMessageTemplateResponse = Static<
  typeof listMessageTemplateResponseSchema
>;
export type ListMessageTemplateFinalResponse = Static<
  typeof listMessageTemplateFinalResponseSchema
>;
