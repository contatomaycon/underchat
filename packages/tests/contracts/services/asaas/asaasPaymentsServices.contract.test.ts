import 'reflect-metadata';
import { AsaasPaymentsServices } from '@core/services/asaas/asaasPaymentsServices';

describe('AsaasPaymentsServices', () => {
  it('exposes payment operations through grouped services', () => {
    const basic = {
      create: jest.fn(),
      createCreditCard: jest.fn(),
      captureAuthorized: jest.fn(),
      payWithCreditCard: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      restore: jest.fn(),
    };

    const info = {
      getStatus: jest.fn(),
      getIdentificationField: jest.fn(),
      getPixQrCode: jest.fn(),
      getBillingInfo: jest.fn(),
      getViewingInfo: jest.fn(),
    };

    const list = { listPayments: jest.fn() };
    const documents = { upload: jest.fn() };

    const service = new AsaasPaymentsServices(
      basic as never,
      info as never,
      list as never,
      documents as never
    );

    expect(service.basic).toBe(basic);
    expect(service.info).toBe(info);
    expect(service.list).toBe(list);
    expect(service.documents).toBe(documents);
    expect(service.create).toBe(basic.create);
    expect(service.createCreditCard).toBe(basic.createCreditCard);
    expect(service.captureAuthorized).toBe(basic.captureAuthorized);
    expect(service.payWithCreditCard).toBe(basic.payWithCreditCard);
    expect(service.get).toBe(basic.get);
    expect(service.update).toBe(basic.update);
    expect(service.delete).toBe(basic.delete);
    expect(service.restore).toBe(basic.restore);
    expect(service.getStatus).toBe(info.getStatus);
    expect(service.getIdentificationField).toBe(info.getIdentificationField);
    expect(service.getPixQrCode).toBe(info.getPixQrCode);
    expect(service.getBillingInfo).toBe(info.getBillingInfo);
    expect(service.getViewingInfo).toBe(info.getViewingInfo);
  });
});
