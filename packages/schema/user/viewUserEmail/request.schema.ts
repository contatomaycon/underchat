import { Static, Type } from '@sinclair/typebox';

export const viewUserEmailRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserEmailRequest = Static<typeof viewUserEmailRequestSchema>;
