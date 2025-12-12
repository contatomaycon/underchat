export interface IPlanAccountWithCancellation {
  plan_account_id: string;
  cancellation_date: string | null;
  next_payment_date: string | null;
  account_status_id: string;
}
