import { Static, Type } from '@sinclair/typebox';

export const viewChatbotConfigResponseSchema = Type.Object({
  enabled: Type.Boolean(),
});

export type ViewChatbotConfigResponse = Static<
  typeof viewChatbotConfigResponseSchema
>;
