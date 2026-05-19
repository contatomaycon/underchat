import { Static, Type } from '@sinclair/typebox';
import { createLocalHolidayRequestSchema } from '@core/schema/chatbot/createLocalHoliday/request.schema';

export const updateLocalHolidayParamsRequestSchema = Type.Object({
  chatbot_holiday_id: Type.String({ format: 'uuid' }),
});

export const updateLocalHolidayRequestSchema = createLocalHolidayRequestSchema;

export type UpdateLocalHolidayParamsRequest = Static<
  typeof updateLocalHolidayParamsRequestSchema
>;

export type UpdateLocalHolidayRequest = Static<
  typeof updateLocalHolidayRequestSchema
>;
