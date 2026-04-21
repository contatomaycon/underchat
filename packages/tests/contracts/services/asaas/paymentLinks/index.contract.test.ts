import 'reflect-metadata';
import * as paymentLinks from '@core/services/asaas/paymentLinks';

describe('asaas/paymentLinks/index', () => {
  it('exports payment link services', () => {
    expect(paymentLinks.CreatePaymentLinkService).toBeDefined();
    expect(paymentLinks.ListPaymentLinksService).toBeDefined();
    expect(paymentLinks.GetPaymentLinkService).toBeDefined();
    expect(paymentLinks.UpdatePaymentLinkService).toBeDefined();
    expect(paymentLinks.DeletePaymentLinkService).toBeDefined();
    expect(paymentLinks.RestorePaymentLinkService).toBeDefined();
    expect(paymentLinks.UploadPaymentLinkImageService).toBeDefined();
    expect(paymentLinks.ListPaymentLinkImagesService).toBeDefined();
    expect(paymentLinks.GetPaymentLinkImageService).toBeDefined();
    expect(paymentLinks.DeletePaymentLinkImageService).toBeDefined();
    expect(paymentLinks.SetPaymentLinkImageAsMainService).toBeDefined();
  });
});
