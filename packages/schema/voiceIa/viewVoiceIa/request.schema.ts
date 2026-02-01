import { Static, Type } from '@sinclair/typebox';

export const viewVoiceIaRequestSchema = Type.Object({
  voice_ia_id: Type.String({ format: 'uuid' }),
});

export type ViewVoiceIaRequest = Static<typeof viewVoiceIaRequestSchema>;
