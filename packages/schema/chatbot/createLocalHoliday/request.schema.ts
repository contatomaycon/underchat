import { Static, Type } from '@sinclair/typebox';
import { localHolidayScopeSchema } from '@core/schema/chatbot/listLocalHolidays/response.schema';

export const createLocalHolidayRequestSchema = Type.Object({
  scope: localHolidayScopeSchema,
  name: Type.String({ minLength: 1, maxLength: 250 }),
  month: Type.Number({ minimum: 1, maximum: 12 }),
  day: Type.Number({ minimum: 1, maximum: 31 }),
  state_id: Type.String({ format: 'uuid' }),
  city_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type CreateLocalHolidayRequest = Static<
  typeof createLocalHolidayRequestSchema
>;
