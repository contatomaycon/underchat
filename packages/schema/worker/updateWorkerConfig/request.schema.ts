import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { Static, Type } from '@sinclair/typebox';

export const updateWorkerConfigParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateWorkerConfigRequestSchema = Type.Object({
  show_attendee_name: Type.Optional(Type.Boolean()),
  show_worker_name: Type.Optional(Type.Boolean()),
  allow_attendance_only_online: Type.Optional(Type.Boolean()),
  reject_call: Type.Optional(Type.Boolean()),
  auto_save_contacts: Type.Optional(Type.Boolean()),
  proxy_enabled: Type.Optional(Type.Boolean()),
  proxy_protocol: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EProxyProtocol) }),
      Type.Null(),
    ])
  ),
  proxy_host: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  proxy_port: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  proxy_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  proxy_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateWorkerConfigParams = Static<
  typeof updateWorkerConfigParamsSchema
>;
export type UpdateWorkerConfigRequest = Static<
  typeof updateWorkerConfigRequestSchema
>;
