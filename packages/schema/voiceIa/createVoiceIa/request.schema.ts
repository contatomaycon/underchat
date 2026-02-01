import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

export const createVoiceIaRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  api_key: Type.String({ minLength: 1 }),
  voice_id: Type.String({ minLength: 1, maxLength: 100 }),
  model_id: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  speed: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  stability: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  similarity_boost: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  style_exaggeration: Type.Optional(
    Type.String({ minLength: 1, maxLength: 10 })
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EVoiceIaStatus.active),
      Type.Literal(EVoiceIaStatus.inactive),
    ])
  ),
});

export type CreateVoiceIaRequest = Static<typeof createVoiceIaRequestSchema>;
