import { Static, Type } from '@sinclair/typebox';

export const blockAccountRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type BlockAccountRequest = Static<typeof blockAccountRequestSchema>;
