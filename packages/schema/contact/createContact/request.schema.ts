import { Static, Type } from '@sinclair/typebox';

export const createContactRequestSchema = Type.Object({
  label_template_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birthday: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type CreateContactRequest = Static<typeof createContactRequestSchema>;
