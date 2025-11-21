import { Static, Type } from '@sinclair/typebox';

export const deleteAccountRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type DeleteAccountRequest = Static<typeof deleteAccountRequestSchema>;
