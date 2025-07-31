import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { Static, Type } from '@sinclair/typebox';

export const statusConnectionWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
  status: Type.String({ enum: Object.values(EWorkerStatus) }),
  type: Type.String({ enum: Object.values(EBaileysConnectionType) }),
  phone_connection: Type.Optional(Type.Number()),
});

export type StatusConnectionWorkerRequest = Static<
  typeof statusConnectionWorkerRequestSchema
>;
