import { Static, Type } from '@sinclair/typebox';

export const validateContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ValidateContactRequest = Static<
  typeof validateContactRequestSchema
>;
