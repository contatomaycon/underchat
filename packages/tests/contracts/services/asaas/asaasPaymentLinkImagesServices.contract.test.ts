import 'reflect-metadata';
import { AsaasPaymentLinkImagesServices } from '@core/services/asaas/asaasPaymentLinkImagesServices';

describe('AsaasPaymentLinkImagesServices', () => {
  it('stores injected payment link image services', () => {
    const upload = { uploadPaymentLinkImage: jest.fn() } as never;
    const list = { listPaymentLinkImages: jest.fn() } as never;
    const get = { getPaymentLinkImage: jest.fn() } as never;
    const deleteService = { deletePaymentLinkImage: jest.fn() } as never;
    const setAsMain = { setPaymentLinkImageAsMain: jest.fn() } as never;

    const service = new AsaasPaymentLinkImagesServices(
      upload,
      list,
      get,
      deleteService,
      setAsMain
    );

    expect(service.upload).toBe(upload);
    expect(service.list).toBe(list);
    expect(service.get).toBe(get);
    expect(service.delete).toBe(deleteService);
    expect(service.setAsMain).toBe(setAsMain);
  });
});
