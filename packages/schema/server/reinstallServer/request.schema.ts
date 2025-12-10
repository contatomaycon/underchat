import { Static, Type } from '@sinclair/typebox';

export const reinstallServerRequestSchema = Type.Object({
  server_id: Type.String(),
});

export type ReinstallServerParamsRequest = Static<
  typeof reinstallServerRequestSchema
>;
