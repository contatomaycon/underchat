import { Static, Type } from '@sinclair/typebox';

export const editContactGroupParamsRequestSchema = Type.Object({
  contact_group_id: Type.String({ format: 'uuid' }),
});

export type EditContactGroupParamsRequest = Static<
  typeof editContactGroupParamsRequestSchema
>;

export const contactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export const updateContactGroupRequestSchema = Type.Object({
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contacts: Type.Optional(
    Type.Union([Type.Array(contactRequestSchema), Type.Null()])
  ),
});

export type UpdateContactGroupRequest = Static<
  typeof updateContactGroupRequestSchema
>;
