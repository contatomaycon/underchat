import { injectable, inject } from 'tsyringe';
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
    @inject(CreatePaymentLinkService)
    create: CreatePaymentLinkService,
    @inject(ListPaymentLinksService)
    list: ListPaymentLinksService,
    @inject(GetPaymentLinkService)
    get: GetPaymentLinkService,
    @inject(UpdatePaymentLinkService)
    update: UpdatePaymentLinkService,
    @inject(DeletePaymentLinkService)
    deleteService: DeletePaymentLinkService,
    @inject(RestorePaymentLinkService)
    restore: RestorePaymentLinkService,
    @inject(AsaasPaymentLinkImagesServices)
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
