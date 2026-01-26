import { Static, Type } from '@sinclair/typebox';
import { EChatbotType } from '@core/common/enums/EChatbotType';

export const integrationInputChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  type: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatbotType) }),
      Type.Null(),
    ])
  ),
  created_at: Type.String(),
});

export type IntegrationInputChatbotResponse = Static<
  typeof integrationInputChatbotResponseSchema
>;

export const listIntegrationInputChatbotsResponseSchema = Type.Array(
  integrationInputChatbotResponseSchema
);

export type ListIntegrationInputChatbotsResponse = Static<
  typeof listIntegrationInputChatbotsResponseSchema
>;
