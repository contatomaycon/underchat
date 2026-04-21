import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    Client: class {},
    LocalAuth: class {},
    MessageMedia: { fromFilePath: jest.fn() },
  },
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

import { WwebjsProfileService } from '@core/services/wwebjs/methods/profile.service';

describe('WwebjsProfileService', () => {
  it('delegates profile operations to helpers', async () => {
    const helpers = {
      updateProfileName: jest.fn(async () => undefined),
      updateProfileStatus: jest.fn(async () => undefined),
      updateProfilePicture: jest.fn(async () => undefined),
      removeProfilePicture: jest.fn(async () => undefined),
    };

    const service = new WwebjsProfileService(helpers as never);

    await service.updateProfileName('Name');
    await service.updateProfileStatus('Status');
    await service.updateProfilePicture('https://img');
    await service.removeProfilePicture();

    expect(helpers.updateProfileName).toHaveBeenCalledWith('Name');
    expect(helpers.updateProfileStatus).toHaveBeenCalledWith('Status');
    expect(helpers.updateProfilePicture).toHaveBeenCalledWith('https://img');
    expect(helpers.removeProfilePicture).toHaveBeenCalled();
  });
});
