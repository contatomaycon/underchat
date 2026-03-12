import { Static, Type } from '@sinclair/typebox';

export const checkWorkerOpenConversationsRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type CheckWorkerOpenConversationsRequest = Static<
  typeof checkWorkerOpenConversationsRequestSchema
>;
