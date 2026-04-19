import { Static, Type } from '@sinclair/typebox';
import { EReleaseType } from '@core/common/enums/EReleaseType';

export const editReleaseParamsRequestSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
});

export type EditReleaseParamsRequest = Static<
  typeof editReleaseParamsRequestSchema
>;

export const editReleaseBodyRequestSchema = Type.Object({
  type: Type.Optional(Type.Enum(EReleaseType)),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  message: Type.Optional(Type.String({ minLength: 1 })),
  reminder_at: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
});

export type EditReleaseBodyRequest = Static<
  typeof editReleaseBodyRequestSchema
>;
