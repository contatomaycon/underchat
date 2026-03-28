import { Static, Type } from '@sinclair/typebox';

export const workerConfigForChatSchema = Type.Object({
  show_worker_name: Type.Boolean(),
  show_attendee_name: Type.Boolean(),
  show_protocol_in_chat: Type.Boolean(),
  send_message_on_finish_attendance_enabled: Type.Boolean(),
  send_message_on_transfer_enabled: Type.Boolean(),
  allow_attendance_only_online: Type.Boolean(),
  simultaneous_attendance: Type.Union([Type.Number(), Type.Null()]),
  simultaneous_attendance_enabled: Type.Boolean(),
  has_ura_output: Type.Boolean(),
  ai_agent_enabled: Type.Boolean(),
  ai_agent_id: Type.Union([Type.String(), Type.Null()]),
});

export const viewWorkerConfigForChatResponseSchema = Type.Union([
  workerConfigForChatSchema,
  Type.Null(),
]);

export type WorkerConfigForChat = Static<typeof workerConfigForChatSchema>;
export type ViewWorkerConfigForChatResponse = Static<
  typeof viewWorkerConfigForChatResponseSchema
>;
