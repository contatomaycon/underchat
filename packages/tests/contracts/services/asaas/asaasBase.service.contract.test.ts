import 'reflect-metadata';
import { AsaasBaseService } from '@core/services/asaas/asaasBase.service';
import axios from 'axios';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

jest.mock('@core/config/environments', () => ({
  asaasEnvironment: {
    getAsaasHost: jest.fn(() => 'https://asaas.example.com'),
    getAsaasToken: jest.fn(() => 'token-123'),
  },
}));

describe('AsaasBaseService', () => {
  it('creates axios instance once and reuses cached instance', () => {
    (axios.create as jest.Mock).mockReturnValue({ id: 'instance' });
    const service = new AsaasBaseService();

    const first = service.getAxiosInstance();
    const second = service.getAxiosInstance();

    expect(first).toEqual({ id: 'instance' });
    expect(second).toEqual({ id: 'instance' });
    expect(axios.create).toHaveBeenCalledTimes(1);
  });
});
