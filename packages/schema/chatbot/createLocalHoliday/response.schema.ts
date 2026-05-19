import { Static, Type } from '@sinclair/typebox';

export const createLocalHolidayResponseSchema = Type.Object({
  chatbot_holiday_id: Type.String({ format: 'uuid' }),
});

export type CreateLocalHolidayResponse = Static<
  typeof createLocalHolidayResponseSchema
>;
