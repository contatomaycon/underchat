import { Static, Type } from '@sinclair/typebox';

export const transferLeaderParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const transferLeaderQuerySchema = Type.Object({});
export const transferLeaderBodySchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type TransferLeaderParams = Static<typeof transferLeaderParamsSchema>;
export type TransferLeaderBody = Static<typeof transferLeaderBodySchema>;
