import { injectable } from 'tsyringe';
import { AsaasClientsServices } from './asaasClientsServices';
import { AsaasPaymentsServices } from './asaasPaymentsServices';
import { AsaasInstallmentsServices } from './asaasInstallmentsServices';
import { AsaasSubscriptionsServices } from './asaasSubscriptionsServices';
import { AsaasPaymentLinksServices } from './asaasPaymentLinksServices';
import { AsaasCheckoutServices } from './asaasCheckoutServices';
import { AsaasCreditCardServices } from './asaasCreditCardServices';
import { AsaasRefundsServices } from './asaasRefundsServices';
import { AsaasInvoicesServices } from './asaasInvoicesServices';
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
    private readonly clients: AsaasClientsServices,
    private readonly payments: AsaasPaymentsServices,
    private readonly installments: AsaasInstallmentsServices,
    private readonly subscriptions: AsaasSubscriptionsServices,
    private readonly paymentLinks: AsaasPaymentLinksServices,
    private readonly checkout: AsaasCheckoutServices,
    private readonly creditCard: AsaasCreditCardServices,
    private readonly refunds: AsaasRefundsServices,
    private readonly invoices: AsaasInvoicesServices
  ) {}

  createCustomer = async (
    request: ICreateAsaasCustomerRequest
  ): Promise<ICreateAsaasCustomerResponse | null> => {
    return this.clients.create.createCustomer(request);
  };

  listCustomers = async (
    request?: IListAsaasCustomersRequest
  ): Promise<IListAsaasCustomersResponse | null> => {
    return this.clients.list.listCustomers(request);
  };

  getCustomer = async (
    customerId: string
  ): Promise<IGetAsaasCustomerResponse | null> => {
    return this.clients.get.getCustomer(customerId);
  };

  updateCustomer = async (
    customerId: string,
    request: IUpdateAsaasCustomerRequest
  ): Promise<IUpdateAsaasCustomerResponse | null> => {
    return this.clients.update.updateCustomer(customerId, request);
  };

  deleteCustomer = async (
    customerId: string
  ): Promise<IDeleteAsaasCustomerResponse | null> => {
    return this.clients.delete.deleteCustomer(customerId);
  };

  restoreCustomer = async (
    customerId: string
  ): Promise<IRestoreAsaasCustomerResponse | null> => {
    return this.clients.restore.restoreCustomer(customerId);
  };

  getCustomerNotifications = async (
    customerId: string
  ): Promise<IListAsaasCustomerNotificationsResponse | null> => {
    return this.clients.getNotifications.getCustomerNotifications(customerId);
  };

  createPayment = async (
    request: ICreateAsaasPaymentRequest
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.payments.create.createPayment(request);
  };

  createCreditCardPayment = async (
    request: ICreateAsaasCreditCardPaymentRequest
  ): Promise<ICreateAsaasCreditCardPaymentResponse | null> => {
    return this.payments.createCreditCard.createCreditCardPayment(request);
  };

  captureAuthorizedPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.payments.captureAuthorized.captureAuthorizedPayment(paymentId);
  };

  payWithCreditCard = async (
    paymentId: string,
    request: IPayAsaasPaymentWithCreditCardRequest
  ): Promise<IPayAsaasPaymentWithCreditCardResponse | null> => {
    return this.payments.payWithCreditCard.payWithCreditCard(
      paymentId,
      request
    );
  };

  getPayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.payments.get.getPayment(paymentId);
  };

  updatePayment = async (
    paymentId: string,
    request: IUpdateAsaasPaymentRequest
  ): Promise<IUpdateAsaasPaymentResponse | null> => {
    return this.payments.update.updatePayment(paymentId, request);
  };

  deletePayment = async (
    paymentId: string
  ): Promise<IDeleteAsaasPaymentResponse | null> => {
    return this.payments.delete.deletePayment(paymentId);
  };

  restorePayment = async (
    paymentId: string
  ): Promise<ICreateAsaasPaymentResponse | null> => {
    return this.payments.restore.restorePayment(paymentId);
  };

  getPaymentStatus = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentStatusResponse | null> => {
    return this.payments.getStatus.getPaymentStatus(paymentId);
  };

  getPaymentIdentificationField = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentIdentificationFieldResponse | null> => {
    return this.payments.getIdentificationField.getPaymentIdentificationField(
      paymentId
    );
  };

  getPaymentPixQrCode = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentPixQrCodeResponse | null> => {
    return this.payments.getPixQrCode.getPaymentPixQrCode(paymentId);
  };

  getPaymentBillingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentBillingInfoResponse | null> => {
    return this.payments.getBillingInfo.getPaymentBillingInfo(paymentId);
  };

  getPaymentViewingInfo = async (
    paymentId: string
  ): Promise<IGetAsaasPaymentViewingInfoResponse | null> => {
    return this.payments.getViewingInfo.getPaymentViewingInfo(paymentId);
  };

  listPayments = async (
    request?: IListAsaasPaymentsRequest
  ): Promise<IListAsaasPaymentsResponse | null> => {
    return this.payments.list.listPayments(request);
  };

  uploadPaymentDocument = async (
    paymentId: string,
    request: IUploadAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.payments.documents.upload.uploadPaymentDocument(
      paymentId,
      request
    );
  };

  listPaymentDocuments = async (
    paymentId: string
  ): Promise<IListAsaasPaymentDocumentsResponse | null> => {
    return this.payments.documents.list.listPaymentDocuments(paymentId);
  };

  getPaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.payments.documents.get.getPaymentDocument(
      paymentId,
      documentId
    );
  };

  updatePaymentDocument = async (
    paymentId: string,
    documentId: string,
    request: IUpdateAsaasPaymentDocumentRequest
  ): Promise<IUploadAsaasPaymentDocumentResponse | null> => {
    return this.payments.documents.update.updatePaymentDocument(
      paymentId,
      documentId,
      request
    );
  };

  deletePaymentDocument = async (
    paymentId: string,
    documentId: string
  ): Promise<IDeleteAsaasPaymentDocumentResponse | null> => {
    return this.payments.documents.delete.deletePaymentDocument(
      paymentId,
      documentId
    );
  };

  createInstallment = async (
    request: ICreateAsaasInstallmentRequest
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    return this.installments.create.createInstallment(request);
  };

  createInstallmentWithCreditCard = async (
    request: ICreateAsaasInstallmentWithCreditCardRequest
  ): Promise<ICreateAsaasInstallmentWithCreditCardResponse | null> => {
    return this.installments.createWithCreditCard.createInstallmentWithCreditCard(
      request
    );
  };

  getInstallment = async (
    installmentId: string
  ): Promise<ICreateAsaasInstallmentResponse | null> => {
    return this.installments.get.getInstallment(installmentId);
  };

  deleteInstallment = async (
    installmentId: string
  ): Promise<IDeleteAsaasInstallmentResponse | null> => {
    return this.installments.delete.deleteInstallment(installmentId);
  };

  listInstallments = async (
    request?: IListAsaasInstallmentsRequest
  ): Promise<IListAsaasInstallmentsResponse | null> => {
    return this.installments.list.listInstallments(request);
  };

  listInstallmentPayments = async (
    installmentId: string,
    request?: IListAsaasInstallmentPaymentsRequest
  ): Promise<IListAsaasInstallmentPaymentsResponse | null> => {
    return this.installments.listPayments.listInstallmentPayments(
      installmentId,
      request
    );
  };

  getInstallmentPaymentBook = async (
    installmentId: string,
    request?: IGetAsaasInstallmentPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    return this.installments.getPaymentBook.getInstallmentPaymentBook(
      installmentId,
      request
    );
  };

  updateInstallmentSplits = async (
    installmentId: string,
    request: IUpdateAsaasInstallmentSplitsRequest
  ): Promise<IUpdateAsaasInstallmentSplitsResponse | null> => {
    return this.installments.updateSplits.updateInstallmentSplits(
      installmentId,
      request
    );
  };

  refundInstallment = async (
    installmentId: string,
    request?: IRefundAsaasInstallmentRequest
  ): Promise<IRefundAsaasInstallmentResponse | null> => {
    return this.installments.refund.refundInstallment(installmentId, request);
  };

  createSubscription = async (
    request: ICreateAsaasSubscriptionRequest
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    return this.subscriptions.create.createSubscription(request);
  };

  createSubscriptionWithCreditCard = async (
    request: ICreateAsaasSubscriptionWithCreditCardRequest
  ): Promise<ICreateAsaasSubscriptionWithCreditCardResponse | null> => {
    return this.subscriptions.createWithCreditCard.createSubscriptionWithCreditCard(
      request
    );
  };

  getSubscription = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionResponse | null> => {
    return this.subscriptions.get.getSubscription(subscriptionId);
  };

  updateSubscription = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionRequest
  ): Promise<IUpdateAsaasSubscriptionResponse | null> => {
    return this.subscriptions.update.updateSubscription(
      subscriptionId,
      request
    );
  };

  updateSubscriptionCreditCard = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionCreditCardRequest
  ): Promise<IUpdateAsaasSubscriptionCreditCardResponse | null> => {
    return this.subscriptions.updateCreditCard.updateSubscriptionCreditCard(
      subscriptionId,
      request
    );
  };

  deleteSubscription = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionResponse | null> => {
    return this.subscriptions.delete.deleteSubscription(subscriptionId);
  };

  listSubscriptions = async (
    request?: IListAsaasSubscriptionsRequest
  ): Promise<IListAsaasSubscriptionsResponse | null> => {
    return this.subscriptions.list.listSubscriptions(request);
  };

  listSubscriptionPayments = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionPaymentsRequest
  ): Promise<IListAsaasSubscriptionPaymentsResponse | null> => {
    return this.subscriptions.listPayments.listSubscriptionPayments(
      subscriptionId,
      request
    );
  };

  getSubscriptionPaymentBook = async (
    subscriptionId: string,
    request?: IGetAsaasSubscriptionPaymentBookRequest
  ): Promise<ArrayBuffer | null> => {
    return this.subscriptions.getPaymentBook.getSubscriptionPaymentBook(
      subscriptionId,
      request
    );
  };

  createSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: ICreateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.subscriptions.invoiceSettings.create.createSubscriptionInvoiceSettings(
      subscriptionId,
      request
    );
  };

  getSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<ICreateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.subscriptions.invoiceSettings.get.getSubscriptionInvoiceSettings(
      subscriptionId
    );
  };

  updateSubscriptionInvoiceSettings = async (
    subscriptionId: string,
    request: IUpdateAsaasSubscriptionInvoiceSettingsRequest
  ): Promise<IUpdateAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.subscriptions.invoiceSettings.update.updateSubscriptionInvoiceSettings(
      subscriptionId,
      request
    );
  };

  deleteSubscriptionInvoiceSettings = async (
    subscriptionId: string
  ): Promise<IDeleteAsaasSubscriptionInvoiceSettingsResponse | null> => {
    return this.subscriptions.invoiceSettings.delete.deleteSubscriptionInvoiceSettings(
      subscriptionId
    );
  };

  listSubscriptionInvoices = async (
    subscriptionId: string,
    request?: IListAsaasSubscriptionInvoicesRequest
  ): Promise<IListAsaasSubscriptionInvoicesResponse | null> => {
    return this.subscriptions.listInvoices.listSubscriptionInvoices(
      subscriptionId,
      request
    );
  };

  createPaymentLink = async (
    request: ICreateAsaasPaymentLinkRequest
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    return this.paymentLinks.create.createPaymentLink(request);
  };

  listPaymentLinks = async (
    request?: IListAsaasPaymentLinksRequest
  ): Promise<IListAsaasPaymentLinksResponse | null> => {
    return this.paymentLinks.list.listPaymentLinks(request);
  };

  getPaymentLink = async (
    paymentLinkId: string
  ): Promise<ICreateAsaasPaymentLinkResponse | null> => {
    return this.paymentLinks.get.getPaymentLink(paymentLinkId);
  };

  updatePaymentLink = async (
    paymentLinkId: string,
    request: IUpdateAsaasPaymentLinkRequest
  ): Promise<IUpdateAsaasPaymentLinkResponse | null> => {
    return this.paymentLinks.update.updatePaymentLink(paymentLinkId, request);
  };

  deletePaymentLink = async (
    paymentLinkId: string
  ): Promise<IDeleteAsaasPaymentLinkResponse | null> => {
    return this.paymentLinks.delete.deletePaymentLink(paymentLinkId);
  };

  restorePaymentLink = async (
    paymentLinkId: string
  ): Promise<IRestoreAsaasPaymentLinkResponse | null> => {
    return this.paymentLinks.restore.restorePaymentLink(paymentLinkId);
  };

  uploadPaymentLinkImage = async (
    paymentLinkId: string,
    request: IUploadAsaasPaymentLinkImageRequest
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    return this.paymentLinks.images.upload.uploadPaymentLinkImage(
      paymentLinkId,
      request
    );
  };

  listPaymentLinkImages = async (
    paymentLinkId: string
  ): Promise<IListAsaasPaymentLinkImagesResponse | null> => {
    return this.paymentLinks.images.list.listPaymentLinkImages(paymentLinkId);
  };

  getPaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IUploadAsaasPaymentLinkImageResponse | null> => {
    return this.paymentLinks.images.get.getPaymentLinkImage(
      paymentLinkId,
      imageId
    );
  };

  deletePaymentLinkImage = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<IDeleteAsaasPaymentLinkImageResponse | null> => {
    return this.paymentLinks.images.delete.deletePaymentLinkImage(
      paymentLinkId,
      imageId
    );
  };

  setPaymentLinkImageAsMain = async (
    paymentLinkId: string,
    imageId: string
  ): Promise<ISetAsMainPaymentLinkImageResponse | null> => {
    return this.paymentLinks.images.setAsMain.setPaymentLinkImageAsMain(
      paymentLinkId,
      imageId
    );
  };

  createCheckout = async (
    request: ICreateAsaasCheckoutRequest
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    return this.checkout.create.createCheckout(request);
  };

  cancelCheckout = async (
    checkoutId: string
  ): Promise<ICreateAsaasCheckoutResponse | null> => {
    return this.checkout.cancel.cancelCheckout(checkoutId);
  };

  tokenizeCreditCard = async (
    request: ITokenizeAsaasCreditCardRequest
  ): Promise<ITokenizeAsaasCreditCardResponse | null> => {
    return this.creditCard.tokenize.tokenizeCreditCard(request);
  };

  listPaymentRefunds = async (
    paymentId: string
  ): Promise<IListAsaasPaymentRefundsResponse | null> => {
    return this.refunds.list.listPaymentRefunds(paymentId);
  };

  refundBankSlip = async (
    paymentId: string
  ): Promise<IRefundAsaasBankSlipResponse | null> => {
    return this.refunds.refundBankSlip.refundBankSlip(paymentId);
  };

  refundPaymentLean = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentLeanResponse | null> => {
    return this.refunds.refundPaymentLean.refundPaymentLean(paymentId, request);
  };

  refundPayment = async (
    paymentId: string,
    request?: IRefundAsaasPaymentRequest
  ): Promise<IRefundAsaasPaymentResponse | null> => {
    return this.refunds.refundPayment.refundPayment(paymentId, request);
  };

  createInvoice = async (
    request: ICreateAsaasInvoiceRequest
  ): Promise<ICreateAsaasInvoiceResponse | null> => {
    return this.invoices.create.createInvoice(request);
  };

  listInvoices = async (
    request?: IListAsaasInvoicesRequest
  ): Promise<IListAsaasInvoicesResponse | null> => {
    return this.invoices.list.listInvoices(request);
  };

  updateInvoice = async (
    invoiceId: string,
    request: IUpdateAsaasInvoiceRequest
  ): Promise<IUpdateAsaasInvoiceResponse | null> => {
    return this.invoices.update.updateInvoice(invoiceId, request);
  };

  getInvoice = async (
    invoiceId: string
  ): Promise<IGetAsaasInvoiceResponse | null> => {
    return this.invoices.get.getInvoice(invoiceId);
  };

  authorizeInvoice = async (
    invoiceId: string
  ): Promise<IAuthorizeAsaasInvoiceResponse | null> => {
    return this.invoices.authorize.authorizeInvoice(invoiceId);
  };

  cancelInvoice = async (
    invoiceId: string,
    request?: ICancelAsaasInvoiceRequest
  ): Promise<ICancelAsaasInvoiceResponse | null> => {
    return this.invoices.cancel.cancelInvoice(invoiceId, request);
  };
}
