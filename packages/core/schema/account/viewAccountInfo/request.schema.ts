import { Static, Type } from '@sinclair/typebox';

export const viewAccountInfoRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ViewAccountInfoRequest = Static<
  typeof viewAccountInfoRequestSchema
>;
