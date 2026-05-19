import { Static, Type } from '@sinclair/typebox';

export const localHolidayScopeSchema = Type.Union([
  Type.Literal('state'),
  Type.Literal('municipal'),
]);

export const listLocalHolidayResponseSchema = Type.Object({
  chatbot_holiday_id: Type.String({ format: 'uuid' }),
  scope: localHolidayScopeSchema,
  name: Type.String(),
  month: Type.Number(),
  day: Type.Number(),
  state_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  city_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  state_name: Type.Union([Type.String(), Type.Null()]),
  state_abbreviation: Type.Union([Type.String(), Type.Null()]),
  city_name: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const listLocalHolidaysResponseSchema = Type.Array(
  listLocalHolidayResponseSchema
);

export type LocalHolidayScope = Static<typeof localHolidayScopeSchema>;
export type ListLocalHolidayResponse = Static<
  typeof listLocalHolidayResponseSchema
>;
export type ListLocalHolidaysResponse = Static<
  typeof listLocalHolidaysResponseSchema
>;
