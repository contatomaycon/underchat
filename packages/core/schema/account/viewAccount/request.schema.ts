import { Static, Type } from '@sinclair/typebox';

export const viewAccountRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ViewAccountRequest = Static<typeof viewAccountRequestSchema>;
