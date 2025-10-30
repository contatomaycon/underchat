import { Static, Type } from '@sinclair/typebox';

export const deleteAccountInfoRequestSchema = Type.Object({
  account_info_id: Type.String({ format: 'uuid' }),
});

export type DeleteAccountInfoRequest = Static<
  typeof deleteAccountInfoRequestSchema
>;
