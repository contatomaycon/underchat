import { injectable } from 'tsyringe';
import {
  CreatePaymentLinkService,
  ListPaymentLinksService,
  GetPaymentLinkService,
  UpdatePaymentLinkService,
  DeletePaymentLinkService,
  RestorePaymentLinkService,
} from './paymentLinks';
import { AsaasPaymentLinkImagesServices } from './asaasPaymentLinkImagesServices';

@injectable()
export class AsaasPaymentLinksServices {
  public readonly create: CreatePaymentLinkService;
  public readonly list: ListPaymentLinksService;
  public readonly get: GetPaymentLinkService;
  public readonly update: UpdatePaymentLinkService;
  public readonly delete: DeletePaymentLinkService;
  public readonly restore: RestorePaymentLinkService;
  public readonly images: AsaasPaymentLinkImagesServices;

  constructor(
    create: CreatePaymentLinkService,
    list: ListPaymentLinksService,
    get: GetPaymentLinkService,
    update: UpdatePaymentLinkService,
    deleteService: DeletePaymentLinkService,
    restore: RestorePaymentLinkService,
    images: AsaasPaymentLinkImagesServices
  ) {
    this.create = create;
    this.list = list;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
    this.restore = restore;
    this.images = images;
  }
}
