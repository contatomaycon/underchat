import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export const listChatContactsResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_valided: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  label_template: Type.Optional(Type.Union([labelTemplateSchema, Type.Null()])),
});

export const listChatContactsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChatContactsResponseSchema),
});

export type ListChatContactsResponse = Static<
  typeof listChatContactsResponseSchema
>;
export type ListChatContactsFinalResponse = Static<
  typeof listChatContactsFinalResponseSchema
>;
