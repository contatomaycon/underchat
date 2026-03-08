import { Static, Type } from '@sinclair/typebox';

export const transcribeAudioParamsSchema = Type.Object({
  chat_id: Type.String(),
  message_id: Type.String(),
});

export type TranscribeAudioParams = Static<typeof transcribeAudioParamsSchema>;
