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
});

export type UpdateWorkerConfigParams = Static<
  typeof updateWorkerConfigParamsSchema
>;
export type UpdateWorkerConfigRequest = Static<
  typeof updateWorkerConfigRequestSchema
>;
