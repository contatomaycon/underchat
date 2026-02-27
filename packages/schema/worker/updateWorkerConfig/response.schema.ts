import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { Static, Type } from '@sinclair/typebox';

export const workerConfigSchema = Type.Object({
  worker_config_id: Type.String(),
  worker_id: Type.String(),
  show_attendee_name: Type.Boolean(),
  show_worker_name: Type.Boolean(),
  show_protocol_in_chat: Type.Boolean(),
  allow_attendance_only_online: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Integer(), Type.Null()]),
  generate_protocol_at_start: Type.Union([Type.String(), Type.Null()]),
  generate_protocol_at_transfer: Type.Union([Type.String(), Type.Null()]),
  show_message_on_call: Type.Union([Type.String(), Type.Null()]),
  send_message_on_finish_attendance: Type.Union([Type.String(), Type.Null()]),
  reject_call: Type.Boolean(),
  auto_save_contacts: Type.Boolean(),
  mark_as_read: Type.Boolean(),
  chatbot_id: Type.Union([Type.String(), Type.Null()]),
  proxy_enabled: Type.Boolean(),
  proxy_protocol: Type.String({ enum: Object.values(EProxyProtocol) }),
  proxy_host: Type.Union([Type.String(), Type.Null()]),
  proxy_port: Type.Union([Type.Integer(), Type.Null()]),
  proxy_username: Type.Union([Type.String(), Type.Null()]),
  proxy_password: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const updateWorkerConfigResponseSchema = workerConfigSchema;

export type WorkerConfig = Static<typeof workerConfigSchema>;
export type UpdateWorkerConfigResponse = Static<
  typeof updateWorkerConfigResponseSchema
>;
