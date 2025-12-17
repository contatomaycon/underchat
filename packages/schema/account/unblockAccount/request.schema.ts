import { Static, Type } from '@sinclair/typebox';

export const unblockAccountRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type UnblockAccountRequest = Static<typeof unblockAccountRequestSchema>;
