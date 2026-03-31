export interface IPlanReleaseReleasedPlanAccount {
  plan_account_id: string;
  plan_id: string;
  next_payment_date: string | null;
}

export interface IPlanReleaseUpdatePaymentStatusInput {
  accountPaymentId: string;
  paymentStatusId: string;
  paymentDate: string | null;
  pixTransaction: string | null;
  accountId: string;
  planId: string;
  recurringPayment: boolean;
  billingPeriodId: string | null;
  value: string;
  nextPaymentDate: string;
  releaseStatus?: string | null;
  releaseProcessedAt?: string | null;
  releaseLastError?: string | null;
}

export interface IPlanReleaseAddonOnlyPaymentInput {
  accountPaymentId: string;
  paymentStatusId: string;
  paymentDate: string;
  pixTransaction: string | null;
  accountId: string;
  planId: string;
  paymentAsaasId: string;
}

export interface IPlanReleasePaymentInput {
  accountPaymentId: string;
  paymentStatusId: string;
  paymentDate: string;
  pixTransaction: string | null;
  accountId: string;
  planId: string;
  recurringPayment: boolean;
  billingPeriodId: string | null;
  value: string;
  paymentAsaasId: string;
  shouldSendNotification?: boolean;
}

export interface IPlanReleaseCreditCardInput {
  accountPaymentId: string;
  accountId: string;
  planId: string;
  billingPeriodId: string | null;
  recurringPayment: boolean;
  value: string;
  paymentDate: string;
  paymentStatusId: string;
}

export interface IPlanReleaseCreateInvoiceOptions {
  skipGenerateInvoiceCheck?: boolean;
  useCurrentEffectiveDate?: boolean;
}

export interface IPlanReleaseAccountPaymentData {
  account_payment_id: string;
  account_id: string;
  plan_id: string;
  billing_period_id: string | null;
  recurring_payment: boolean;
  is_addon_only: boolean;
  value: string;
  payment_date: string | null;
  payment_status_id: string;
  release_status: string | null;
}
