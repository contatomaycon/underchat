import { Static, Type } from '@sinclair/typebox';

export const listUserSectorsRequestSchema = Type.Object({
  account_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type ListUserSectorsRequest = Static<
  typeof listUserSectorsRequestSchema
>;
