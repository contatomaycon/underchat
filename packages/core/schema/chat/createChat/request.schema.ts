import { Static, Type } from '@sinclair/typebox';

export const createChatRequestSchema = Type.Object({
  worker_id: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type CreateChatRequest = Static<typeof createChatRequestSchema>;
