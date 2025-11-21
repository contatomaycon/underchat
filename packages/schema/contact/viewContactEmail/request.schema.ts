import { Static, Type } from '@sinclair/typebox';

export const viewContactEmailRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewContactEmailRequest = Static<
  typeof viewContactEmailRequestSchema
>;
