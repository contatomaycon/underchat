import 'reflect-metadata';
import * as subscriptions from '@core/services/asaas/subscriptions';

describe('asaas/subscriptions/index', () => {
  it('exports subscription services', () => {
    expect(subscriptions.CreateSubscriptionService).toBeDefined();
    expect(subscriptions.CreateSubscriptionWithCreditCardService).toBeDefined();
    expect(subscriptions.GetSubscriptionService).toBeDefined();
    expect(subscriptions.UpdateSubscriptionService).toBeDefined();
    expect(subscriptions.UpdateSubscriptionCreditCardService).toBeDefined();
    expect(subscriptions.DeleteSubscriptionService).toBeDefined();
    expect(subscriptions.ListSubscriptionsService).toBeDefined();
    expect(subscriptions.ListSubscriptionPaymentsService).toBeDefined();
    expect(subscriptions.GetSubscriptionPaymentBookService).toBeDefined();
    expect(
      subscriptions.CreateSubscriptionInvoiceSettingsService
    ).toBeDefined();
    expect(subscriptions.GetSubscriptionInvoiceSettingsService).toBeDefined();
    expect(
      subscriptions.UpdateSubscriptionInvoiceSettingsService
    ).toBeDefined();
    expect(
      subscriptions.DeleteSubscriptionInvoiceSettingsService
    ).toBeDefined();
    expect(subscriptions.ListSubscriptionInvoicesService).toBeDefined();
  });
});
