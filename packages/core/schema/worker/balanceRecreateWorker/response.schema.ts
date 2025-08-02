import { Static, Type } from '@sinclair/typebox';

export const balanceRecreateWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
});

export type BalanceRecreateWorkerResponse = Static<
  typeof balanceRecreateWorkerResponseSchema
>;
