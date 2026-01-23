import { Static, Type } from '@sinclair/typebox';
import { EChatbotType } from '@core/common/enums/EChatbotType';

export const updateChatbotParamsRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type UpdateChatbotParamsRequest = Static<
  typeof updateChatbotParamsRequestSchema
>;

export const updateChatbotRequestSchema = Type.Object({
  name: Type.String(),
  type: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatbotType) }),
      Type.Null(),
    ])
  ),
});

export type UpdateChatbotRequest = Static<typeof updateChatbotRequestSchema>;
