import { Static, Type } from '@sinclair/typebox';

export const openDirectParamsSchema = Type.Object({});
export const openDirectQuerySchema = Type.Object({});
export const openDirectBodySchema = Type.Object({
  target_user_id: Type.String({ format: 'uuid' }),
});

export type OpenDirectBody = Static<typeof openDirectBodySchema>;
