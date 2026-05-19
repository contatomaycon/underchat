import 'reflect-metadata';
import { HolidayService } from './holiday.service';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'holiday-uuid'),
}));

const originalFetch = global.fetch;

describe('HolidayService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  const buildService = () => {
    const holidayLocalRepository = {
      listByAccountId: jest.fn(async () => []),
      listByDate: jest.fn(async () => []),
      create: jest.fn(async () => 'holiday-id'),
      update: jest.fn(async () => true),
      deleteById: jest.fn(async () => true),
      existsStateById: jest.fn(async () => true),
      viewCityById: jest.fn(async () => ({
        id_zipcode_city: 'city-1',
        id_zipcode_state: 'state-1',
      })),
    };

    const redis = {
      get: jest.fn<Promise<string | null>, [string]>(async () => null),
      set: jest.fn<Promise<string>, [string, string, 'EX', number]>(
        async () => 'OK'
      ),
      del: jest.fn<Promise<number>, [string]>(async () => 1),
    };

    const service = new HolidayService(
      holidayLocalRepository as never,
      redis as never
    );

    return {
      service,
      holidayLocalRepository,
      redis,
    };
  };

  it('merges national and local holidays and returns all tags for the same date', async () => {
    const deps = buildService();

    (deps.holidayLocalRepository.listByDate as jest.Mock).mockResolvedValue([
      {
        chatbot_holiday_id: 'l1',
        scope: 'state',
        name: 'Aniversário da Cidade',
        month: 9,
        day: 7,
        state_id: 'state-1',
        city_id: null,
      },
    ]);

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [
        {
          date: '2026-09-07',
          name: 'Independência do Brasil',
          type: 'national',
          weekday: 'monday',
        },
        {
          date: '2026-09-07',
          name: 'Nossa Senhora',
          type: 'national',
          weekday: 'monday',
        },
      ],
    })) as unknown as typeof fetch;

    const result = await deps.service.resolveHolidaysForDate(
      'account-1',
      new Date('2026-09-07T12:00:00.000Z')
    );

    expect(result.isHoliday).toBe(true);
    expect(result.holidayNames).toEqual([
      'Independência do Brasil',
      'Nossa Senhora',
      'Aniversário da Cidade',
    ]);
    expect(result.holidayDetails).toEqual([
      {
        name: 'Independência do Brasil',
        type: 'national',
      },
      {
        name: 'Nossa Senhora',
        type: 'national',
      },
      {
        name: 'Aniversário da Cidade',
        type: 'state',
      },
    ]);
    expect(result.holidayTags).toEqual(
      expect.arrayContaining([
        '#feriado',
        '#independencia_do_brasil',
        '#nossa_senhora',
        '#aniversario_da_cidade',
      ])
    );
  });

  it('returns cached national holidays when cache exists', async () => {
    const deps = buildService();

    deps.redis.get.mockResolvedValue(
      JSON.stringify([
        {
          date: '2026-01-01',
          name: 'Confraternização Universal',
          type: 'national',
          weekday: 'thursday',
        },
      ])
    );

    global.fetch = jest.fn(async () => {
      throw new Error('should not fetch when cache exists');
    }) as unknown as typeof fetch;

    const result = await deps.service.listNationalHolidays(2026);

    expect(result).toEqual([
      {
        date: '2026-01-01',
        name: 'Confraternização Universal',
        type: 'national',
        weekday: 'thursday',
      },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to empty list when BrasilAPI fails and cache is empty', async () => {
    const deps = buildService();

    deps.redis.get.mockResolvedValue(null);
    global.fetch = jest.fn(async () => {
      throw new Error('network unavailable');
    }) as unknown as typeof fetch;

    const result = await deps.service.listNationalHolidays(2026);

    expect(result).toEqual([]);
  });
});
