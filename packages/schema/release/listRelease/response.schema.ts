import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';

export const listReleaseResponseSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
  created_by_user_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  type: Type.Enum(EReleaseType),
  status: Type.Enum(EReleaseStatus),
  title: Type.String(),
  message: Type.String(),
  viewed: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
  reminder_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listReleaseFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listReleaseResponseSchema),
});

export type ListReleaseResponse = Static<typeof listReleaseResponseSchema>;
export type ListReleaseFinalResponse = Static<
  typeof listReleaseFinalResponseSchema
>;
