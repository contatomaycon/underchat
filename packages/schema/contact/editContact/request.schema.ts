import { Static, Type } from '@sinclair/typebox';

export const editContactParamsRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type EditContactParamsRequest = Static<
  typeof editContactParamsRequestSchema
>;

export const updateContactRequestSchema = Type.Object({
  label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.String(),
  phone: Type.String(),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birthday: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateContactRequest = Static<typeof updateContactRequestSchema>;
