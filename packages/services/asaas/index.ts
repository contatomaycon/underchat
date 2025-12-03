import { injectable } from 'tsyringe';
import {
  CreateCustomerService,
  ListCustomersService,
  GetCustomerService,
  UpdateCustomerService,
  DeleteCustomerService,
  RestoreCustomerService,
  GetCustomerNotificationsService,
} from './clients';
import {
  CreatePaymentService,
  CreateCreditCardPaymentService,
  CaptureAuthorizedPaymentService,
  PayWithCreditCardService,
  GetPaymentService,
  UpdatePaymentService,
  DeletePaymentService,
  RestorePaymentService,
  GetPaymentStatusService,
  GetPaymentIdentificationFieldService,
  GetPaymentPixQrCodeService,
  GetPaymentBillingInfoService,
  GetPaymentViewingInfoService,
  ListPaymentsService,
  UploadPaymentDocumentService,
  ListPaymentDocumentsService,
  GetPaymentDocumentService,
  UpdatePaymentDocumentService,
  DeletePaymentDocumentService,
} from './payments';
import {
  CreateInstallmentService,
  CreateInstallmentWithCreditCardService,
  GetInstallmentService,
  DeleteInstallmentService,
  ListInstallmentsService,
  ListInstallmentPaymentsService,
  GetInstallmentPaymentBookService,
  UpdateInstallmentSplitsService,
  RefundInstallmentService,
} from './installments';
import {
  CreateSubscriptionService,
  CreateSubscriptionWithCreditCardService,
  GetSubscriptionService,
  UpdateSubscriptionService,
  UpdateSubscriptionCreditCardService,
  DeleteSubscriptionService,
  ListSubscriptionsService,
  ListSubscriptionPaymentsService,
  GetSubscriptionPaymentBookService,
  CreateSubscriptionInvoiceSettingsService,
  GetSubscriptionInvoiceSettingsService,
  UpdateSubscriptionInvoiceSettingsService,
  DeleteSubscriptionInvoiceSettingsService,
  ListSubscriptionInvoicesService,
} from './subscriptions';
import {
  CreatePaymentLinkService,
  ListPaymentLinksService,
  GetPaymentLinkService,
  UpdatePaymentLinkService,
  DeletePaymentLinkService,
  RestorePaymentLinkService,
  UploadPaymentLinkImageService,
  ListPaymentLinkImagesService,
  GetPaymentLinkImageService,
  DeletePaymentLinkImageService,
  SetPaymentLinkImageAsMainService,
} from './paymentLinks';
import { CreateCheckoutService, CancelCheckoutService } from './checkout';
import { TokenizeCreditCardService } from './creditCard';
import {
  ListPaymentRefundsService,
  RefundBankSlipService,
  RefundPaymentLeanService,
  RefundPaymentService,
} from './refunds';
import {
  CreateInvoiceService,
  ListInvoicesService,
  UpdateInvoiceService,
  GetInvoiceService,
  AuthorizeInvoiceService,
  CancelInvoiceService,
} from './invoices';
import {
  ICreateAsaasCustomerRequest,
  ICreateAsaasCustomerResponse,
  IListAsaasCustomersRequest,
  IListAsaasCustomersResponse,
  IGetAsaasCustomerResponse,
  IUpdateAsaasCustomerRequest,
  IUpdateAsaasCustomerResponse,
  IDeleteAsaasCustomerResponse,
  IRestoreAsaasCustomerResponse,
  IListAsaasCustomerNotificationsResponse,
} from '@core/common/interfaces/IAsaasCustomer';
import {
  ICreateAsaasPaymentRequest,
  ICreateAsaasPaymentResponse,
  ICreateAsaasCreditCardPaymentRequest,
  ICreateAsaasCreditCardPaymentResponse,
  IPayAsaasPaymentWithCreditCardRequest,
  IPayAsaasPaymentWithCreditCardResponse,
  IUpdateAsaasPaymentRequest,
  IUpdateAsaasPaymentResponse,
  IDeleteAsaasPaymentResponse,
  IGetAsaasPaymentStatusResponse,
  IGetAsaasPaymentIdentificationFieldResponse,
  IGetAsaasPaymentPixQrCodeResponse,
  IGetAsaasPaymentBillingInfoResponse,
  IGetAsaasPaymentViewingInfoResponse,
  IListAsaasPaymentsRequest,
  IListAsaasPaymentsResponse,
  IUploadAsaasPaymentDocumentRequest,
  IUploadAsaasPaymentDocumentResponse,
  IUpdateAsaasPaymentDocumentRequest,
  IDeleteAsaasPaymentDocumentResponse,
  IListAsaasPaymentDocumentsResponse,
  IRefundAsaasPaymentResponse,
} from '@core/common/interfaces/IAsaasPayment';
import {
  ICreateAsaasInstallmentRequest,
  ICreateAsaasInstallmentResponse,
  ICreateAsaasInstallmentWithCreditCardRequest,
  ICreateAsaasInstallmentWithCreditCardResponse,
  IDeleteAsaasInstallmentResponse,
  IListAsaasInstallmentsRequest,
  IListAsaasInstallmentsResponse,
  IListAsaasInstallmentPaymentsRequest,
  IListAsaasInstallmentPaymentsResponse,
  IGetAsaasInstallmentPaymentBookRequest,
  IUpdateAsaasInstallmentSplitsRequest,
  IUpdateAsaasInstallmentSplitsResponse,
  IRefundAsaasInstallmentRequest,
  IRefundAsaasInstallmentResponse,
} from '@core/common/interfaces/IAsaasInstallment';
import {
  ICreateAsaasSubscriptionRequest,
  ICreateAsaasSubscriptionResponse,
  ICreateAsaasSubscriptionWithCreditCardRequest,
  ICreateAsaasSubscriptionWithCreditCardResponse,
  IUpdateAsaasSubscriptionRequest,
  IUpdateAsaasSubscriptionResponse,
  IUpdateAsaasSubscriptionCreditCardRequest,
  IUpdateAsaasSubscriptionCreditCardResponse,
  IDeleteAsaasSubscriptionResponse,
  IListAsaasSubscriptionsRequest,
  IListAsaasSubscriptionsResponse,
  IListAsaasSubscriptionPaymentsRequest,
  IListAsaasSubscriptionPaymentsResponse,
  IGetAsaasSubscriptionPaymentBookRequest,
  ICreateAsaasSubscriptionInvoiceSettingsRequest,
  ICreateAsaasSubscriptionInvoiceSettingsResponse,
  IUpdateAsaasSubscriptionInvoiceSettingsRequest,
  IUpdateAsaasSubscriptionInvoiceSettingsResponse,
  IDeleteAsaasSubscriptionInvoiceSettingsResponse,
  IListAsaasSubscriptionInvoicesRequest,
  IListAsaasSubscriptionInvoicesResponse,
} from '@core/common/interfaces/IAsaasSubscription';
import {
  ICreateAsaasPaymentLinkRequest,
  ICreateAsaasPaymentLinkResponse,
  IListAsaasPaymentLinksRequest,
  IListAsaasPaymentLinksResponse,
  IUpdateAsaasPaymentLinkRequest,
  IUpdateAsaasPaymentLinkResponse,
  IDeleteAsaasPaymentLinkResponse,
  IRestoreAsaasPaymentLinkResponse,
  IUploadAsaasPaymentLinkImageRequest,
  IUploadAsaasPaymentLinkImageResponse,
  IListAsaasPaymentLinkImagesResponse,
  IDeleteAsaasPaymentLinkImageResponse,
  ISetAsMainPaymentLinkImageResponse,
} from '@core/common/interfaces/IAsaasPaymentLink';
import {
  ICreateAsaasCheckoutRequest,
  ICreateAsaasCheckoutResponse,
} from '@core/common/interfaces/IAsaasCheckout';
import {
  ITokenizeAsaasCreditCardRequest,
  ITokenizeAsaasCreditCardResponse,
} from '@core/common/interfaces/IAsaasCreditCard';
import {
  IListAsaasPaymentRefundsResponse,
  IRefundAsaasBankSlipResponse,
  IRefundAsaasPaymentRequest,
  IRefundAsaasPaymentLeanResponse,
} from '@core/common/interfaces/IAsaasRefund';
import {
  ICreateAsaasInvoiceRequest,
  ICreateAsaasInvoiceResponse,
  IListAsaasInvoicesRequest,
  IListAsaasInvoicesResponse,
  IUpdateAsaasInvoiceRequest,
  IUpdateAsaasInvoiceResponse,
  IGetAsaasInvoiceResponse,
  IAuthorizeAsaasInvoiceResponse,
  ICancelAsaasInvoiceRequest,
  ICancelAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';

@injectable()
export class AsaasService {
  constructor(
    private readonly createCustomerService: CreateCustomerService,
    private readonly listCustomersService: ListCustomersService,
    private readonly getCustomerService: GetCustomerService,
    private readonly updateCustomerService: UpdateCustomerService,
    private readonly deleteCustomerService: DeleteCustomerService,
    private readonly restoreCustomerService: RestoreCustomerService,
    private readonly getCustomerNotificationsService: GetCustomerNotificationsService,
    private readonly createPaymentService: CreatePaymentService,
    private readonly createCreditCardPaymentService: CreateCreditCardPaymentService,
    private readonly captureAuthorizedPaymentService: CaptureAuthorizedPaymentService,
    private readonly payWithCreditCardService: PayWithCreditCardService,
    private readonly getPaymentService: GetPaymentService,
    private readonly updatePaymentService: UpdatePaymentService,
    private readonly deletePaymentService: DeletePaymentService,
    private readonly restorePaymentService: RestorePaymentService,
    private readonly getPaymentStatusService: GetPaymentStatusService,
    private readonly getPaymentIdentificationFieldService: GetPaymentIdentificationFieldService,
    private readonly getPaymentPixQrCodeService: GetPaymentPixQrCodeService,
    private readonly getPaymentBillingInfoService: GetPaymentBillingInfoService,
    private readonly getPaymentViewingInfoService: GetPaymentViewingInfoService,
    private readonly listPaymentsService: ListPaymentsService,
    private readonly uploadPaymentDocumentService: UploadPaymentDocumentService,
    private readonly listPaymentDocumentsService: ListPaymentDocumentsService,
    private readonly getPaymentDocumentService: GetPaymentDocumentService,
    private readonly updatePaymentDocumentService: UpdatePaymentDocumentService,
    private readonly deletePaymentDocumentService: DeletePaymentDocumentService,
    private readonly createInstallmentService: CreateInstallmentService,
    private readonly createInstallmentWithCreditCardService: CreateInstallmentWithCreditCardService,
    private readonly getInstallmentService: GetInstallmentService,
    private readonly deleteInstallmentService: DeleteInstallmentService,
    private readonly listInstallmentsService: ListInstallmentsService,
    private readonly listInstallmentPaymentsService: ListInstallmentPaymentsService,
    private readonly getInstallmentPaymentBookService: GetInstallmentPaymentBookService,
    private readonly updateInstallmentSplitsService: UpdateInstallmentSplitsService,
    private readonly refundInstallmentService: RefundInstallmentService,
    private readonly createSubscriptionService: CreateSubscriptionService,
    private readonly createSubscriptionWithCreditCardService: CreateSubscriptionWithCreditCardService,
    private readonly getSubscriptionService: GetSubscriptionService,
    private readonly updateSubscriptionService: UpdateSubscriptionService,
    private readonly updateSubscriptionCreditCardService: UpdateSubscriptionCreditCardService,
    private readonly deleteSubscriptionService: DeleteSubscriptionService,
    private readonly listSubscriptionsService: ListSubscriptionsService,
    private readonly listSubscriptionPaymentsService: ListSubscriptionPaymentsService,
    private readonly getSubscriptionPaymentBookService: GetSubscriptionPaymentBookService,
    private readonly createSubscriptionInvoiceSettingsService: CreateSubscriptionInvoiceSettingsService,
    private readonly getSubscriptionInvoiceSettingsService: GetSubscriptionInvoiceSettingsService,
    private readonly updateSubscriptionInvoiceSettingsService: UpdateSubscriptionInvoiceSettingsService,
    private readonly deleteSubscriptionInvoiceSettingsService: DeleteSubscriptionInvoiceSettingsService,
    private readonly listSubscriptionInvoicesService: ListSubscriptionInvoicesService,
    private readonly createPaymentLinkService: CreatePaymentLinkService,
    private readonly listPaymentLinksService: ListPaymentLinksService,
    private readonly getPaymentLinkService: GetPaymentLinkService,
    private readonly updatePaymentLinkService: UpdatePaymentLinkService,
    private readonly deletePaymentLinkService: DeletePaymentLinkService,
    private readonly restorePaymentLinkService: RestorePaymentLinkService,
    private readonly uploadPaymentLinkImageService: UploadPaymentLinkImageService,
    private readonly listPaymentLinkImagesService: ListPaymentLinkImagesService,
    private readonly getPaymentLinkImageService: GetPaymentLinkImageService,
    private readonly deletePaymentLinkImageService: DeletePaymentLinkImageService,
    private readonly setPaymentLinkImageAsMainService: SetPaymentLinkImageAsMainService,
    private readonly createCheckoutService: CreateCheckoutService,
    private readonly cancelCheckoutService: CancelCheckoutService,
    private readonly tokenizeCreditCardService: TokenizeCreditCardService,
    private readonly listPaymentRefundsService: ListPaymentRefundsService,
    private readonly refundBankSlipService: RefundBankSlipService,
    private readonly refundPaymentLeanService: RefundPaymentLeanService,
    private readonly refundPaymentService: RefundPaymentService,
    private readonly createInvoiceService: CreateInvoiceService,
    private readonly listInvoicesService: ListInvoicesService,
    private readonly updateInvoiceService: UpdateInvoiceService,
    private readonly getInvoiceService: GetInvoiceService,
    private readonly authorizeInvoiceService: AuthorizeInvoiceService,
    private readonly cancelInvoiceService: CancelInvoiceService
  ) {}

  createCustomer = async (
    request: ICreateAsaasCustomerRequest
  ): Promise<ICreateAsaasCustomerResponse | null> => {
    return this.createCustomerService.createCustomer(request);
  };

  listCustomers = async (
    request?: IListAsaasCustomersRequest
  ): Promise<IListAsaasCustomersResponse | null> => {
    return this.listCustomersService.listCustomers(request);
  };

  getCustomer = async (
    customerId: string
  ): Promise<IGetAsaasCustomerResponse | null> => {
    return this.getCustomerService.getCustomer(customerId);
  };

  updateCustomer = async (
    customerId: string,
    request: IUpdateAsaasCustomerRequest
  ): Promise<IUpdateAsaasCustomerResponse | null> => {
    return this.updateCustomerService.updateCustomer(customerId, request);
  };

  deleteCustomer = async (
    customerId: string
  ): Promise<IDeleteAsaasCustomerResponse | null> => {
    return this.deleteCustomerService.deleteCustomer(customerId);
  };

  restoreCustomer = async (
    customerId: string
  ): Promise<IRestoreAsaasCustomerResponse | null> => {
    return this.restoreCustomerService.restoreCustomer(customerId);
  };

  getCustomerNotifications = async (
    customerId: string
  ): Promise<IListAsaasCustomerNotificationsResponse | null> => {
    return this.getCustomerNotificationsService.getCustomerNotifications(
      customerId
    );
  };

  createPayment = async (
    request: ICreateAsaasPaymentRequest
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.createPaymentService.createPayment(request);
  };

  createCreditCardPayment = async (
    request: ICreateAsaasCreditCardPaymentRequest
  ): Promise<ICreateAsaasCreditCardPaymentResponse | null> => {
    return this.createCreditCardPaymentService.createCreditCardPayment(request);
  };

  captureAuthorizedPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.captureAuthorizedPaymentService.captureAuthorizedPayment(
      paymentId
    );
  };

  payWithCreditCard = async (
    paymentId: string,
    request: IPayAsaasPaymentWithCreditCardRequest
  ): Promise<IPayAsaasPaymentWithCreditCardResponse | null> => {
    return this.payWithCreditCardService.payWithCreditCard(paymentId, request);
  };

  getPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.getPaymentService.getPayment(paymentId);
  };

  updatePayment = async (
    paymentId: string,
    request: IUpdateAsaasPaymentRequest
  ): Promise<IUpdateAsaasPaymentResponse | null> => {
    return this.updatePaymentService.updatePayment(paymentId, request);
  };

  deletePayment = async (
    paymentId: string
  ): Promise<IDeleteAsaasPaymentResponse | null> => {
    return this.deletePaymentService.deletePayment(paymentId);
  };

  restorePayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.restorePaymentService.restorePayment(paymentId);
  };

  getPaymentStatus = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentStatusResponse | null> => {
    return this.getPaymentStatusService.getPaymentStatus(paymentId);
  };

  getPaymentIdentificationField = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentIdentificationFieldResponse | null> => {
    return this.getPaymentIdentificationFieldService.getPaymentIdentificationField(
      paymentId
    );
  };

  getPaymentPixQrCode = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentPixQrCodeResponse | null> => {
    return this.getPaymentPixQrCodeService.getPaymentPixQrCode(paymentId);
  };

  getPaymentBillingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentBillingInfoResponse | null> => {
    return this.getPaymentBillingInfoService.getPaymentBillingInfo(paymentId);
  };

  getPaymentViewingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentViewingInfoResponse | null> => {
    return this.getPaymentViewingInfoService.getPaymentViewingInfo(paymentId);
  };

  listPayments = async (
    request?: IListAsaasPaymentsRequest
  ): Promise<IListAsaasPaymentsResponse | null> => {
    return this.listPaymentsService.listPayments(request);
  };

  uploadPaymentDocument = async (
    paymentId: string,
    request: IUploadAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.uploadPaymentDocumentService.uploadPaymentDocument(
      paymentId,
      request
    );
  };

  listPaymentDocuments = async (
    paymentId: string
  ): Promise<IListAsaasPaymentDocumentsResponse | null> => {
    return this.listPaymentDocumentsService.listPaymentDocuments(paymentId);
  };

  getPaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.getPaymentDocumentService.getPaymentDocument(
      paymentId,
      documentId
    );
  };

  updatePaymentDocument = async (
    paymentId: string,
    documentId: string,
    request: IUpdateAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.updatePaymentDocumentService.updatePaymentDocument(
      paymentId,
      documentId,
      request
    );
  };

  deletePaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IDeleteAsaasPaymentDocumentResponse | null> => {
    return this.deletePaymentDocumentService.deletePaymentDocument(
      paymentId,
      documentId
    );
  };

  createInstallment = async (
    request: ICreateAsaasInstallmentRequest
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    return this.createInstallmentService.createInstallment(request);
  };

  createInstallmentWithCreditCard = async (
    request: ICreateAsaasInstallmentWithCreditCardRequest
  ): Promise<ICreateAsaasInstallmentWithCreditCardResponse | null> => {
    return this.createInstallmentWithCreditCardService.createInstallmentWithCreditCard(
      request
    );
  };

  getInstallment = async (
    installmentId: string
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    return this.getInstallmentService.getInstallment(installmentId);
  };

  deleteInstallment = async (
    installmentId: string
  ): Promise<IDeleteAsaasInstallmentResponse | null> => {
    return this.deleteInstallmentService.deleteInstallment(installmentId);
  };

  listInstallments = async (
    request?: IListAsaasInstallmentsRequest
  ): Promise<IListAsaasInstallmentsResponse | null> => {
    return this.listInstallmentsService.listInstallments(request);
  };

  listInstallmentPayments = async (
    installmentId: string,
    request?: IListAsaasInstallmentPaymentsRequest
  ): Promise<IListAsaasInstallmentPaymentsResponse | null> => {
    return this.listInstallmentPaymentsService.listInstallmentPayments(
      installmentId,
      request
    );
  };

  getInstallmentPaymentBook = async (
    installmentId: string,
    request?: IGetAsaasInstallmentPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    return this.getInstallmentPaymentBookService.getInstallmentPaymentBook(
      installmentId,
      request
    );
  };

  updateInstallmentSplits = async (
    installmentId: string,
    request: IUpdateAsaasInstallmentSplitsRequest
  ): Promise<IUpdateAsaasInstallmentSplitsResponse | null> => {
    return this.updateInstallmentSplitsService.updateInstallmentSplits(
      installmentId,
      request
    );
  };

  refundInstallment = async (
    installmentId: string,
    request?: IRefundAsaasInstallmentRequest
  ): Promise<IRefundAsaasInstallmentResponse | null> => {
    return this.refundInstallmentService.refundInstallment(
      installmentId,
      request
    );
  };

  createSubscription = async (
    request: ICreateAsaasSubscriptionRequest
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    return this.createSubscriptionService.createSubscription(request);
  };

  createSubscriptionWithCreditCard = async (
    request: ICreateAsaasSubscriptionWithCreditCardRequest
  ): Promise<ICreateAsaasSubscriptionWithCreditCardResponse | null> => {
    return this.createSubscriptionWithCreditCardService.createSubscriptionWithCreditCard(
      request
    );
  };

  getSubscription = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    return this.getSubscriptionService.getSubscription(subscriptionId);
  };

  updateSubscription = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionRequest
  ): Promise<IUpdateAsaasSubscriptionResponse | null> => {
    return this.updateSubscriptionService.updateSubscription(
      subscriptionId,
      request
    );
  };

  updateSubscriptionCreditCard = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionCreditCardRequest
  ): Promise<IUpdateAsaasSubscriptionCreditCardResponse | null> => {
    return this.updateSubscriptionCreditCardService.updateSubscriptionCreditCard(
      subscriptionId,
      request
    );
  };

  deleteSubscription = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionResponse | null> => {
    return this.deleteSubscriptionService.deleteSubscription(subscriptionId);
  };

  listSubscriptions = async (
    request?: IListAsaasSubscriptionsRequest
  ): Promise<IListAsaasSubscriptionsResponse | null> => {
    return this.listSubscriptionsService.listSubscriptions(request);
  };

  listSubscriptionPayments = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionPaymentsRequest
  ): Promise<IListAsaasSubscriptionPaymentsResponse | null> => {
    return this.listSubscriptionPaymentsService.listSubscriptionPayments(
      subscriptionId,
      request
    );
  };

  getSubscriptionPaymentBook = async (
    subscriptionId: string,
    request?: IGetAsaasSubscriptionPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    return this.getSubscriptionPaymentBookService.getSubscriptionPaymentBook(
      subscriptionId,
      request
    );
  };

  createSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: ICreateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.createSubscriptionInvoiceSettingsService.createSubscriptionInvoiceSettings(
      subscriptionId,
      request
    );
  };

  getSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.getSubscriptionInvoiceSettingsService.getSubscriptionInvoiceSettings(
      subscriptionId
    );
  };

  updateSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<IUpdateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.updateSubscriptionInvoiceSettingsService.updateSubscriptionInvoiceSettings(
      subscriptionId,
      request
    );
  };

  deleteSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.deleteSubscriptionInvoiceSettingsService.deleteSubscriptionInvoiceSettings(
      subscriptionId
    );
  };

  listSubscriptionInvoices = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionInvoicesRequest
  ): Promise<IListAsaasSubscriptionInvoicesResponse | null> => {
    return this.listSubscriptionInvoicesService.listSubscriptionInvoices(
      subscriptionId,
      request
    );
  };

  createPaymentLink = async (
    request: ICreateAsaasPaymentLinkRequest
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    return this.createPaymentLinkService.createPaymentLink(request);
  };

  listPaymentLinks = async (
    request?: IListAsaasPaymentLinksRequest
  ): Promise<IListAsaasPaymentLinksResponse | null> => {
    return this.listPaymentLinksService.listPaymentLinks(request);
  };

  getPaymentLink = async (
    paymentLinkId: string
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    return this.getPaymentLinkService.getPaymentLink(paymentLinkId);
  };

  updatePaymentLink = async (
    paymentLinkId: string,
    request: IUpdateAsaasPaymentLinkRequest
  ): Promise<IUpdateAsaasPaymentLinkResponse | null> => {
    return this.updatePaymentLinkService.updatePaymentLink(
      paymentLinkId,
      request
    );
  };

  deletePaymentLink = async (
    paymentLinkId: string
  ): Promise<IDeleteAsaasPaymentLinkResponse | null> => {
    return this.deletePaymentLinkService.deletePaymentLink(paymentLinkId);
  };

  restorePaymentLink = async (
    paymentLinkId: string
  ): Promise<IRestoreAsaasPaymentLinkResponse | null> => {
    return this.restorePaymentLinkService.restorePaymentLink(paymentLinkId);
  };

  uploadPaymentLinkImage = async (
    paymentLinkId: string,
    request: IUploadAsaasPaymentLinkImageRequest
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    return this.uploadPaymentLinkImageService.uploadPaymentLinkImage(
      paymentLinkId,
      request
    );
  };

  listPaymentLinkImages = async (
    paymentLinkId: string
  ): Promise<IListAsaasPaymentLinkImagesResponse | null> => {
    return this.listPaymentLinkImagesService.listPaymentLinkImages(
      paymentLinkId
    );
  };

  getPaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    return this.getPaymentLinkImageService.getPaymentLinkImage(
      paymentLinkId,
      imageId
    );
  };

  deletePaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IDeleteAsaasPaymentLinkImageResponse | null> => {
    return this.deletePaymentLinkImageService.deletePaymentLinkImage(
      paymentLinkId,
      imageId
    );
  };

  setPaymentLinkImageAsMain = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<ISetAsMainPaymentLinkImageResponse | null> => {
    return this.setPaymentLinkImageAsMainService.setPaymentLinkImageAsMain(
      paymentLinkId,
      imageId
    );
  };

  createCheckout = async (
    request: ICreateAsaasCheckoutRequest
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    return this.createCheckoutService.createCheckout(request);
  };

  cancelCheckout = async (
    checkoutId: string
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    return this.cancelCheckoutService.cancelCheckout(checkoutId);
  };

  tokenizeCreditCard = async (
    request: ITokenizeAsaasCreditCardRequest
  ): Promise<ITokenizeAsaasCreditCardResponse | null> => {
    return this.tokenizeCreditCardService.tokenizeCreditCard(request);
  };

  listPaymentRefunds = async (
    paymentId: string
  ): Promise<IListAsaasPaymentRefundsResponse | null> => {
    return this.listPaymentRefundsService.listPaymentRefunds(paymentId);
  };

  refundBankSlip = async (
    paymentId: string
  ): Promise<IRefundAsaasBankSlipResponse | null> => {
    return this.refundBankSlipService.refundBankSlip(paymentId);
  };

  refundPaymentLean = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentLeanResponse | null> => {
    return this.refundPaymentLeanService.refundPaymentLean(paymentId, request);
  };

  refundPayment = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentResponse | null> => {
    return this.refundPaymentService.refundPayment(paymentId, request);
  };

  createInvoice = async (
    request: ICreateAsaasInvoiceRequest
  ): Promise<ICreateAsaasInvoiceResponse | null> => {
    return this.createInvoiceService.createInvoice(request);
  };

  listInvoices = async (
    request?: IListAsaasInvoicesRequest
  ): Promise<IListAsaasInvoicesResponse | null> => {
    return this.listInvoicesService.listInvoices(request);
  };

  updateInvoice = async (
    invoiceId: string,
    request: IUpdateAsaasInvoiceRequest
  ): Promise<IUpdateAsaasInvoiceResponse | null> => {
    return this.updateInvoiceService.updateInvoice(invoiceId, request);
  };

  getInvoice = async (
    invoiceId: string
  ): Promise<IGetAsaasInvoiceResponse | null> => {
    return this.getInvoiceService.getInvoice(invoiceId);
  };

  authorizeInvoice = async (
    invoiceId: string
  ): Promise<IAuthorizeAsaasInvoiceResponse | null> => {
    return this.authorizeInvoiceService.authorizeInvoice(invoiceId);
  };

  cancelInvoice = async (
    invoiceId: string,
    request?: ICancelAsaasInvoiceRequest
  ): Promise<ICancelAsaasInvoiceResponse | null> => {
    return this.cancelInvoiceService.cancelInvoice(invoiceId, request);
  };
}
