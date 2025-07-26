import { ESortOrder } from '@core/common/enums/ESortOrder';
import { Static, Type } from '@sinclair/typebox';

export const serverLogsInstallRequestSchema = Type.Object({
  server_id: Type.Number(),
});

export const serverLogsInstallQuerySchema = Type.Object({
  from: Type.Optional(Type.Number({ default: 0 })),
  size: Type.Optional(Type.Number({ default: 100 })),
  sort: Type.Optional(
    Type.Union([Type.Literal(ESortOrder.asc), Type.Literal(ESortOrder.desc)])
  ),
});

export type ServerLogsInstallRequest = Static<
  typeof serverLogsInstallRequestSchema
>;
export type ServerLogsInstallQuery = Static<
  typeof serverLogsInstallQuerySchema
>;
