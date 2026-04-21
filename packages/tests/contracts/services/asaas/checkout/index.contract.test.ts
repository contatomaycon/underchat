import 'reflect-metadata';
import * as checkout from '@core/services/asaas/checkout';

describe('asaas/checkout/index', () => {
  it('exports checkout services', () => {
    expect(checkout.CreateCheckoutService).toBeDefined();
    expect(checkout.CancelCheckoutService).toBeDefined();
  });
});
