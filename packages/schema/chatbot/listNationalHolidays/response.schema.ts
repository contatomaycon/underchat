import { Static, Type } from '@sinclair/typebox';

export const listNationalHolidayResponseSchema = Type.Object({
  date: Type.String(),
  name: Type.String(),
  type: Type.String(),
  weekday: Type.String(),
});

export const listNationalHolidaysResponseSchema = Type.Array(
  listNationalHolidayResponseSchema
);

export type ListNationalHolidayResponse = Static<
  typeof listNationalHolidayResponseSchema
>;

export type ListNationalHolidaysResponse = Static<
  typeof listNationalHolidaysResponseSchema
>;
