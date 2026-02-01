import { Static, Type } from '@sinclair/typebox';

export const createVoiceIaResponseSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
});

export type CreateVoiceIaResponse = Static<typeof createVoiceIaResponseSchema>;
