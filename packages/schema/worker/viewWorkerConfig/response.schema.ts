import { Static, Type } from '@sinclair/typebox';

export const workerConfigSchema = Type.Object({
  worker_config_id: Type.String(),
  worker_id: Type.String(),
  is_automatic_attendance: Type.Boolean(),
  show_attendee_name: Type.Boolean(),
  show_worker_name: Type.Boolean(),
  allow_attendance_only_online: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Integer(), Type.Null()]),
  generate_protocol_at_start: Type.Union([Type.String(), Type.Null()]),
  generate_protocol_at_transfer: Type.Union([Type.String(), Type.Null()]),
  show_message_on_call: Type.Union([Type.String(), Type.Null()]),
  send_message_on_finish_attendance: Type.Union([Type.String(), Type.Null()]),
  reject_call: Type.Boolean(),
  auto_save_contacts: Type.Boolean(),
  chatbot_id: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const viewWorkerConfigResponseSchema = Type.Union([
  workerConfigSchema,
  Type.Null(),
]);

export type WorkerConfig = Static<typeof workerConfigSchema>;
export type ViewWorkerConfigResponse = Static<
  typeof viewWorkerConfigResponseSchema
>;
