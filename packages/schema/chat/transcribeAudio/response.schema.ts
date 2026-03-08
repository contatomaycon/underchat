import { Static, Type } from '@sinclair/typebox';

export const transcribeAudioResponseSchema = Type.Object({
  transcription: Type.String({ description: 'Texto transcrito do áudio' }),
  cached: Type.Boolean({
    description: 'Indica se a transcrição veio do cache (já existia)',
  }),
});

export type TranscribeAudioResponse = Static<
  typeof transcribeAudioResponseSchema
>;
