import 'reflect-metadata';
import { AsaasPaymentInfoServices } from '@core/services/asaas/asaasPaymentInfoServices';

describe('AsaasPaymentInfoServices', () => {
  it('stores injected payment info services', () => {
    const getStatus = { getPaymentStatus: jest.fn() } as never;
    const getIdentificationField = {
      getPaymentIdentificationField: jest.fn(),
    } as never;
    const getPixQrCode = { getPaymentPixQrCode: jest.fn() } as never;
    const getBillingInfo = { getPaymentBillingInfo: jest.fn() } as never;
    const getViewingInfo = { getPaymentViewingInfo: jest.fn() } as never;

    const service = new AsaasPaymentInfoServices(
      getStatus,
      getIdentificationField,
      getPixQrCode,
      getBillingInfo,
      getViewingInfo
    );

    expect(service.getStatus).toBe(getStatus);
    expect(service.getIdentificationField).toBe(getIdentificationField);
    expect(service.getPixQrCode).toBe(getPixQrCode);
    expect(service.getBillingInfo).toBe(getBillingInfo);
    expect(service.getViewingInfo).toBe(getViewingInfo);
  });
});
