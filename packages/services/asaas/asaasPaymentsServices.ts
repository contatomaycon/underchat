import { injectable } from 'tsyringe';
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
import { AsaasPaymentDocumentsServices } from './asaasPaymentDocumentsServices';

@injectable()
export class AsaasPaymentsServices {
  public readonly create: CreatePaymentService;
  public readonly createCreditCard: CreateCreditCardPaymentService;
  public readonly captureAuthorized: CaptureAuthorizedPaymentService;
  public readonly payWithCreditCard: PayWithCreditCardService;
  public readonly get: GetPaymentService;
  public readonly update: UpdatePaymentService;
  public readonly delete: DeletePaymentService;
  public readonly restore: RestorePaymentService;
  public readonly getStatus: GetPaymentStatusService;
  public readonly getIdentificationField: GetPaymentIdentificationFieldService;
  public readonly getPixQrCode: GetPaymentPixQrCodeService;
  public readonly getBillingInfo: GetPaymentBillingInfoService;
  public readonly getViewingInfo: GetPaymentViewingInfoService;
  public readonly list: ListPaymentsService;
  public readonly documents: AsaasPaymentDocumentsServices;

  constructor(
    create: CreatePaymentService,
    createCreditCard: CreateCreditCardPaymentService,
    captureAuthorized: CaptureAuthorizedPaymentService,
    payWithCreditCard: PayWithCreditCardService,
    get: GetPaymentService,
    update: UpdatePaymentService,
    deleteService: DeletePaymentService,
    restore: RestorePaymentService,
    getStatus: GetPaymentStatusService,
    getIdentificationField: GetPaymentIdentificationFieldService,
    getPixQrCode: GetPaymentPixQrCodeService,
    getBillingInfo: GetPaymentBillingInfoService,
    getViewingInfo: GetPaymentViewingInfoService,
    list: ListPaymentsService,
    documents: AsaasPaymentDocumentsServices
  ) {
    this.create = create;
    this.createCreditCard = createCreditCard;
    this.captureAuthorized = captureAuthorized;
    this.payWithCreditCard = payWithCreditCard;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
    this.restore = restore;
    this.getStatus = getStatus;
    this.getIdentificationField = getIdentificationField;
    this.getPixQrCode = getPixQrCode;
    this.getBillingInfo = getBillingInfo;
    this.getViewingInfo = getViewingInfo;
    this.list = list;
    this.documents = documents;
  }
}
