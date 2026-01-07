import { Static, Type } from '@sinclair/typebox';

export const viewUserSectorsResponseSchema = Type.Array(
  Type.String({ format: 'uuid' })
);

export type ViewUserSectorsResponse = Static<
  typeof viewUserSectorsResponseSchema
>;
