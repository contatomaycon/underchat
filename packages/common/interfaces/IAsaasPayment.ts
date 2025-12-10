export type PaymentBillingType = 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';

export type PaymentDiscountType = 'FIXED' | 'PERCENTAGE';

export type PaymentFineType = 'FIXED' | 'PERCENTAGE';

export interface IAsaasPaymentDiscount {
  value: number;
  dueDateLimitDays: number;
  type: PaymentDiscountType;
}

export interface IAsaasPaymentInterest {
  value: number;
}

export interface IAsaasPaymentFine {
  value: number;
  type: PaymentFineType;
}

export interface IAsaasPaymentSplitRequest {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  totalFixedValue?: number;
  externalReference?: string;
  description?: string;
}

export interface IAsaasPaymentCallback {
  successUrl: string;
  autoRedirect?: boolean;
}

export interface ICreateAsaasPaymentRequest {
  customer: string;
  billingType: PaymentBillingType;
  value: number;
  dueDate: string;
  description?: string;
  daysAfterDueDateToRegistrationCancellation?: number;
  externalReference?: string;
  installmentCount?: number;
  totalValue?: number;
  installmentValue?: number;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  postalService?: boolean;
  split?: IAsaasPaymentSplitRequest[];
  callback?: IAsaasPaymentCallback;
}

export interface IUpdateAsaasPaymentRequest {
  billingType: PaymentBillingType;
  value: number;
  dueDate: string;
  description?: string;
  daysAfterDueDateToRegistrationCancellation?: number;
  externalReference?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  postalService?: boolean;
  split?: IAsaasPaymentSplitRequest[];
  callback?: IAsaasPaymentCallback;
}

export type IUpdateAsaasPaymentResponse = ICreateAsaasPaymentResponse;

export interface IDeleteAsaasPaymentResponse {
  deleted: boolean;
  id: string;
}

export interface IGetAsaasPaymentStatusResponse {
  status: PaymentStatus;
}

export interface IGetAsaasPaymentIdentificationFieldResponse {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
}

export interface IGetAsaasPaymentPixQrCodeResponse {
  encodedImage: string;
  payload: string;
  expirationDate: string;
  description?: string;
}

export type PaymentDocumentType =
  | 'INVOICE'
  | 'CONTRACT'
  | 'MEDIA'
  | 'DOCUMENT'
  | 'SPREADSHEET'
  | 'PROGRAM'
  | 'OTHER';

export interface IAsaasPaymentDocumentFile {
  publicId: string;
  originalName: string;
  size: number;
  extension: string;
  previewUrl: string;
  downloadUrl: string;
}

export interface IUploadAsaasPaymentDocumentRequest {
  file: File | Blob;
  type: PaymentDocumentType;
  availableAfterPayment: boolean;
}

export interface IUpdateAsaasPaymentDocumentRequest {
  type: PaymentDocumentType;
  availableAfterPayment: boolean;
}

export interface IUploadAsaasPaymentDocumentResponse {
  object: string;
  id: string;
  name: string;
  type: PaymentDocumentType;
  availableAfterPayment: boolean;
  file: IAsaasPaymentDocumentFile;
  deleted: boolean;
}

export type IAsaasPaymentDocumentItem = IUploadAsaasPaymentDocumentResponse;

export interface IListAsaasPaymentDocumentsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasPaymentDocumentItem[];
}

export interface IDeleteAsaasPaymentDocumentResponse {
  deleted: boolean;
  id: string;
}

export interface IAsaasCreditCardRequest {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface IAsaasCreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  addressComplement?: string;
  phone: string;
  mobilePhone?: string;
}

export interface ICreateAsaasCreditCardPaymentRequest {
  customer: string;
  billingType: PaymentBillingType;
  value: number;
  dueDate: string;
  remoteIp: string;
  description?: string;
  daysAfterDueDateToRegistrationCancellation?: number;
  externalReference?: string;
  installmentCount?: number;
  totalValue?: number;
  installmentValue?: number;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  postalService?: boolean;
  split?: IAsaasPaymentSplitRequest[];
  callback?: IAsaasPaymentCallback;
  creditCard?: IAsaasCreditCardRequest;
  creditCardHolderInfo?: IAsaasCreditCardHolderInfo;
  creditCardToken?: string;
  authorizeOnly?: boolean;
}

export type ICreateAsaasCreditCardPaymentResponse = ICreateAsaasPaymentResponse;

export interface IPayAsaasPaymentWithCreditCardRequest {
  creditCard?: IAsaasCreditCardRequest;
  creditCardHolderInfo?: IAsaasCreditCardHolderInfo;
  creditCardToken?: string;
}

export type IPayAsaasPaymentWithCreditCardResponse =
  ICreateAsaasPaymentResponse;

export interface IAsaasPaymentPixBillingInfo {
  encodedImage: string;
  payload: string;
  expirationDate: string;
  description?: string;
}

export interface IAsaasPaymentCreditCardBillingInfo {
  creditCardNumber: string;
  creditCardBrand: string;
  creditCardToken?: string;
}

export interface IAsaasPaymentBankSlipBillingInfo {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
  bankSlipUrl: string;
  daysAfterDueDateToRegistrationCancellation?: number;
}

export interface IGetAsaasPaymentBillingInfoResponse {
  pix?: IAsaasPaymentPixBillingInfo;
  creditCard?: IAsaasPaymentCreditCardBillingInfo;
  bankSlip?: IAsaasPaymentBankSlipBillingInfo;
}

export interface IGetAsaasPaymentViewingInfoResponse {
  invoiceViewedDate?: string;
  boletoViewedDate?: string;
}

export type PaymentStatus =
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

export type PaymentBillingTypeResponse =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'TRANSFER'
  | 'DEPOSIT'
  | 'PIX';

