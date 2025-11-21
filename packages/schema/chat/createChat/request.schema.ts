import { Static, Type } from '@sinclair/typebox';

export const createChatRequestSchema = Type.Object({
  worker_id: Type.String(),
  phone: Type.String(),
  name: Type.String(),
});

export type CreateChatRequest = Static<typeof createChatRequestSchema>;
