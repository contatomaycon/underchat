import { Static, Type } from '@sinclair/typebox';

export const viewUserPhoneRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserPhoneRequest = Static<typeof viewUserPhoneRequestSchema>;
