import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

const contactSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  phone_partial: Type.String(),
});

export const listContactGroupResponseSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contacts: Type.Optional(Type.Union([Type.Array(contactSchema), Type.Null()])),
  label_template: Type.Optional(Type.Union([labelTemplateSchema, Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listContactGroupFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listContactGroupResponseSchema),
});

export type ListContactGroupResponse = Static<
  typeof listContactGroupResponseSchema
>;
export type ListContactGroupFinalResponse = Static<
  typeof listContactGroupFinalResponseSchema
>;
