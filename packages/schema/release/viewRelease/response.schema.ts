import { Static, Type } from '@sinclair/typebox';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';

export const viewReleaseResponseSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
  account_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  type: Type.Enum(EReleaseType),
  status: Type.Enum(EReleaseStatus),
  title: Type.String(),
  message: Type.String(),
  viewed: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type ViewReleaseResponse = Static<typeof viewReleaseResponseSchema>;
