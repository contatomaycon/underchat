export function calculateBillingPeriodByDates(
  lastPaymentDate: string | null,
  nextPaymentDate: string | null
): 'monthly' | 'annual' | null {
  if (!lastPaymentDate || !nextPaymentDate) {
    return null;
  }

  const lastDate = new Date(lastPaymentDate);
  const nextDate = new Date(nextPaymentDate);
  const diffTime = nextDate.getTime() - lastDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 31) {
    return 'monthly';
  }

  if (diffDays <= 365) {
    return 'annual';
  }

  return null;
}
