import { Static, Type } from '@sinclair/typebox';

export const viewZipcodeRequest = Type.Object({
  zipcode: Type.String(),
  country_id: Type.Integer(),
});

export type ViewZipcodeRequest = Static<typeof viewZipcodeRequest>;
