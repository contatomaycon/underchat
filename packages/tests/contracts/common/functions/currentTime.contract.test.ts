const tzMock = jest.fn();

jest.mock('moment-timezone', () => ({
  __esModule: true,
  default: {
    tz: (...args: unknown[]) => tzMock(...args),
  },
}));

import { currentTime } from '@core/common/functions/currentTime';

describe('currentTime', () => {
  it('formats current datetime in Sao Paulo timezone', () => {
    tzMock.mockReturnValue({
      format: jest.fn(() => '2026-04-21 15:30:00'),
    });

    expect(currentTime()).toBe('2026-04-21 15:30:00');
    expect(tzMock).toHaveBeenCalledWith(expect.any(Date), 'America/Sao_Paulo');
  });
});
