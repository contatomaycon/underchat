export interface IExpiredAccountBucket {
  account_id: string;
  plan_account_id: string;
  plan_id: string;
  is_test: boolean;
  next_payment_date: string;
}
