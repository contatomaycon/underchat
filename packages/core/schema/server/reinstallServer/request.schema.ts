import { Static, Type } from '@sinclair/typebox';

export const reinstallServerRequestSchema = Type.Object({
  server_id: Type.Number(),
});

export type ReinstallServerParamsRequest = Static<
  typeof reinstallServerRequestSchema
>;
