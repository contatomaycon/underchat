import { Static, Type } from '@sinclair/typebox';
import { EChatbotType } from '@core/common/enums/EChatbotType';

export const createChatbotRequestSchema = Type.Object({
  name: Type.String(),
  type: Type.Optional(
    Type.String({
      enum: Object.values(EChatbotType),
      default: EChatbotType.input,
    })
  ),
});

export type CreateChatbotRequest = Static<typeof createChatbotRequestSchema>;
