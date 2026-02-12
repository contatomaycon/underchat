import { injectable, inject } from 'tsyringe';
import {
  UploadPaymentDocumentService,
  ListPaymentDocumentsService,
  GetPaymentDocumentService,
  UpdatePaymentDocumentService,
  DeletePaymentDocumentService,
} from './payments';

@injectable()
export class AsaasPaymentDocumentsServices {
  public readonly upload: UploadPaymentDocumentService;
  public readonly list: ListPaymentDocumentsService;
  public readonly get: GetPaymentDocumentService;
  public readonly update: UpdatePaymentDocumentService;
  public readonly delete: DeletePaymentDocumentService;

  constructor(
    @inject(UploadPaymentDocumentService)
    upload: UploadPaymentDocumentService,
    @inject(ListPaymentDocumentsService)
    list: ListPaymentDocumentsService,
    @inject(GetPaymentDocumentService)
    get: GetPaymentDocumentService,
    @inject(UpdatePaymentDocumentService)
    update: UpdatePaymentDocumentService,
    @inject(DeletePaymentDocumentService)
    deleteService: DeletePaymentDocumentService
  ) {
    this.upload = upload;
    this.list = list;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
  }
}
