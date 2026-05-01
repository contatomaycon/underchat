import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const updateGroupParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const updateGroupQuerySchema = Type.Object({});
const updateGroupStringFieldSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 255 }),
  Type.Object({
    value: Type.String({ minLength: 1, maxLength: 255 }),
  }),
]);

export const updateGroupBodySchema = Type.Object({
  name: Type.Optional(updateGroupStringFieldSchema),
  photo: Type.Optional(
    Type.Union([
      uploadFileRequestSchema,
      Type.String(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
      }),
      Type.Null(),
    ])
  ),
});

export type UpdateGroupParams = Static<typeof updateGroupParamsSchema>;
export type UpdateGroupBody = Static<typeof updateGroupBodySchema>;
