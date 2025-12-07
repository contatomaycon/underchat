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
