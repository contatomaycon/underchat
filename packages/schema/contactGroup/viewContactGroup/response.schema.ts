import { Static, Type } from '@sinclair/typebox';

const contactSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  phone_partial: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export const viewContactGroupResponseSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account: accountSchema,
  contacts: Type.Optional(Type.Union([Type.Array(contactSchema), Type.Null()])),
  label_template: Type.Optional(Type.Union([labelTemplateSchema, Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewContactGroupResponse = Static<
  typeof viewContactGroupResponseSchema
>;
