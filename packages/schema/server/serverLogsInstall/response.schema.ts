import { Static, Type } from '@sinclair/typebox';

export const serverLogsInstallResponseSchema = Type.Object({
  command: Type.Union([Type.String(), Type.Null()]),
  output: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
});

export type ServerLogsInstallResponse = Static<
  typeof serverLogsInstallResponseSchema
>;
