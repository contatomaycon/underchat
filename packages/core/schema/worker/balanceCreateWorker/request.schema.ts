import { EWorkerType } from '@core/common/enums/EWorkerType';
import { Static, Type } from '@sinclair/typebox';

export const balanceCreateWorkerRequestSchema = Type.Object({
  account_id: Type.String(),
  worker_type: Type.String({ enum: Object.values(EWorkerType) }),
});

export type BalanceCreateWorkerRequest = Static<
  typeof balanceCreateWorkerRequestSchema
>;
