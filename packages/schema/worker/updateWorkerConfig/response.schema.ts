import { Static, Type } from '@sinclair/typebox';

export const workerConfigSchema = Type.Object({
  worker_config_id: Type.String(),
  worker_id: Type.String(),
  is_automatic_attendance: Type.Boolean(),
  show_attendee_name: Type.Boolean(),
  show_worker_name: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Integer(), Type.Null()]),
  generate_protocol_at_ura: Type.Union([Type.String(), Type.Null()]),
  generate_protocol_at_start: Type.Union([Type.String(), Type.Null()]),
  generate_protocol_at_transfer: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const updateWorkerConfigResponseSchema = workerConfigSchema;

export type WorkerConfig = Static<typeof workerConfigSchema>;
export type UpdateWorkerConfigResponse = Static<
  typeof updateWorkerConfigResponseSchema
>;
