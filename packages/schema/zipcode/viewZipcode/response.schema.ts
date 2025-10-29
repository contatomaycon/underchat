import { Static, Type } from '@sinclair/typebox';

export const zipcodeResponseSchema = Type.Object({
  zipcode: Type.String(),
  address_1: Type.String(),
  address_2: Type.String(),
  district: Type.String(),
  city: Type.String(),
  state: Type.String(),
});

export type ZipcodeResponseSchema = Static<typeof zipcodeResponseSchema>;
