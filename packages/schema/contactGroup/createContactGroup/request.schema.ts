import { Static, Type } from '@sinclair/typebox';

export const contactGroupAssignmentRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export const createContactGroupRequestSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contacts: Type.Optional(
    Type.Union([Type.Array(contactGroupAssignmentRequestSchema), Type.Null()])
  ),
});

export type CreateContactGroupRequest = Static<
  typeof createContactGroupRequestSchema
>;
