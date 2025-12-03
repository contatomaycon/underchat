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

@injectable()
export class AsaasClientsServices {
  public readonly create: CreateCustomerService;
  public readonly list: ListCustomersService;
  public readonly get: GetCustomerService;
  public readonly update: UpdateCustomerService;
  public readonly delete: DeleteCustomerService;
  public readonly restore: RestoreCustomerService;
  public readonly getNotifications: GetCustomerNotificationsService;

  constructor(
    create: CreateCustomerService,
    list: ListCustomersService,
    get: GetCustomerService,
    update: UpdateCustomerService,
    deleteService: DeleteCustomerService,
    restore: RestoreCustomerService,
    getNotifications: GetCustomerNotificationsService
  ) {
    this.create = create;
    this.list = list;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
    this.restore = restore;
    this.getNotifications = getNotifications;
  }
}
