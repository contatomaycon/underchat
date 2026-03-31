export interface IPlanAccountRenewal {
  plan_account_id: string;
  account_id: string;
  plan_id: string;
  billing_period_id: string | null;
  value: string;
  last_payment_date: string | null;
  next_payment_date: string;
  plan: {
    plan_id: string;
    name: string;
    price: string;
    price_old: string;
    description: string | null;
    annual_discount: string | null;
    icon: string | null;
    is_test: boolean;
    days_trial: number | null;
  };
  cross_sells: Array<{
    plan_cross_sell_id: string;
    plan_cross_sell_account_id: string;
    quantity: number;
    price: string;
  }>;
}
