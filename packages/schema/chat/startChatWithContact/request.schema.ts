import { Static, Type } from '@sinclair/typebox';

export const startChatWithContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  worker_id: Type.String({ format: 'uuid' }),
  sector_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type StartChatWithContactRequest = Static<
  typeof startChatWithContactRequestSchema
>;
