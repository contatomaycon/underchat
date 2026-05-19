import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { HolidayLocalRepository } from '@core/repositories/holiday/HolidayLocal.repository';
import { CreateLocalHolidayRequest } from '@core/schema/chatbot/createLocalHoliday/request.schema';
import {
  ListNationalHolidayResponse,
  ListNationalHolidaysResponse,
} from '@core/schema/chatbot/listNationalHolidays/response.schema';
import { LocalHolidayScope } from '@core/schema/chatbot/listLocalHolidays/response.schema';

type HolidayType = 'national' | LocalHolidayScope;

interface ResolveHolidayDetail {
  name: string;
  type: HolidayType;
}

interface ResolveHolidaysResponse {
  isHoliday: boolean;
  holidayNames: string[];
  holidayDetails: ResolveHolidayDetail[];
  holidayTags: string[];
}

@injectable()
export class HolidayService {
  private readonly NATIONAL_HOLIDAYS_CACHE_TTL_SECONDS = 60 * 60 * 24;

  constructor(
    @inject(HolidayLocalRepository)
    private readonly holidayLocalRepository: HolidayLocalRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private getNationalHolidaysCacheKey(year: number): string {
    return `chatbot:holidays:national:${year}`;
  }

  private getDateParts(date: Date): {
    year: number;
    month: number;
    day: number;
  } {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    };
  }