export interface IAsaasPaymentCreditCard {
  creditCardNumber?: string;
  creditCardBrand?: string;
  creditCardToken?: string;
}

export interface IAsaasPaymentDiscountResponse {
  value: number;
  dueDateLimitDays: number;
  type: PaymentDiscountType;
}

export interface IAsaasPaymentFineResponse {
  value: number;
}

export interface IAsaasPaymentInterestResponse {
  value: number;
}

export type PaymentSplitCancellationReason =
  | 'PAYMENT_DELETED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_RECEIVED_IN_CASH'
  | 'PAYMENT_REFUNDED'
  | 'VALUE_DIVERGENCE_BLOCK'
  | 'WALLET_UNABLE_TO_RECEIVE';

export type PaymentSplitStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROCESSING_REFUND'
  | 'AWAITING_CREDIT'
  | 'CANCELLED'
  | 'DONE'
  | 'REFUNDED'
  | 'BLOCKED_BY_VALUE_DIVERGENCE';

export interface IAsaasPaymentSplitResponse {
  id: string;
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  totalValue?: number;
  cancellationReason?: PaymentSplitCancellationReason;
  status?: PaymentSplitStatus;
  externalReference?: string;
  description?: string;
}

export type EscrowStatus = 'ACTIVE' | 'DONE';

export type EscrowFinishReason =
  | 'CHARGEBACK'
  | 'EXPIRED'
  | 'INSUFFICIENT_BALANCE'
  | 'PAYMENT_REFUNDED'
  | 'REQUESTED_BY_CUSTOMER'
  | 'CUSTOMER_CONFIG_DISABLED';

export interface IAsaasPaymentEscrow {
  id: string;
  status: EscrowStatus;
  expirationDate?: string;
  finishDate?: string;
  finishReason?: EscrowFinishReason;
}

export type PaymentChargebackStatus =
  | 'REQUESTED'
  | 'IN_DISPUTE'
  | 'DISPUTE_LOST'
  | 'REVERSED'
  | 'DONE';

export type PaymentChargebackReason =
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

export type PaymentChargebackDisputeStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED';

export type PaymentCreditCardBrand =
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

export interface IAsaasPaymentChargebackCreditCard {
  number?: string;
  brand?: PaymentCreditCardBrand;
}

export interface IAsaasPaymentChargeback {
  id: string;
  payment: string;
  installment?: string | null;
  customerAccount: string;
  status: PaymentChargebackStatus;
  reason: PaymentChargebackReason;
  disputeStartDate: string;
  value: number;
  paymentDate: string;
  creditCard?: IAsaasPaymentChargebackCreditCard;
  disputeStatus: PaymentChargebackDisputeStatus;
  deadlineToSendDisputeDocuments: string;
}

export type PaymentRefundStatus =
  | 'PENDING'
  | 'AWAITING_CRITICAL_ACTION_AUTHORIZATION'
  | 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION'
  | 'CANCELLED'
  | 'DONE';

export interface IAsaasPaymentRefundedSplit {
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
  refundedSplits?: IAsaasPaymentRefundedSplit[];
}

export interface ICreateAsaasPaymentResponse {
  object: string;
  id: string;
  dateCreated: string;
  customer: string;
  subscription?: string | null;
  installment?: string | null;
  checkoutSession?: string;
  paymentLink?: string | null;
  value: number;
  netValue: number;
  originalValue?: number | null;
  interestValue?: number | null;
  description?: string;
  billingType: PaymentBillingTypeResponse;
  creditCard?: IAsaasPaymentCreditCard;
  canBePaidAfterDueDate?: boolean;
  pixTransaction?: string | null;
  pixQrCodeId?: string | null;
  status: PaymentStatus;
  dueDate: string;
  originalDueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  installmentNumber?: number | null;
  invoiceUrl: string;
  invoiceNumber: string;
  externalReference?: string;
  deleted: boolean;
  anticipated: boolean;
  anticipable: boolean;
  creditDate?: string;
  estimatedCreditDate?: string;
  transactionReceiptUrl?: string | null;
  nossoNumero?: string;
  bankSlipUrl?: string;
  discount?: IAsaasPaymentDiscountResponse;
  fine?: IAsaasPaymentFineResponse;
  interest?: IAsaasPaymentInterestResponse;
  split?: IAsaasPaymentSplitResponse[];
  postalService?: boolean;
  daysAfterDueDateToRegistrationCancellation?: number | null;
  chargeback?: IAsaasPaymentChargeback;
  escrow?: IAsaasPaymentEscrow;
  refunds?: IAsaasPaymentRefund[];
}

export type IRefundAsaasPaymentResponse = ICreateAsaasPaymentResponse;

export type IAsaasPaymentItem = ICreateAsaasPaymentResponse;

export type PaymentInvoiceStatus =
  | 'SCHEDULED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELED'
  | 'CANCELLATION_DENIED'
  | 'ERROR';

export interface IListAsaasPaymentsRequest {
  installment?: string;
  offset?: number;
  limit?: number;
  customer?: string;
  customerGroupName?: string;
  billingType?: PaymentBillingType;
  status?: PaymentStatus;
  subscription?: string;
  externalReference?: string;
  paymentDate?: string;
  invoiceStatus?: PaymentInvoiceStatus;
  estimatedCreditDate?: string;
  pixQrCodeId?: string;
  anticipated?: boolean;
  anticipable?: boolean;
  dateCreatedGe?: string;
  dateCreatedLe?: string;
  paymentDateGe?: string;
  paymentDateLe?: string;
  estimatedCreditDateGe?: string;
  estimatedCreditDateLe?: string;
  dueDateGe?: string;
  dueDateLe?: string;
  user?: string;
}

export interface IListAsaasPaymentsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasPaymentItem[];
}
