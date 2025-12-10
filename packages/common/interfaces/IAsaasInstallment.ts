import {
  IAsaasPaymentDiscount,
  IAsaasPaymentInterest,
  IAsaasPaymentFine,
  IAsaasCreditCardRequest,
  IAsaasCreditCardHolderInfo,
  PaymentStatus,
  IListAsaasPaymentsResponse,
} from './IAsaasPayment';

export type InstallmentBillingType =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'PIX';

export interface IAsaasInstallmentSplitRequest {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  totalFixedValue?: number;
  externalReference?: string;
  description?: string;
  installmentNumber?: number;
}

export interface ICreateAsaasInstallmentRequest {
  installmentCount: number;
  customer: string;
  value: number;
  totalValue?: number;
  billingType: InstallmentBillingType;
  dueDate: string;
  description?: string;
  postalService?: boolean;
  daysAfterDueDateToRegistrationCancellation?: number;
  paymentExternalReference?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  splits?: IAsaasInstallmentSplitRequest[];
}

export type InstallmentBillingTypeResponse =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'TRANSFER'
  | 'DEPOSIT'
  | 'PIX';

export interface IAsaasInstallmentCreditCard {
  creditCardNumber?: string;
  creditCardBrand?: string;
  creditCardToken?: string;
}

export type ChargebackStatus =
  | 'REQUESTED'
  | 'IN_DISPUTE'
  | 'DISPUTE_LOST'
  | 'REVERSED'
  | 'DONE';

export type ChargebackReason =
  | 'ABSENCE_OF_PRINT'
  | 'ABSENT_CARD_FRAUD'
  | 'CARD_ACTIVATED_PHONE_TRANSACTION'
  | 'CARD_FRAUD'
  | 'CARD_RECOVERY_BULLETIN'
  | 'COMMERCIAL_DISAGREEMENT'
  | 'COPY_NOT_RECEIVED'
  | 'CREDIT_OR_DEBIT_PRESENTATION_ERROR'
  | 'DIFFERENT_PAY_METHOD'
  | 'FRAUD'
  | 'INCORRECT_TRANSACTION_VALUE'
  | 'INVALID_CURRENCY'
  | 'INVALID_DATA'
  | 'LATE_PRESENTATION'
  | 'LOCAL_REGULATORY_OR_LEGAL_DISPUTE'
  | 'MULTIPLE_ROCS'
  | 'ORIGINAL_CREDIT_TRANSACTION_NOT_ACCEPTED'
  | 'OTHER_ABSENT_CARD_FRAUD'
  | 'PROCESS_ERROR'
  | 'RECEIVED_COPY_ILLEGIBLE_OR_INCOMPLETE'
  | 'RECURRENCE_CANCELED'
  | 'REQUIRED_AUTHORIZATION_NOT_GRANTED'
  | 'RIGHT_OF_FULL_RECOURSE_FOR_FRAUD'
  | 'SALE_CANCELED'
  | 'SERVICE_DISAGREEMENT_OR_DEFECTIVE_PRODUCT'
  | 'SERVICE_NOT_RECEIVED'
  | 'SPLIT_SALE'
  | 'TRANSFERS_OF_DIVERSE_RESPONSIBILITIES'
  | 'UNQUALIFIED_CAR_RENTAL_DEBIT'
  | 'USA_CARDHOLDER_DISPUTE'
  | 'VISA_FRAUD_MONITORING_PROGRAM'
  | 'WARNING_BULLETIN_FILE';

export type ChargebackDisputeStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED';

export type CreditCardBrand =
  | 'VISA'
  | 'MASTERCARD'
  | 'ELO'
  | 'DINERS'
  | 'DISCOVER'
  | 'AMEX'
  | 'CABAL'
  | 'BANESCARD'
  | 'CREDZ'
  | 'SOROCRED'
  | 'CREDSYSTEM'
  | 'JCB'
  | 'UNKNOWN';

export interface IAsaasChargebackCreditCard {
  number?: string;
  brand?: CreditCardBrand;
}

