import { Static, Type } from '@sinclair/typebox';

export const deleteLocalHolidayRequestSchema = Type.Object({
  chatbot_holiday_id: Type.String({ format: 'uuid' }),
});

export type DeleteLocalHolidayRequest = Static<
  typeof deleteLocalHolidayRequestSchema
>;
