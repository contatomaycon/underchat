import { Static, Type } from '@sinclair/typebox';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const updateIntegrationStatusRequestSchema = Type.Object({
  status: Type.Union([
    Type.Literal(EStatusApiKey.active),
    Type.Literal(EStatusApiKey.inactive),
  ]),
});

export type UpdateIntegrationStatusRequest = Static<
  typeof updateIntegrationStatusRequestSchema
>;
