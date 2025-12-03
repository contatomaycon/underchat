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
} from './payments';
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
} from '@core/common/interfaces/IAsaasPayment';

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
    private readonly listPaymentsService: ListPaymentsService
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
}
