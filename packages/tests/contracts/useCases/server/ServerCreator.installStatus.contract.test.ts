import 'reflect-metadata';

jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerCreatorUseCase } from '@core/useCases/server/ServerCreator.useCase';

const t = ((key: string) => key) as never;
const input = {
  name: 'Server 1',
  quantity_workers: 10,
  ssh_ip: '10.0.2.43',
  ssh_port: 22,
  ssh_username: 'root',
  ssh_password: 'secret',
  web_domain: '10.0.2.43',
  web_port: 80,
  web_protocol: 'http',
};

function makeUseCase(sendError?: Error) {
  const serverService = {
    existsServerByIp: jest.fn().mockResolvedValue(false),
    createServer: jest.fn().mockResolvedValue('server-1'),
    updateServerStatusById: jest.fn().mockResolvedValue(true),
  };
  const sshService = {
    testSSHConnection: jest.fn().mockResolvedValue(true),
    getDistroAndVersion: jest.fn().mockResolvedValue({
      distro: 'Ubuntu',
      version: '24.04',
    }),
  };
  const streamProducer = {
    send: sendError
      ? jest.fn().mockRejectedValue(sendError)
      : jest.fn().mockResolvedValue(undefined),
  };
  const queue = { createServer: jest.fn().mockReturnValue('create-server') };
  const useCase = new ServerCreatorUseCase(
    serverService as never,
    sshService as never,
    streamProducer as never,
    queue as never
  );

  return { serverService, streamProducer, useCase };
}

describe('ServerCreatorUseCase installation publication contract', () => {
  it('keys create.server by server id', async () => {
    const { streamProducer, useCase } = makeUseCase();

    await expect(useCase.execute(t, input)).resolves.toEqual({
      server_id: 'server-1',
    });

    expect(streamProducer.send).toHaveBeenCalledWith(
      'create-server',
      {
        server_id: 'server-1',
        installation_id: expect.any(String),
      },
      'server-1'
    );
  });

  it('compensates a publication failure from new to error', async () => {
    const { serverService, useCase } = makeUseCase(new Error('broker down'));

    await expect(useCase.execute(t, input)).rejects.toThrow('kafka_error');

    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.error,
      [EServerStatus.new]
    );
  });
});
