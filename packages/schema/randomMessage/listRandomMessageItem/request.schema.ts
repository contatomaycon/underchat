import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const listRandomMessageItemParamsRequestSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
});

export const listRandomMessageItemQueryRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(ERandomMessageStatus.active),
      Type.Literal(ERandomMessageStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type ListRandomMessageItemParamsRequest = Static<
  typeof listRandomMessageItemParamsRequestSchema
>;
export type ListRandomMessageItemQueryRequest = Static<
  typeof listRandomMessageItemQueryRequestSchema
>;
