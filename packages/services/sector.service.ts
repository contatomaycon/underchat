import { injectable } from 'tsyringe';
import { SectorViewerExistsRepository } from '@core/repositories/sector/SectorViewerExists.repository';
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
import { TFunction } from 'i18next';
import { SectorByIdExistsRepository } from '@core/repositories/sector/SectorByIdExists.repository';
import { SectorCreatorRepository } from '@core/repositories/sector/SectorCreator.repository';
import { SectorUpdaterRepository } from '@core/repositories/sector/SectorUpdater.repository';
import { SectorUsersListerRepository } from '@core/repositories/sector/SectorUsersLister.repository';
import { ListSectorUsersResponse } from '@core/schema/sector/listSectorUsers/response.schema';
import { SectorAllListerRepository } from '@core/repositories/sector/SectorAllLister.repository';
import { SectorTransferListerRepository } from '@core/repositories/sector/SectorTransferLister.repository';
import { TransferSector } from '@core/schema/chat/listTransferOptions/response.schema';
import { TransferSectorResponse } from '@core/schema/chat/listTransferSectors/response.schema';
import { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';

@injectable()
export class SectorService {
  constructor(
    private readonly sectorViewerExistsRepository: SectorViewerExistsRepository,
    private readonly sectorStatusViewerExistsRepository: SectorStatusViewerExistsRepository,
    private readonly sectorListerRepository: SectorListerRepository,
    private readonly sectorViewerRepository: SectorViewerRepository,
    private readonly sectorDeleterRepository: SectorDeleterRepository,
    private readonly sectorByIdExistsRepository: SectorByIdExistsRepository,
    private readonly sectorUsersListerRepository: SectorUsersListerRepository,
    private readonly sectorAllListerRepository: SectorAllListerRepository,
    private readonly sectorTransferListerRepository: SectorTransferListerRepository,
    private readonly sectorCreatorRepository: SectorCreatorRepository,
    private readonly sectorUpdaterRepository: SectorUpdaterRepository
  ) {}

  existsSectorById = async (
    sectorId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.sectorViewerExistsRepository.existsSectorById(
      sectorId,
      accountId
    );
  };

  createSector = async (
    t: TFunction<'translation', undefined>,
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
    accountId: string
  ): Promise<[ListSectorResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.sectorListerRepository.listSector(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.sectorListerRepository.listSectorTotal(query, accountId),
    ]);

    return [result, total];
  };

  viewSectorById = async (
    sectorId: string,
    accountId: string
  ): Promise<ViewSectorResponse | null> => {
    return this.sectorViewerRepository.viewSectorById(sectorId, accountId);
  };

  deleteSectorById = async (
    sectorId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.sectorDeleterRepository.deleteSectorById(sectorId, accountId);
  };

  updateSectorById = async (
    t: TFunction<'translation', undefined>,
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string
  ): Promise<boolean> => {
    return this.sectorUpdaterRepository.updateSectorById(
      sectorId,
      input,
      accountId
    );
  };

  sectorByIdExists = async (
    sectorId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.sectorByIdExistsRepository.sectorByIdExists(
      sectorId,
      accountId
    );
  };

  listSectorUsers = async (
    accountId: string,
    sectorId: string
  ): Promise<ListSectorUsersResponse[]> => {
    return this.sectorUsersListerRepository.listSectorUsers(
      accountId,
      sectorId
    );
  };

  listAllSectors = async (accountId: string): Promise<TransferSector[]> => {
    return this.sectorAllListerRepository.listAllSectors(accountId);
  };

  listSectorsForTransfer = async (
    accountId: string
  ): Promise<TransferSectorResponse[]> => {
    return this.sectorTransferListerRepository.listSectorsForTransfer(
      accountId
    );
  };

  listSectorUsersForTransfer = async (
    accountId: string,
    sectorId: string
  ): Promise<TransferSectorUserResponse[]> => {
    const result = await this.sectorUsersListerRepository.listSectorUsers(
      accountId,
      sectorId
    );

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((user) => ({
      id: user.user_id,
      name: user.user_info?.name || user.email_partial || '',
      last_name: user.user_info?.last_name || null,
      nickname: user.email_partial || null,
      photo: user.user_info?.photo || null,
      status: user.chat_user?.status || null,
    }));
  };

  listAllSectorsForReport = async (
    accountId: string
  ): Promise<Array<{ sector_id: string; name: string }>> => {
    return this.sectorAllListerRepository.listAllSectorsForReport(accountId);
  };
}
