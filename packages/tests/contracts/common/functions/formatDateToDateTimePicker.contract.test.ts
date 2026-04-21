import { formatDateToDateTimePicker } from '@core/common/functions/formatDateToDateTimePicker';

describe('formatDateToDateTimePicker', () => {
  it('returns null for empty or invalid values', () => {
    expect(formatDateToDateTimePicker(null)).toBeNull();
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      expect(formatDateToDateTimePicker('invalid-date')).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns formatted value for valid date', () => {
    expect(formatDateToDateTimePicker('2026-04-21T15:30:00.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
  });
});
