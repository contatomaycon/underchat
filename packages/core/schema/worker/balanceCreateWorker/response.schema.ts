import { Static, Type } from '@sinclair/typebox';

export const balanceCreateWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
});

export type BalanceCreateWorkerResponse = Static<
  typeof balanceCreateWorkerResponseSchema
>;
