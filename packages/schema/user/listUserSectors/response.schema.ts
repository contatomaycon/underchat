import { Static, Type } from '@sinclair/typebox';

export const listUserSectorsResponseSchema = Type.Array(
  Type.Object({
    sector_id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    color: Type.String(),
  })
);

export type ListUserSectorsResponse = Static<
  typeof listUserSectorsResponseSchema
>;
