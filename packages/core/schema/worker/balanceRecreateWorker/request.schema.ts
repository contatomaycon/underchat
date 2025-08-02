import { Static, Type } from '@sinclair/typebox';

export const balanceRecreateWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type BalanceRecreateWorkerRequest = Static<
  typeof balanceRecreateWorkerRequestSchema
>;
