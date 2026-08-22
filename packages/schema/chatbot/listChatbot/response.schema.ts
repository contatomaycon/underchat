import { Static, Type } from '@sinclair/typebox';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';

export const listChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  type: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatbotType) }),
      Type.Null(),
    ])
  ),
  status: Type.String({ enum: Object.values(EChatbotStatus) }),
  created_at: Type.String(),
});

export type ListChatbotResponse = Static<typeof listChatbotResponseSchema>;
