import { Static, Type } from '@sinclair/typebox';

export const generateAiReplyResponseSchema = Type.Object({
  text: Type.String({ description: 'Texto gerado pela IA' }),
  audio_url: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: 'URL do áudio gerado via TTS (quando response_type=audio)',
    })
  ),
  audio_duration: Type.Optional(
    Type.Union([Type.Number(), Type.Null()], {
      description: 'Duração do áudio em segundos',
    })
  ),
});

export type GenerateAiReplyResponse = Static<
  typeof generateAiReplyResponseSchema
>;
