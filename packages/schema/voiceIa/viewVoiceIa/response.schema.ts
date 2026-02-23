import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

export const viewVoiceIaResponseSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  voice_ia_type: Type.String(),
  api_key: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal(EVoiceIaStatus.active),
    Type.Literal(EVoiceIaStatus.inactive),
  ]),
  voice_id: Type.String(),
  model_id: Type.String(),
  language_code: Type.String(),
  speed: Type.String(),
  stability: Type.String(),
  similarity_boost: Type.String(),
  style_exaggeration: Type.String(),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewVoiceIaResponse = Static<typeof viewVoiceIaResponseSchema>;
