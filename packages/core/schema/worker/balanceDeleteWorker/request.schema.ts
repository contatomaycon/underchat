import { Static, Type } from '@sinclair/typebox';

export const balanceDeleteWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export type BalanceDeleteWorkerRequest = Static<
  typeof balanceDeleteWorkerRequestSchema
>;
