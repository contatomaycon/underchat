import { Static, Type } from '@sinclair/typebox';

export const registerZipcodeResponseSchema = Type.Object({
  zipcode: Type.String(),
  address_1: Type.String(),
  address_2: Type.String(),
  district: Type.String(),
  city: Type.String(),
  state: Type.String(),
});

export type RegisterZipcodeResponseSchema = Static<
  typeof registerZipcodeResponseSchema
>;
