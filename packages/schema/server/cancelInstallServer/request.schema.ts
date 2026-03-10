import { Static, Type } from '@sinclair/typebox';

export const cancelInstallServerRequestSchema = Type.Object({
  server_id: Type.String(),
});

export type CancelInstallServerParamsRequest = Static<
  typeof cancelInstallServerRequestSchema
>;
