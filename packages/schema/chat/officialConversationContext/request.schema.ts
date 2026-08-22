import { Static, Type } from '@sinclair/typebox';

export const officialConversationContextParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type OfficialConversationContextParams = Static<
  typeof officialConversationContextParamsSchema
>;
