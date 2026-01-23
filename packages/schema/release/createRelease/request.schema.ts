import { Static, Type } from '@sinclair/typebox';
import { EReleaseType } from '@core/common/enums/EReleaseType';

export const createReleaseRequestSchema = Type.Object({
  type: Type.Enum(EReleaseType),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  message: Type.String({ minLength: 1 }),
  account_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  user_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  permission_role_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type CreateReleaseRequest = Static<typeof createReleaseRequestSchema>;
