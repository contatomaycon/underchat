import { Static, Type } from '@sinclair/typebox';

export const viewUserRoleParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserRoleParamsRequest = Static<
  typeof viewUserRoleParamsRequestSchema
>;

