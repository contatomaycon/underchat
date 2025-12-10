export interface IPlanAccountCancellationData {
  account_payment_id: string | null;
  billing: string | null;
  last_payment_date: string | null;
}

export interface IPlanAccountCancellationResult {
  isWithin7Days: boolean;
  cancellationDate: string;
  shouldCancelNextPayment: boolean;
  asaasActions: {
    paymentRefunded: boolean;
    subscriptionCancelled: boolean;
    invoiceCancelled: boolean;
  };
}

export interface IPlanAccountCancellationResponse {
  success: boolean;
  message: string;
}

export interface IPlanAccountWithPayment {
  plan_account_id: string;
  account_id: string;
  account_payment_id: string | null;
  last_payment_date: string | null;
  next_payment_date: string | null;
  cancellation_date: string | null;
  apy: {
    account_payment_id: string;
    billing: string | null;
    recurring_payment: boolean;
  } | null;
}

export type CancellationType = 'payment' | 'subscription' | 'invoice';
