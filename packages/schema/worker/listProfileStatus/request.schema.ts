import { Static, Type } from '@sinclair/typebox';

export const listProfileStatusRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type ListProfileStatusRequest = Static<
  typeof listProfileStatusRequestSchema
>;