  private buildDateString(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private normalizeHolidayName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private buildHolidayTagFromName(name: string): string {
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized ? `#${normalized}` : '#feriado_local';
  }

  private async getNationalHolidaysFromCache(
    year: number
  ): Promise<ListNationalHolidaysResponse | null> {
    const cached = await this.redis.get(this.getNationalHolidaysCacheKey(year));

    if (!cached) {
      return null;
    }

    try {
      const parsed = JSON.parse(cached) as ListNationalHolidaysResponse;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      await this.redis.del(this.getNationalHolidaysCacheKey(year));
      return null;
    }
  }

  private async setNationalHolidaysCache(
    year: number,
    holidays: ListNationalHolidaysResponse
  ): Promise<void> {
    await this.redis.set(
      this.getNationalHolidaysCacheKey(year),
      JSON.stringify(holidays),
      'EX',
      this.NATIONAL_HOLIDAYS_CACHE_TTL_SECONDS
    );
  }

  private async fetchNationalHolidaysFromBrasilApi(
    year: number
  ): Promise<ListNationalHolidaysResponse> {
    const response = await fetch(
      `https://brasilapi.com.br/api/feriados/v1/${year}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      throw new Error(
        `BrasilAPI request failed with status ${response.status}`
      );
    }

    const data = (await response.json()) as ListNationalHolidayResponse[];

    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter((holiday) => {
        return (
          typeof holiday?.date === 'string' &&
          typeof holiday?.name === 'string' &&
          typeof holiday?.type === 'string' &&
          typeof holiday?.weekday === 'string'
        );
      })
      .map((holiday) => ({
        date: holiday.date,
        name: this.normalizeHolidayName(holiday.name),
        type: holiday.type,
        weekday: holiday.weekday,
      }));
  }

  private async validateLocalHolidayInput(input: {
    scope: LocalHolidayScope;
    name: string;
    month: number;
    day: number;
    state_id: string;
    city_id?: string | null;
  }): Promise<{ cityId: string | null }> {
    const stateExists = await this.holidayLocalRepository.existsStateById(
      input.state_id
    );

    if (!stateExists) {
      throw new Error('chatbot_holiday_state_not_found');
    }

    if (input.scope === 'state') {
      return {
        cityId: null,
      };
    }

    if (!input.city_id) {
      throw new Error('chatbot_holiday_city_required');
    }

    const city = await this.holidayLocalRepository.viewCityById(input.city_id);

    if (!city) {
      throw new Error('chatbot_holiday_city_not_found');
    }

    if (city.id_zipcode_state !== input.state_id) {
      throw new Error('chatbot_holiday_city_state_mismatch');
    }

    return {
      cityId: city.id_zipcode_city,
    };
  }

  listNationalHolidays = async (
    year: number
  ): Promise<ListNationalHolidaysResponse> => {
    const cached = await this.getNationalHolidaysFromCache(year);
    if (cached) {
      return cached;
    }

    try {
      const holidays = await this.fetchNationalHolidaysFromBrasilApi(year);
      await this.setNationalHolidaysCache(year, holidays);
      return holidays;
    } catch {
      return [];
    }
  };

  listLocalHolidays = async (accountId: string) => {
    return this.holidayLocalRepository.listByAccountId(accountId);
  };

  createLocalHoliday = async (
    accountId: string,
    input: CreateLocalHolidayRequest
  ): Promise<string | null> => {
    const name = input.name.trim();

    if (!name) {
      throw new Error('chatbot_holiday_name_required');
    }

    const { cityId } = await this.validateLocalHolidayInput({
      scope: input.scope,
      name,
      month: input.month,
      day: input.day,
      state_id: input.state_id,
      city_id: input.city_id,
    });

    return this.holidayLocalRepository.create({
      chatbot_holiday_id: uuidv7(),
      account_id: accountId,
      scope: input.scope,
      name,
      month: input.month,
      day: input.day,
      state_id: input.state_id,
      city_id: cityId,
    });
  };

  updateLocalHoliday = async (
    accountId: string,
    chatbotHolidayId: string,
    input: CreateLocalHolidayRequest
  ): Promise<boolean> => {
    const name = input.name.trim();

    if (!name) {
      throw new Error('chatbot_holiday_name_required');
    }

    const { cityId } = await this.validateLocalHolidayInput({
      scope: input.scope,
      name,
      month: input.month,
      day: input.day,
      state_id: input.state_id,
      city_id: input.city_id,
    });

    return this.holidayLocalRepository.update({
      chatbot_holiday_id: chatbotHolidayId,
      account_id: accountId,
      scope: input.scope,
      name,
      month: input.month,
      day: input.day,
      state_id: input.state_id,
      city_id: cityId,
    });
  };

  deleteLocalHoliday = async (
    accountId: string,
    chatbotHolidayId: string
  ): Promise<boolean> => {
    return this.holidayLocalRepository.deleteById(chatbotHolidayId, accountId);
  };

  resolveHolidaysForDate = async (
    accountId: string,
    date: Date
  ): Promise<ResolveHolidaysResponse> => {
    const { year, month, day } = this.getDateParts(date);
    const expectedDate = this.buildDateString(year, month, day);

    const [nationalHolidays, localHolidays] = await Promise.all([
      this.listNationalHolidays(year),
      this.holidayLocalRepository.listByDate(accountId, month, day),
    ]);

    const matchedNationalDetails = nationalHolidays
      .filter((holiday) => holiday.date === expectedDate)
      .map((holiday) => ({
        name: this.normalizeHolidayName(holiday.name),
        type: 'national' as const,
      }));

    const matchedLocalDetails = localHolidays.map((holiday) => ({
      name: this.normalizeHolidayName(holiday.name),
      type: holiday.scope as LocalHolidayScope,
    }));

    const allHolidayDetails = Array.from(
      new Map(
        [...matchedNationalDetails, ...matchedLocalDetails].map((holiday) => [
          `${holiday.name}::${holiday.type}`,
          holiday,
        ])
      ).values()
    );

    const allHolidayNames = Array.from(
      new Set(allHolidayDetails.map((holiday) => holiday.name))
    );

    const allHolidayTags = Array.from(
      new Set([
        '#feriado',
        ...allHolidayNames.map((name) => this.buildHolidayTagFromName(name)),
      ])
    );

    return {
      isHoliday: allHolidayNames.length > 0,
      holidayNames: allHolidayNames,
      holidayDetails: allHolidayDetails,
      holidayTags: allHolidayTags,
    };
  };
}
