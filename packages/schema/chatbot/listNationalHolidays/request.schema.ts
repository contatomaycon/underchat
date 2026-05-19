import { Static, Type } from '@sinclair/typebox';

export const listNationalHolidaysRequestSchema = Type.Object({
  year: Type.Number({ minimum: 1900, maximum: 2199 }),
});

export type ListNationalHolidaysRequest = Static<
  typeof listNationalHolidaysRequestSchema
>;
