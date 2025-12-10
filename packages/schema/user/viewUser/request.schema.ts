import { Static, Type } from '@sinclair/typebox';

export const viewUserRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserRequest = Static<typeof viewUserRequestSchema>;
