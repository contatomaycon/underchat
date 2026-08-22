import { Static, Type } from '@sinclair/typebox';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

const bulkContactIdsSchema = Type.Object({
  contact_ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1 }),
});

export const bulkUpdateContactDetailsRequestSchema = Type.Union([
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('set_responsible_attendant'),
      user_id: Type.String({ format: 'uuid' }),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('remove_responsible_attendant'),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('set_ignore'),
      ignore: Type.Enum(EContactIgnore),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('add_channels'),
      channel_ids: Type.Array(Type.String({ format: 'uuid' }), {
        minItems: 1,
      }),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('remove_channels'),
      channel_ids: Type.Array(Type.String({ format: 'uuid' }), {
        minItems: 1,
      }),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('append_notes'),
      notes: Type.String({ minLength: 1 }),
    }),
  ]),
  Type.Intersect([
    bulkContactIdsSchema,
    Type.Object({
      operation: Type.Literal('clear_notes'),
    }),
  ]),
]);

export type BulkUpdateContactDetailsRequest = Static<
  typeof bulkUpdateContactDetailsRequestSchema
>;
