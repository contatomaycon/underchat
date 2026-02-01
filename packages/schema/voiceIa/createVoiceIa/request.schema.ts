import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';

export const createVoiceIaRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  api_key: Type.String({ minLength: 1 }),
  voice_ia_type: Type.Optional(
    Type.Union([
      Type.Literal(EVoiceIaType.eleven_labs),
      Type.Literal(EVoiceIaType.gpt),
    ])
  ),
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
  enable_transcription: Type.Optional(Type.Boolean()),
});

export type CreateVoiceIaRequest = Static<typeof createVoiceIaRequestSchema>;
