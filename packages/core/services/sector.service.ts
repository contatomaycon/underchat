import { injectable } from 'tsyringe';
import { SectorViewerExistsRepository } from '@core/repositories/sector/SectorViewerExists.repository';
import { SectorCreatorRepository } from '@core/repositories/sector/SectorCreator.repository';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { SectorStatusViewerExistsRepository } from '@core/repositories/sector/SectorStatusViewerExists.repository';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';
import { ListSectorResponse } from '@core/schema/sector/listSector/response.schema';
import { SectorListerRepository } from '@core/repositories/sector/SectorLister.repository';
import { ViewSectorResponse } from '@core/schema/sector/viewSector/response.schema';
import { SectorViewerRepository } from '@core/repositories/sector/SectorViewer.repository';
import { SectorDeleterRepository } from '@core/repositories/sector/SectorDeleter.repository';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';
import { SectorUpdaterRepository } from '@core/repositories/sector/SectorUpdater.repository';

@injectable()
export class SectorService {
  constructor(
    private readonly sectorViewerExistsRepository: SectorViewerExistsRepository,
    private readonly sectorCreatorRepository: SectorCreatorRepository,
    private readonly sectorStatusViewerExistsRepository: SectorStatusViewerExistsRepository,
    private readonly sectorListerRepository: SectorListerRepository,
    private readonly sectorViewerRepository: SectorViewerRepository,
    private readonly sectorDeleterRepository: SectorDeleterRepository,
    private readonly sectorUpdaterRepository: SectorUpdaterRepository
  ) {}

  existsSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    return this.sectorViewerExistsRepository.existsSectorById(
      sectorId,
      accountId,
      isAdministrator
    );
  };

  createSector = async (
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> => {
    return this.sectorCreatorRepository.createSector(input, accountId);
  };

  existsSectorStatusById = async (sectorStatusId: string): Promise<boolean> => {
    return this.sectorStatusViewerExistsRepository.existsSectorStatusById(
      sectorStatusId
    );
  };

  listSector = async (
    perPage: number,
    currentPage: number,
    query: ListSectorRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<[ListSectorResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.sectorListerRepository.listSector(
        perPage,
        currentPage,
        query,
        accountId,
        isAdministrator
      ),
      this.sectorListerRepository.listSectorTotal(
        query,
        accountId,
        isAdministrator
      ),
    ]);

    return [result, total];
  };

  viewSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewSectorResponse | null> => {
    return this.sectorViewerRepository.viewSectorById(
      sectorId,
      accountId,
      isAdministrator
    );
  };

  deleteSectorById = async (
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    return this.sectorDeleterRepository.deleteSectorById(
      sectorId,
      accountId,
      isAdministrator
    );
  };

  updateSectorById = async (
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string
  ): Promise<string | null> => {
    return this.sectorUpdaterRepository.updateSectorById(
      sectorId,
      input,
      accountId
    );
  };
}
