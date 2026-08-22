import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentVoiceInputMode } from '@core/common/enums/EAiAgentVoiceInputMode';
import { EAiAgentVoiceOutputMode } from '@core/common/enums/EAiAgentVoiceOutputMode';

export const updateAiAgentParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export const updateAiAgentBodySchema = Type.Object({
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
  ),
  base_url: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()])
  ),
  api_key: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 2000 }), Type.Null()])
  ),
  model: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  embedding_model: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  chunk_size: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  chunk_overlap: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
      Type.Null(),
    ])
  ),
  system_prompt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  enable_human_transfer: Type.Optional(Type.Boolean()),
  voice_ia_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  voice_ia_input_mode: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentVoiceInputMode.text),
      Type.Literal(EAiAgentVoiceInputMode.audio),
      Type.Literal(EAiAgentVoiceInputMode.audio_and_text),
      Type.Null(),
    ])
  ),
  voice_ia_output_mode: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentVoiceOutputMode.text),
      Type.Literal(EAiAgentVoiceOutputMode.audio),
      Type.Literal(EAiAgentVoiceOutputMode.match_input),
      Type.Null(),
    ])
  ),
});

export type UpdateAiAgentParams = Static<typeof updateAiAgentParamsSchema>;
export type UpdateAiAgentBody = Static<typeof updateAiAgentBodySchema>;
export type UpdateAiAgentRequest = UpdateAiAgentBody;
