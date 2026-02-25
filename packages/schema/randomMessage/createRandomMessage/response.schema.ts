import { Static, Type } from '@sinclair/typebox';

export const createRandomMessageResponseSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export type CreateRandomMessageResponse = Static<
  typeof createRandomMessageResponseSchema
>;
