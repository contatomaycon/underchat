import { Static, Type } from '@sinclair/typebox';

export const transferChatParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const transferChatBodySchema = Type.Object({
  user_id: Type.Optional(Type.String({ format: 'uuid' })),
  sector_id: Type.Optional(Type.String({ format: 'uuid' })),
  annotation: Type.Optional(Type.String({ maxLength: 5000 })),
});

export type TransferChatParams = Static<typeof transferChatParamsSchema>;
export type TransferChatBody = Static<typeof transferChatBodySchema>;
