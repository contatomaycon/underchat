import { Static, Type } from '@sinclair/typebox';

export const viewRandomMessageRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export type ViewRandomMessageRequest = Static<
  typeof viewRandomMessageRequestSchema
>;
