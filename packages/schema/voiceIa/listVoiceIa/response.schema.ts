import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

export const listVoiceIaResponseSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  voice_ia_type_name: Type.String(),
  status: Type.Union([
    Type.Literal(EVoiceIaStatus.active),
    Type.Literal(EVoiceIaStatus.inactive),
  ]),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listVoiceIaFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listVoiceIaResponseSchema),
});

export type ListVoiceIaResponse = Static<typeof listVoiceIaResponseSchema>;
export type ListVoiceIaFinalResponse = Static<
  typeof listVoiceIaFinalResponseSchema
>;
