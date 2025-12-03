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

@injectable()
export class AsaasService {
  constructor(
    private readonly createCustomerService: CreateCustomerService,
    private readonly listCustomersService: ListCustomersService,
    private readonly getCustomerService: GetCustomerService,
    private readonly updateCustomerService: UpdateCustomerService,
    private readonly deleteCustomerService: DeleteCustomerService,
    private readonly restoreCustomerService: RestoreCustomerService,
    private readonly getCustomerNotificationsService: GetCustomerNotificationsService
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
}
