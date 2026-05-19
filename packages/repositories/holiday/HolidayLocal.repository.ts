import * as schema from '@core/models';
import { chatbotHoliday, zipcodeCity, zipcodeState } from '@core/models';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { LocalHolidayScope } from '@core/schema/chatbot/listLocalHolidays/response.schema';

interface CreateLocalHolidayInput {
  chatbot_holiday_id: string;
  account_id: string;
  scope: LocalHolidayScope;
  name: string;
  month: number;
  day: number;
  state_id: string;
  city_id: string | null;
}

interface UpdateLocalHolidayInput {
  chatbot_holiday_id: string;
  account_id: string;
  scope: LocalHolidayScope;
  name: string;
  month: number;
  day: number;
  state_id: string;
  city_id: string | null;
}

@injectable()
export class HolidayLocalRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listByAccountId = async (accountId: string) => {
    return this.dbRo
      .select({
        chatbot_holiday_id: chatbotHoliday.chatbot_holiday_id,
        scope: chatbotHoliday.scope,
        name: chatbotHoliday.name,
        month: chatbotHoliday.month,
        day: chatbotHoliday.day,
        state_id: chatbotHoliday.state_id,
        city_id: chatbotHoliday.city_id,
        state_name: zipcodeState.state,
        state_abbreviation: zipcodeState.abbreviation,
        city_name: zipcodeCity.city,
        created_at: chatbotHoliday.created_at,
        updated_at: chatbotHoliday.updated_at,
      })
      .from(chatbotHoliday)
      .leftJoin(
        zipcodeState,
        eq(chatbotHoliday.state_id, zipcodeState.id_zipcode_state)
      )
      .leftJoin(
        zipcodeCity,
        eq(chatbotHoliday.city_id, zipcodeCity.id_zipcode_city)
      )
      .where(eq(chatbotHoliday.account_id, accountId))
      .orderBy(
        asc(chatbotHoliday.month),
        asc(chatbotHoliday.day),
        asc(chatbotHoliday.name)
      );
  };

  listByDate = async (accountId: string, month: number, day: number) => {
    return this.dbRo
      .select({
        chatbot_holiday_id: chatbotHoliday.chatbot_holiday_id,
        scope: chatbotHoliday.scope,
        name: chatbotHoliday.name,
        month: chatbotHoliday.month,
        day: chatbotHoliday.day,
        state_id: chatbotHoliday.state_id,
        city_id: chatbotHoliday.city_id,
      })
      .from(chatbotHoliday)
      .where(
        and(
          eq(chatbotHoliday.account_id, accountId),
          eq(chatbotHoliday.month, month),
          eq(chatbotHoliday.day, day)
        )
      )
      .orderBy(asc(chatbotHoliday.name));
  };

  create = async (input: CreateLocalHolidayInput): Promise<string | null> => {
    const result = await this.dbRw
      .insert(chatbotHoliday)
      .values({
        chatbot_holiday_id: input.chatbot_holiday_id,
        account_id: input.account_id,
        scope: input.scope,
        name: input.name,
        month: input.month,
        day: input.day,
        state_id: input.state_id,
        city_id: input.city_id,
      })
      .returning({
        chatbot_holiday_id: chatbotHoliday.chatbot_holiday_id,
      });

    return result[0]?.chatbot_holiday_id ?? null;
  };

  update = async (input: UpdateLocalHolidayInput): Promise<boolean> => {
    const result = await this.dbRw
      .update(chatbotHoliday)
      .set({
        scope: input.scope,
        name: input.name,
        month: input.month,
        day: input.day,
        state_id: input.state_id,
        city_id: input.city_id,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(chatbotHoliday.chatbot_holiday_id, input.chatbot_holiday_id),
          eq(chatbotHoliday.account_id, input.account_id)
        )
      )
      .returning({
        chatbot_holiday_id: chatbotHoliday.chatbot_holiday_id,
      });

    return result.length > 0;
  };

  deleteById = async (
    chatbotHolidayId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(chatbotHoliday)
      .where(
        and(
          eq(chatbotHoliday.chatbot_holiday_id, chatbotHolidayId),
          eq(chatbotHoliday.account_id, accountId)
        )
      )
      .returning({
        chatbot_holiday_id: chatbotHoliday.chatbot_holiday_id,
      });

    return result.length > 0;
  };

  existsStateById = async (stateId: string): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        id_zipcode_state: zipcodeState.id_zipcode_state,
      })
      .from(zipcodeState)
      .where(eq(zipcodeState.id_zipcode_state, stateId))
      .limit(1);

    return result.length > 0;
  };

  viewCityById = async (
    cityId: string
  ): Promise<{ id_zipcode_city: string; id_zipcode_state: string } | null> => {
    const result = await this.dbRo
      .select({
        id_zipcode_city: zipcodeCity.id_zipcode_city,
        id_zipcode_state: zipcodeCity.id_zipcode_state,
      })
      .from(zipcodeCity)
      .where(eq(zipcodeCity.id_zipcode_city, cityId))
      .limit(1);

    return result[0] ?? null;
  };
}
