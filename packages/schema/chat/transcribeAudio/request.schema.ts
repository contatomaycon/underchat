import { Static, Type } from '@sinclair/typebox';

export const transcribeAudioParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
  message_id: Type.String({ minLength: 1, maxLength: 255 }),
});

export type TranscribeAudioParams = Static<typeof transcribeAudioParamsSchema>;
