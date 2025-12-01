import { Static, Type } from '@sinclair/typebox';

export const viewChatbotParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewChatbotParams = Static<typeof viewChatbotParamsSchema>;
