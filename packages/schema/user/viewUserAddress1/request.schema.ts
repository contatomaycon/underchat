import { Static, Type } from '@sinclair/typebox';

export const viewUserAddress1RequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserAddress1Request = Static<
  typeof viewUserAddress1RequestSchema
>;
