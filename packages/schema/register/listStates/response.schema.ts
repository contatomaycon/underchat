import { Static, Type } from '@sinclair/typebox';

export const registerStateItemSchema = Type.Object({
  id_zipcode_state: Type.String({ format: 'uuid' }),
  state: Type.String(),
  abbreviation: Type.Union([Type.String(), Type.Null()]),
  fiscal_code: Type.Union([Type.String(), Type.Null()]),
});

export const listRegisterStatesResponseSchema = Type.Array(
  registerStateItemSchema
);

export type RegisterStateListResponse = Static<
  typeof listRegisterStatesResponseSchema
>;
