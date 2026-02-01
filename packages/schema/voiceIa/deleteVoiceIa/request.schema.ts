import { Static, Type } from '@sinclair/typebox';

export const deleteVoiceIaRequestSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
});

export type DeleteVoiceIaRequest = Static<typeof deleteVoiceIaRequestSchema>;
