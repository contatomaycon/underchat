import { Static, Type } from '@sinclair/typebox';

export const updateWorkerConfigParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateWorkerConfigRequestSchema = Type.Object({
  is_automatic_attendance: Type.Optional(Type.Boolean()),
  show_attendee_name: Type.Optional(Type.Boolean()),
  show_worker_name: Type.Optional(Type.Boolean()),
  generate_protocol_at_ura: Type.Optional(Type.Boolean()),
  generate_protocol_at_start: Type.Optional(Type.Boolean()),
  generate_protocol_at_transfer: Type.Optional(Type.Boolean()),
});

export type UpdateWorkerConfigParams = Static<
  typeof updateWorkerConfigParamsSchema
>;
export type UpdateWorkerConfigRequest = Static<
  typeof updateWorkerConfigRequestSchema
>;
