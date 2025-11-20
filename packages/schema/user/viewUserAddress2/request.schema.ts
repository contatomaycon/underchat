import { Static, Type } from '@sinclair/typebox';

export const viewUserAddress2RequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewUserAddress2Request = Static<
  typeof viewUserAddress2RequestSchema
>;

