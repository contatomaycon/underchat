import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { Static, Type } from '@sinclair/typebox';

const codeMessageValues = Object.values(ECodeMessage).filter(
  (value): value is number => typeof value === 'number'
);

export const workerConnectionStateResponseSchema = Type.Object({
  code: Type.Number({ enum: codeMessageValues }),
  status: Type.String({ enum: Object.values(EBaileysConnectionStatus) }),
  worker_id: Type.String(),
  account_id: Type.String(),
  qrcode: Type.Optional(Type.String()),
  is_new_login: Type.Optional(Type.Boolean()),
  time: Type.Optional(Type.Number()),
  phone: Type.Optional(Type.String()),
  disconnected_user: Type.Optional(Type.Boolean()),
  pairing_code: Type.Optional(Type.String()),
  seconds_until_next_attempt: Type.Optional(Type.Number()),
  worker_status_id: Type.Optional(
    Type.String({ enum: Object.values(EWorkerStatus) })
  ),
  attempt: Type.Optional(Type.Number()),
  max_attempts: Type.Optional(Type.Number()),
  connection_attempt_id: Type.Optional(Type.String()),
  qr_pending: Type.Optional(Type.Boolean()),
  proxy_status: Type.Optional(Type.String()),
  proxy_error_code: Type.Optional(Type.String()),
  proxy_fallback: Type.Optional(Type.String()),
  proxy_bypassed: Type.Optional(Type.Boolean()),
});

export type WorkerConnectionStateResponse = Static<
  typeof workerConnectionStateResponseSchema
>;
