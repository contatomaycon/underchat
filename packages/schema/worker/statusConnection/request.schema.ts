import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { Static, Type } from '@sinclair/typebox';

export const statusConnectionWorkerRequestSchema = Type.Object({
  worker_id: Type.String(),
  status: Type.String({ enum: Object.values(EWorkerStatus) }),
  type: Type.String({ enum: [EBaileysConnectionType.qrcode] }),
  phone_connection: Type.Optional(Type.String()),
  remove_session: Type.Optional(Type.Boolean()),
  connection_attempt_id: Type.Optional(Type.String()),
  qr_pending: Type.Optional(Type.Boolean()),
});

export type StatusConnectionWorkerRequest = Static<
  typeof statusConnectionWorkerRequestSchema
>;