export interface IAsaasChargeback {
  id: string;
  payment: string;
  installment: string;
  customerAccount: string;
  status: ChargebackStatus;
  reason: ChargebackReason;
  disputeStartDate: string;
  value: number;
  paymentDate: string;
  creditCard?: IAsaasChargebackCreditCard;
  disputeStatus: ChargebackDisputeStatus;
  deadlineToSendDisputeDocuments: string;
}

export type InstallmentRefundStatus =
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

export interface IAsaasInstallmentRefund {
  dateCreated: string;
  status: InstallmentRefundStatus;
  value: number;
  endToEndIdentifier?: string;
  description?: string;
  effectiveDate?: string;
  transactionReceiptUrl?: string;
  refundedSplits?: IAsaasRefundedSplit[];
  paymentId: string;
}

export interface ICreateAsaasInstallmentResponse {
  object: string;
  id: string;
  value: number;
  netValue: number;
  paymentValue: number;
  installmentCount: number;
  billingType: InstallmentBillingTypeResponse;
  paymentDate?: string | null;
  description?: string;
  expirationDay: number;
  dateCreated: string;
  customer: string;
  paymentLink?: string;
  checkoutSession?: string;
  transactionReceiptUrl?: string | null;
  chargeback?: IAsaasChargeback;
  creditCard?: IAsaasInstallmentCreditCard;
  deleted: boolean;
  refunds?: IAsaasInstallmentRefund[];
}

export type IAsaasInstallmentItem = ICreateAsaasInstallmentResponse;

export interface IListAsaasInstallmentsRequest {
  offset?: number;
  limit?: number;
}

export interface IListAsaasInstallmentsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasInstallmentItem[];
}

export interface ICreateAsaasInstallmentWithCreditCardRequest {
  installmentCount: number;
  customer: string;
  value: number;
  totalValue?: number;
  billingType: InstallmentBillingType;
  dueDate: string;
  description?: string;
  postalService?: boolean;
  daysAfterDueDateToRegistrationCancellation?: number;
  paymentExternalReference?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  splits?: IAsaasInstallmentSplitRequest[];
  creditCard?: IAsaasCreditCardRequest;
  creditCardHolderInfo?: IAsaasCreditCardHolderInfo;
  creditCardToken?: string;
  authorizeOnly?: boolean;
  remoteIp: string;
}

export type ICreateAsaasInstallmentWithCreditCardResponse =
  ICreateAsaasInstallmentResponse;

export interface IDeleteAsaasInstallmentResponse {
  deleted: boolean;
  id: string;
}

export interface IListAsaasInstallmentPaymentsRequest {
  status?: PaymentStatus;
}

export type IListAsaasInstallmentPaymentsResponse = IListAsaasPaymentsResponse;

export type PaymentBookOrder = 'asc' | 'desc';

export interface IGetAsaasInstallmentPaymentBookRequest {
  sort?: string;
  order?: PaymentBookOrder;
}

export type InstallmentSplitCancellationReason =
  | 'PAYMENT_DELETED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_RECEIVED_IN_CASH'
  | 'PAYMENT_REFUNDED'
  | 'VALUE_DIVERGENCE_BLOCK'
  | 'WALLET_UNABLE_TO_RECEIVE';

export type InstallmentSplitStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROCESSING_REFUND'
  | 'AWAITING_CREDIT'
  | 'CANCELLED'
  | 'DONE'
  | 'REFUNDED'
  | 'BLOCKED_BY_VALUE_DIVERGENCE';

export interface IAsaasInstallmentSplitResponse {
  id: string;
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  totalValue?: number;
  cancellationReason?: InstallmentSplitCancellationReason;
  status?: InstallmentSplitStatus;
  externalReference?: string;
  description?: string;
  installmentNumber?: number;
}

export interface IUpdateAsaasInstallmentSplitsRequest {
  splits: IAsaasInstallmentSplitRequest[];
}

export interface IUpdateAsaasInstallmentSplitsResponse {
  splits: IAsaasInstallmentSplitResponse[];
}

export interface IAsaasInstallmentSplitRefundRequest {
  id: string;
  value: number;
}

export interface IRefundAsaasInstallmentRequest {
  value?: number;
  splitRefunds?: IAsaasInstallmentSplitRefundRequest[];
}

export type IRefundAsaasInstallmentResponse = ICreateAsaasInstallmentResponse;
