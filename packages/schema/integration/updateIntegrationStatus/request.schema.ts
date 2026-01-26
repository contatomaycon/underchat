import { Static, Type } from '@sinclair/typebox';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const updateIntegrationStatusRequestSchema = Type.Object({
  api_key_id: Type.String({ format: 'uuid' }),
  status: Type.String({ enum: Object.values(EStatusApiKey) }),
});

export type UpdateIntegrationStatusRequest = Static<
  typeof updateIntegrationStatusRequestSchema
>;
