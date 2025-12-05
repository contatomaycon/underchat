export type PaymentRefundStatus =
  | 'PENDING'
  | 'AWAITING_CRITICAL_ACTION_AUTHORIZATION'
  | 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION'
  | 'CANCELLED'
  | 'DONE';

export interface IAsaasRefundedSplit {
  id: string;
  value: number;
  done: boolean;
}

export interface IAsaasPaymentRefund {
  dateCreated: string;
  status: PaymentRefundStatus;
  value: number;
  endToEndIdentifier?: string;
  description?: string;
  effectiveDate?: string;
  transactionReceiptUrl?: string;
  refundedSplits?: IAsaasRefundedSplit[];
}

export interface IListAsaasPaymentRefundsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasPaymentRefund[];
}

export interface IRefundAsaasBankSlipResponse {
  requestUrl: string;
}

export interface IAsaasPaymentSplitRefundRequest {
  id: string;
  value: number;
}

export interface IRefundAsaasPaymentRequest {
  value?: number;
  description?: string;
  splitRefunds?: IAsaasPaymentSplitRefundRequest[];
}

export type PaymentLeanBillingType =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'TRANSFER'
  | 'DEPOSIT'
  | 'PIX';

export type PaymentLeanStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS';

export interface IAsaasPaymentLeanDiscount {
  value: number;
  dueDateLimitDays: number;
  type: 'FIXED' | 'PERCENTAGE';
}

export interface IAsaasPaymentLeanFine {
  value: number;
}

export interface IAsaasPaymentLeanInterest {
  value: number;
}

export interface IRefundAsaasPaymentLeanResponse {
  object: string;
  id: string;
  dateCreated: string;
  customerId: string;
  subscriptionId?: string;
  installmentId?: string;
  paymentLinkId?: string;
  value: number;
  netValue: number;
  originalValue?: number;
  interestValue?: number;
  description?: string;
  billingType: PaymentLeanBillingType;
  canBePaidAfterDueDate?: boolean;
  confirmedDate?: string;
  pixTransactionId?: string;
  status: PaymentLeanStatus;
  dueDate: string;
  originalDueDate?: string;
  paymentDate?: string;
  customerPaymentDate?: string;
  installmentNumber?: number;
  externalReference?: string;
  deleted: boolean;
  anticipated: boolean;
  anticipable: boolean;
  creditDate?: string;
  transactionReceiptUrl?: string;
  duplicatedPaymentId?: string;
  discount?: IAsaasPaymentLeanDiscount;
  fine?: IAsaasPaymentLeanFine;
  interest?: IAsaasPaymentLeanInterest;
  postalService?: boolean;
}
