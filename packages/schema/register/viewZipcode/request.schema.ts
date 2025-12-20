import { Static, Type } from '@sinclair/typebox';

export const viewRegisterZipcodeRequestSchema = Type.Object({
  country_id: Type.Number(),
  zipcode: Type.String(),
});

export type ViewRegisterZipcodeRequest = Static<
  typeof viewRegisterZipcodeRequestSchema
>;
