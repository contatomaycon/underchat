import { calculateBillingPeriodByDates } from '@core/common/functions/calculateBillingPeriodByDates';

describe('calculateBillingPeriodByDates', () => {
  it('returns null when any date is missing', () => {
    expect(calculateBillingPeriodByDates(null, '2026-01-01')).toBeNull();
    expect(calculateBillingPeriodByDates('2026-01-01', null)).toBeNull();
  });

  it('returns monthly when date difference is up to 31 days', () => {
    expect(calculateBillingPeriodByDates('2026-01-01', '2026-01-31')).toBe(
      'monthly'
    );
    expect(calculateBillingPeriodByDates('2026-01-01', '2026-02-01')).toBe(
      'monthly'
    );
  });

  it('returns annual when difference is greater than 31 and up to 365 days', () => {
    expect(calculateBillingPeriodByDates('2026-01-01', '2026-02-02')).toBe(
      'annual'
    );
    expect(calculateBillingPeriodByDates('2026-01-01', '2027-01-01')).toBe(
      'annual'
    );
  });

  it('returns null when difference is greater than 365 days', () => {
    expect(
      calculateBillingPeriodByDates('2026-01-01', '2027-01-02')
    ).toBeNull();
  });
});
