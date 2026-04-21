import 'reflect-metadata';

jest.mock('@core/repositories/sector/SectorViewerExists.repository', () => ({
  SectorViewerExistsRepository: class {},
}));

jest.mock(
  '@core/repositories/sector/SectorStatusViewerExists.repository',
  () => ({
    SectorStatusViewerExistsRepository: class {},
  })
);

jest.mock('@core/repositories/sector/SectorLister.repository', () => ({
  SectorListerRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorViewer.repository', () => ({
  SectorViewerRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorDeleter.repository', () => ({
  SectorDeleterRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorByIdExists.repository', () => ({
  SectorByIdExistsRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorUsersLister.repository', () => ({
  SectorUsersListerRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorAllLister.repository', () => ({
  SectorAllListerRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorTransferLister.repository', () => ({
  SectorTransferListerRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorCreator.repository', () => ({
  SectorCreatorRepository: class {},
}));

jest.mock('@core/repositories/sector/SectorUpdater.repository', () => ({
  SectorUpdaterRepository: class {},
}));

import { SectorService } from '@core/services/sector.service';

describe('SectorService', () => {
  const makeService = () => {
    const sectorViewerExistsRepository = {
      existsSectorById: jest.fn(async () => true),
    };

    const sectorStatusViewerExistsRepository = {
      existsSectorStatusById: jest.fn(async () => true),
    };

    const sectorListerRepository = {
      listSector: jest.fn(async () => [
        {
          sector_id: 'sec-1',
          name: 'Support',
        },
      ]),
      listSectorTotal: jest.fn(async () => 1),
    };

    const sectorViewerRepository = {
      viewSectorById: jest.fn(async () => ({
        sector_id: 'sec-1',
        name: 'Support',
      })),
    };

    const sectorDeleterRepository = {
      deleteSectorById: jest.fn(async () => true),
    };

    const sectorByIdExistsRepository = {
      sectorByIdExists: jest.fn(async () => true),
    };

    const sectorUsersListerRepository = {
      listSectorUsers: jest.fn<Promise<any[]>, any[]>(async () => []),
      listSectorUsersBySectorIds: jest.fn<Promise<any[]>, any[]>(
        async () => []
      ),
    };

    const sectorAllListerRepository = {
      listAllSectors: jest.fn(async () => [
        { sector_id: 'sec-1', name: 'Support' },
      ]),
      listAllSectorsForReport: jest.fn(async () => [
        {
          sector_id: 'sec-1',
          name: 'Support',
        },
      ]),
    };

    const sectorTransferListerRepository = {
      listSectorsForTransfer: jest.fn(async () => [
        {
          id: 'sec-1',
          name: 'Support',
        },
      ]),
    };

    const sectorCreatorRepository = {
      createSector: jest.fn(async () => ({ sector_id: 'sec-1' })),
    };

    const sectorUpdaterRepository = {
      updateSectorById: jest.fn(async () => true),
    };

    const service = new SectorService(
      sectorViewerExistsRepository as never,
      sectorStatusViewerExistsRepository as never,
      sectorListerRepository as never,
      sectorViewerRepository as never,
      sectorDeleterRepository as never,
      sectorByIdExistsRepository as never,
      sectorUsersListerRepository as never,
      sectorAllListerRepository as never,
      sectorTransferListerRepository as never,
      sectorCreatorRepository as never,
      sectorUpdaterRepository as never
    );

    return {
      service,
      sectorViewerExistsRepository,
      sectorStatusViewerExistsRepository,
      sectorListerRepository,
      sectorViewerRepository,
      sectorDeleterRepository,
      sectorByIdExistsRepository,
      sectorUsersListerRepository,
      sectorAllListerRepository,
      sectorTransferListerRepository,
      sectorCreatorRepository,
      sectorUpdaterRepository,
    };
  };

  it('delegates core sector methods and listing methods', async () => {
    const {
      service,
      sectorViewerExistsRepository,
      sectorStatusViewerExistsRepository,
      sectorListerRepository,
      sectorViewerRepository,
      sectorDeleterRepository,
      sectorByIdExistsRepository,
      sectorUsersListerRepository,
      sectorAllListerRepository,
      sectorTransferListerRepository,
      sectorCreatorRepository,
      sectorUpdaterRepository,
    } = makeService();

    await expect(service.existsSectorById('sec-1', 'acc-1')).resolves.toBe(
      true
    );
    expect(sectorViewerExistsRepository.existsSectorById).toHaveBeenCalledWith(
      'sec-1',
      'acc-1'
    );

    await expect(
      service.createSector(
        ((k: string) => k) as never,
        { name: 'Support' } as never,
        'acc-1'
      )
    ).resolves.toEqual({ sector_id: 'sec-1' });
    expect(sectorCreatorRepository.createSector).toHaveBeenCalledWith(
      { name: 'Support' },
      'acc-1'
    );

    await expect(service.existsSectorStatusById('status-1')).resolves.toBe(
      true
    );
    expect(
      sectorStatusViewerExistsRepository.existsSectorStatusById
    ).toHaveBeenCalledWith('status-1');

    await expect(
      service.listSector(10, 1, { search: 'support' } as never, 'acc-1')
    ).resolves.toEqual([
      [
        {
          sector_id: 'sec-1',
          name: 'Support',
        },
      ],
      1,
    ]);
    expect(sectorListerRepository.listSector).toHaveBeenCalledWith(
      10,
      1,
      { search: 'support' },
      'acc-1'
    );
    expect(sectorListerRepository.listSectorTotal).toHaveBeenCalledWith(
      { search: 'support' },
      'acc-1'
    );

    await expect(service.viewSectorById('sec-1', 'acc-1')).resolves.toEqual({
      sector_id: 'sec-1',
      name: 'Support',
    });
    expect(sectorViewerRepository.viewSectorById).toHaveBeenCalledWith(
      'sec-1',
      'acc-1'
    );

    await expect(service.deleteSectorById('sec-1', 'acc-1')).resolves.toBe(
      true
    );
    expect(sectorDeleterRepository.deleteSectorById).toHaveBeenCalledWith(
      'sec-1',
      'acc-1'
    );

    await expect(
      service.updateSectorById(
        ((k: string) => k) as never,
        'sec-1',
        { name: 'Updated' } as never,
        'acc-1'
      )
    ).resolves.toBe(true);
    expect(sectorUpdaterRepository.updateSectorById).toHaveBeenCalledWith(
      'sec-1',
      { name: 'Updated' },
      'acc-1'
    );

    await expect(service.sectorByIdExists('sec-1', 'acc-1')).resolves.toBe(
      true
    );
    expect(sectorByIdExistsRepository.sectorByIdExists).toHaveBeenCalledWith(
      'sec-1',
      'acc-1'
    );

    await expect(service.listSectorUsers('acc-1', 'sec-1')).resolves.toEqual(
      []
    );
    expect(sectorUsersListerRepository.listSectorUsers).toHaveBeenCalledWith(
      'acc-1',
      'sec-1'
    );

    await expect(service.listAllSectors('acc-1')).resolves.toEqual([
      { sector_id: 'sec-1', name: 'Support' },
    ]);
    expect(sectorAllListerRepository.listAllSectors).toHaveBeenCalledWith(
      'acc-1'
    );

    await expect(service.listSectorsForTransfer('acc-1')).resolves.toEqual([
      { id: 'sec-1', name: 'Support' },
    ]);
    expect(
      sectorTransferListerRepository.listSectorsForTransfer
    ).toHaveBeenCalledWith('acc-1');

    await expect(service.listAllSectorsForReport('acc-1')).resolves.toEqual([
      {
        sector_id: 'sec-1',
        name: 'Support',
      },
    ]);
    expect(
      sectorAllListerRepository.listAllSectorsForReport
    ).toHaveBeenCalledWith('acc-1');
  });

  it('returns empty list for transfer users when repository has no data', async () => {
    const { service, sectorUsersListerRepository } = makeService();

    sectorUsersListerRepository.listSectorUsers.mockResolvedValueOnce([]);

    await expect(
      service.listSectorUsersForTransfer('acc-1', 'sec-1')
    ).resolves.toEqual([]);
  });

  it('maps sector users for transfer with field fallbacks', async () => {
    const { service, sectorUsersListerRepository } = makeService();

    sectorUsersListerRepository.listSectorUsers.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        email_partial: 'nick@example.com',
        user_info: {
          name: 'Ana',
          last_name: 'Silva',
          photo: 'photo-url',
        },
        chat_user: {
          status: 'online',
        },
      },
      {
        user_id: 'user-2',
        email_partial: 'fallback@example.com',
        user_info: null,
        chat_user: null,
      },
      {
        user_id: 'user-3',
        email_partial: null,
        user_info: null,
        chat_user: null,
      },
    ]);

    await expect(
      service.listSectorUsersForTransfer('acc-1', 'sec-1')
    ).resolves.toEqual([
      {
        id: 'user-1',
        name: 'Ana',
        last_name: 'Silva',
        nickname: 'nick@example.com',
        photo: 'photo-url',
        status: 'online',
      },
      {
        id: 'user-2',
        name: 'fallback@example.com',
        last_name: null,
        nickname: 'fallback@example.com',
        photo: null,
        status: null,
      },
      {
        id: 'user-3',
        name: '',
        last_name: null,
        nickname: null,
        photo: null,
        status: null,
      },
    ]);
  });

  it('returns empty and mapped values for transfer users by sector ids', async () => {
    const { service, sectorUsersListerRepository } = makeService();

    sectorUsersListerRepository.listSectorUsersBySectorIds.mockResolvedValueOnce(
      []
    );
    await expect(
      service.listSectorUsersForTransferBySectorIds('acc-1', ['sec-1'])
    ).resolves.toEqual([]);

    sectorUsersListerRepository.listSectorUsersBySectorIds.mockResolvedValueOnce(
      [
        {
          user_id: 'user-1',
          email_partial: 'nick-1',
          user_info: {
            name: 'Ana',
            last_name: 'Silva',
          },
        },
        {
          user_id: 'user-2',
          email_partial: null,
          user_info: {
            name: 'Bruno',
            last_name: null,
          },
        },
        {
          user_id: 'user-3',
          email_partial: null,
          user_info: null,
        },
      ]
    );

    await expect(
      service.listSectorUsersForTransferBySectorIds('acc-1', ['sec-1', 'sec-2'])
    ).resolves.toEqual([
      {
        id: 'user-1',
        name: 'Ana',
        last_name: 'Silva',
        nickname: 'nick-1',
      },
      {
        id: 'user-2',
        name: 'Bruno',
        last_name: undefined,
        nickname: undefined,
      },
      {
        id: 'user-3',
        name: '',
        last_name: undefined,
        nickname: undefined,
      },
    ]);
  });
});
