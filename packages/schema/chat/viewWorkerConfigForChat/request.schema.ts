import { Static, Type } from '@sinclair/typebox';

export const viewWorkerConfigForChatParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewWorkerConfigForChatParams = Static<
  typeof viewWorkerConfigForChatParamsSchema
>;
