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
  authorized_connection_epoch: Type.Optional(Type.String()),
  debug_trace_id: Type.Optional(Type.String()),
  runtime_generation: Type.Optional(Type.Number()),
  warm_pool_id: Type.Optional(Type.String()),
  qr_pending: Type.Optional(Type.Boolean()),
  proxy_status: Type.Optional(Type.String()),
  proxy_error_code: Type.Optional(Type.String()),
  proxy_fallback: Type.Optional(Type.String()),
  proxy_bypassed: Type.Optional(Type.Boolean()),
});

export type StatusConnectionWorkerRequest = Static<
  typeof statusConnectionWorkerRequestSchema
>;
