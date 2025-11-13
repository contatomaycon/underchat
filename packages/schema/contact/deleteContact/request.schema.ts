import { Static, Type } from '@sinclair/typebox';

export const deleteContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type DeleteContactRequest = Static<typeof deleteContactRequestSchema>;
