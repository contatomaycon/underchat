import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

export const updateVoiceIaParamsSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
});

export const updateVoiceIaBodySchema = Type.Object({
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
  ),
  api_key: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  voice_id: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  model_id: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  speed: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  stability: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  similarity_boost: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  style_exaggeration: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EVoiceIaStatus.active),
      Type.Literal(EVoiceIaStatus.inactive),
      Type.Null(),
    ])
  ),
  enable_transcription: Type.Optional(
    Type.Union([Type.Boolean(), Type.Null()])
  ),
});

export type UpdateVoiceIaParams = Static<typeof updateVoiceIaParamsSchema>;
export type UpdateVoiceIaBody = Static<typeof updateVoiceIaBodySchema>;
export type UpdateVoiceIaRequest = UpdateVoiceIaBody;
