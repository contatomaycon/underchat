import { Static, Type } from '@sinclair/typebox';

export const viewUserSectorsParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserSectorsParamsRequest = Static<
  typeof viewUserSectorsParamsRequestSchema
>;
