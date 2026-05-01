import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

const internalChatContactLabelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export const internalChatContactSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_valided: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  label_templates: Type.Array(internalChatContactLabelTemplateSchema),
});

export const listInternalChatContactsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(internalChatContactSchema),
});

export const listInternalChatContactsResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: listInternalChatContactsFinalResponseSchema,
});

export type ListInternalChatContactsResponse = Static<
  typeof listInternalChatContactsResponseSchema
>;
