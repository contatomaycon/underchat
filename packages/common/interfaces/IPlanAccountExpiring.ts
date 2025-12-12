export interface IPlanAccountExpiring {
  plan_account_id: string;
  account_id: string;
  next_payment_date: string | null;
  days_until_expiration: number;
}
