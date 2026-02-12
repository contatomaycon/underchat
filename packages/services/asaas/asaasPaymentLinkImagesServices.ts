import { injectable, inject } from 'tsyringe';
import {
  UploadPaymentLinkImageService,
  ListPaymentLinkImagesService,
  GetPaymentLinkImageService,
  DeletePaymentLinkImageService,
  SetPaymentLinkImageAsMainService,
} from './paymentLinks';

@injectable()
export class AsaasPaymentLinkImagesServices {
  public readonly upload: UploadPaymentLinkImageService;
  public readonly list: ListPaymentLinkImagesService;
  public readonly get: GetPaymentLinkImageService;
  public readonly delete: DeletePaymentLinkImageService;
  public readonly setAsMain: SetPaymentLinkImageAsMainService;

  constructor(
    @inject(UploadPaymentLinkImageService)
    upload: UploadPaymentLinkImageService,
    @inject(ListPaymentLinkImagesService)
    list: ListPaymentLinkImagesService,
    @inject(GetPaymentLinkImageService)
    get: GetPaymentLinkImageService,
    @inject(DeletePaymentLinkImageService)
    deleteService: DeletePaymentLinkImageService,
    @inject(SetPaymentLinkImageAsMainService)
    setAsMain: SetPaymentLinkImageAsMainService
  ) {
    this.upload = upload;
    this.list = list;
    this.get = get;
    this.delete = deleteService;
    this.setAsMain = setAsMain;
  }
}
