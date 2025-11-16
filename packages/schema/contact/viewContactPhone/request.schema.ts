import { Static, Type } from '@sinclair/typebox';

export const viewContactPhoneRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewContactPhoneRequest = Static<
  typeof viewContactPhoneRequestSchema
>;
