import { injectable } from 'tsyringe';
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
    upload: UploadPaymentDocumentService,
    list: ListPaymentDocumentsService,
    get: GetPaymentDocumentService,
    update: UpdatePaymentDocumentService,
    deleteService: DeletePaymentDocumentService
  ) {
    this.upload = upload;
    this.list = list;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
  }
}
