import { Static, Type } from '@sinclair/typebox';

export const workerConfigForChatSchema = Type.Object({
  show_worker_name: Type.Boolean(),
  show_attendee_name: Type.Boolean(),
  is_automatic_attendance: Type.Boolean(),
  allow_attendance_only_online: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Number(), Type.Null()]),
  simultaneous_attendance_enabled: Type.Boolean(),
});

export const viewWorkerConfigForChatResponseSchema = Type.Union([
  workerConfigForChatSchema,
  Type.Null(),
]);

export type WorkerConfigForChat = Static<typeof workerConfigForChatSchema>;
export type ViewWorkerConfigForChatResponse = Static<
  typeof viewWorkerConfigForChatResponseSchema
>;
