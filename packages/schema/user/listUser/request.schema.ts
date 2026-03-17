import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listUserRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  user_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  permission_role_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account_id: Type.Optional(
    Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Literal('all'),
      Type.Null(),
    ])
  ),
});

export type ListUserRequest = Static<typeof listUserRequestSchema>;
