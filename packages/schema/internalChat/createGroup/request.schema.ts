import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createGroupParamsSchema = Type.Object({});
export const createGroupQuerySchema = Type.Object({});
const createGroupStringFieldSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 255 }),
  Type.Object({
    value: Type.String({ minLength: 1, maxLength: 255 }),
  }),
]);

const createGroupMemberUserIdsSchema = Type.Union([
  Type.Array(Type.String({ format: 'uuid' }), { minItems: 1 }),
  Type.Array(
    Type.Object({
      value: Type.String(),
    }),
    { minItems: 1 }
  ),
  Type.String(),
  Type.Object({
    value: Type.Union([
      Type.Array(Type.String({ format: 'uuid' })),
      Type.String(),
      Type.Null(),
    ]),
  }),
]);

export const createGroupBodySchema = Type.Object({
  name: createGroupStringFieldSchema,
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
  member_user_ids: createGroupMemberUserIdsSchema,
});

export type CreateGroupBody = Static<typeof createGroupBodySchema>;
