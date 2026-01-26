import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const listIntegrationsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EStatusApiKey) }),
      Type.Null(),
    ])
  ),
});

export type ListIntegrationsRequest = Static<
  typeof listIntegrationsRequestSchema
>;
