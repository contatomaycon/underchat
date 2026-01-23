import { Static, Type } from '@sinclair/typebox';
import { EChatbotType } from '@core/common/enums/EChatbotType';

export const listChatbotResponseSchema = Type.Object({
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

export type ListChatbotResponse = Static<typeof listChatbotResponseSchema>;
