import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { Static, Type } from '@sinclair/typebox';

export const listRandomMessageRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(ERandomMessageStatus.active),
      Type.Literal(ERandomMessageStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type ListRandomMessageRequest = Static<
  typeof listRandomMessageRequestSchema
>;
