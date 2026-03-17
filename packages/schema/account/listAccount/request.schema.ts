import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';

export const listAccountRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  account_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  filter_status: Type.Optional(
    Type.Union([
      Type.Literal(EAccountFilterStatus.all),
      Type.Literal(EAccountFilterStatus.subscribers),
      Type.Literal(EAccountFilterStatus.cancelling),
      Type.Literal(EAccountFilterStatus.cancelled),
      Type.Literal(EAccountFilterStatus.blocked),
      Type.Literal(EAccountFilterStatus.expired),
      Type.Literal(EAccountFilterStatus.tests),
      Type.Literal(EAccountFilterStatus.deleted),
      Type.Null(),
    ])
  ),
});

export type ListAccountRequest = Static<typeof listAccountRequestSchema>;
