import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentVoiceInputMode } from '@core/common/enums/EAiAgentVoiceInputMode';
import { EAiAgentVoiceOutputMode } from '@core/common/enums/EAiAgentVoiceOutputMode';

export const viewAiAgentResponseSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  base_url: Type.Union([Type.String(), Type.Null()]),
  api_key: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  embedding_model: Type.Union([Type.String(), Type.Null()]),
  chunk_size: Type.String(),
  chunk_overlap: Type.String(),
  status: Type.Union([
    Type.Literal(EAiAgentStatus.active),
    Type.Literal(EAiAgentStatus.inactive),
  ]),
  openai_assistant_id: Type.Union([Type.String(), Type.Null()]),
  openai_vector_store_id: Type.Union([Type.String(), Type.Null()]),
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  ai_agent_type_name: Type.String(),
  system_prompt: Type.Union([Type.String(), Type.Null()]),
  enable_human_transfer: Type.Boolean(),
  enable_human_transfer_by_prompt: Type.Boolean(),
  voice_ia_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  voice_ia_input_mode: Type.Union([
    Type.Literal(EAiAgentVoiceInputMode.text),
    Type.Literal(EAiAgentVoiceInputMode.audio),
    Type.Literal(EAiAgentVoiceInputMode.audio_and_text),
    Type.Null(),
  ]),
  voice_ia_output_mode: Type.Union([
    Type.Literal(EAiAgentVoiceOutputMode.text),
    Type.Literal(EAiAgentVoiceOutputMode.audio),
    Type.Literal(EAiAgentVoiceOutputMode.match_input),
    Type.Null(),
  ]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAiAgentResponse = Static<typeof viewAiAgentResponseSchema>;
