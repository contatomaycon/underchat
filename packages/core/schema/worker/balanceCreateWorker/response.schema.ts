import { Static, Type } from '@sinclair/typebox';

export const balanceCreateWorkerResponseSchema = Type.Object({
  worker_id: Type.String(),
  container_name: Type.String(),
});

export type BalanceCreateWorkerResponse = Static<
  typeof balanceCreateWorkerResponseSchema
>;
