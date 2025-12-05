import { injectable } from 'tsyringe';
import {
  CreateInvoiceService,
  ListInvoicesService,
  UpdateInvoiceService,
  GetInvoiceService,
  AuthorizeInvoiceService,
  CancelInvoiceService,
} from './invoices';

@injectable()
export class AsaasInvoicesServices {
  public readonly create: CreateInvoiceService;
  public readonly list: ListInvoicesService;
  public readonly update: UpdateInvoiceService;
  public readonly get: GetInvoiceService;
  public readonly authorize: AuthorizeInvoiceService;
  public readonly cancel: CancelInvoiceService;

  constructor(
    create: CreateInvoiceService,
    list: ListInvoicesService,
    update: UpdateInvoiceService,
    get: GetInvoiceService,
    authorize: AuthorizeInvoiceService,
    cancel: CancelInvoiceService
  ) {
    this.create = create;
    this.list = list;
    this.update = update;
    this.get = get;
    this.authorize = authorize;
    this.cancel = cancel;
  }
}
