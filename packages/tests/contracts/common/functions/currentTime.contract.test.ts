const tzMock = jest.fn();

jest.mock('moment-timezone', () => ({
  __esModule: true,
  default: {
    tz: (...args: unknown[]) => tzMock(...args),
  },
}));

import { currentTime } from '@core/common/functions/currentTime';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

describe('currentTime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('formats current datetime in Sao Paulo timezone with explicit offset', () => {
    const formatMock = jest.fn(() => '2026-04-21T15:30:00.000-03:00');

    tzMock.mockReturnValue({
      format: formatMock,
    });

    expect(currentTime()).toBe('2026-04-21T15:30:00.000-03:00');
    expect(tzMock).toHaveBeenCalledWith(expect.any(Date), APP_TIMEZONE);
    expect(formatMock).toHaveBeenCalledWith('YYYY-MM-DDTHH:mm:ss.SSSZ');
  });
});
