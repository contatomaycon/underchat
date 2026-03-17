import { Static, Type } from '@sinclair/typebox';

export const cancelAccountAddonRequestSchema = Type.Object({
  plan_cross_sell_account_id: Type.String({ format: 'uuid' }),
});

export type CancelAccountAddonRequest = Static<
  typeof cancelAccountAddonRequestSchema
>;
