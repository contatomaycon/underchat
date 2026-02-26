import { Static, Type } from '@sinclair/typebox';

export const workerConfigForKanbanSchema = Type.Object({
  show_worker_name: Type.Boolean(),
  show_attendee_name: Type.Boolean(),
  allow_attendance_only_online: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Number(), Type.Null()]),
  simultaneous_attendance_enabled: Type.Boolean(),
  has_ura_output: Type.Boolean(),
});

export const viewWorkerConfigForKanbanResponseSchema = Type.Union([
  workerConfigForKanbanSchema,
  Type.Null(),
]);

export type WorkerConfigForKanban = Static<typeof workerConfigForKanbanSchema>;
export type ViewWorkerConfigForKanbanResponse = Static<
  typeof viewWorkerConfigForKanbanResponseSchema
>;
