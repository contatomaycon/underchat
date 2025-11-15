import { Static, Type } from '@sinclair/typebox';

export const viewContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewContactRequest = Static<typeof viewContactRequestSchema>;
