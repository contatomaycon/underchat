import 'reflect-metadata';
import * as clients from '@core/services/asaas/clients';

describe('asaas/clients/index', () => {
  it('exports client services', () => {
    expect(clients.CreateCustomerService).toBeDefined();
    expect(clients.ListCustomersService).toBeDefined();
    expect(clients.GetCustomerService).toBeDefined();
    expect(clients.UpdateCustomerService).toBeDefined();
    expect(clients.DeleteCustomerService).toBeDefined();
    expect(clients.RestoreCustomerService).toBeDefined();
    expect(clients.GetCustomerNotificationsService).toBeDefined();
  });
});
