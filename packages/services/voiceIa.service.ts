import { injectable, inject } from 'tsyringe';
import { VoiceIaListerRepository } from '@core/repositories/voiceIa/VoiceIaLister.repository';
import { VoiceIaCreatorRepository } from '@core/repositories/voiceIa/VoiceIaCreator.repository';
import { VoiceIaViewerRepository } from '@core/repositories/voiceIa/VoiceIaViewer.repository';
import { VoiceIaUpdaterRepository } from '@core/repositories/voiceIa/VoiceIaUpdater.repository';
import { VoiceIaDeleterRepository } from '@core/repositories/voiceIa/VoiceIaDeleter.repository';
import { ListVoiceIaRequest } from '@core/schema/voiceIa/listVoiceIa/request.schema';
import { ListVoiceIaResponse } from '@core/schema/voiceIa/listVoiceIa/response.schema';
import { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';
import { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';

@injectable()
export class VoiceIaService {
  constructor(
    @inject(VoiceIaListerRepository)
    private readonly voiceIaListerRepository: VoiceIaListerRepository,
    @inject(VoiceIaCreatorRepository)
    private readonly voiceIaCreatorRepository: VoiceIaCreatorRepository,
    @inject(VoiceIaViewerRepository)
    private readonly voiceIaViewerRepository: VoiceIaViewerRepository,
    @inject(VoiceIaUpdaterRepository)
    private readonly voiceIaUpdaterRepository: VoiceIaUpdaterRepository,
    @inject(VoiceIaDeleterRepository)
    private readonly voiceIaDeleterRepository: VoiceIaDeleterRepository
  ) {}

  listVoiceIas = async (
    perPage: number,
    currentPage: number,
    query: ListVoiceIaRequest,
    accountId: string
  ): Promise<[ListVoiceIaResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.voiceIaListerRepository.listVoiceIas(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.voiceIaListerRepository.listVoiceIasTotal(query, accountId),
    ]);

    return [result, total];
  };

  createVoiceIa = async (
    input: CreateVoiceIaRequest,
    accountId: string
  ): Promise<string | null> => {
    return this.voiceIaCreatorRepository.createVoiceIa(input, accountId);
  };

  viewVoiceIa = async (
    voiceIaId: string,
    accountId: string
  ): Promise<ViewVoiceIaResponse | null> => {
    return this.voiceIaViewerRepository.viewVoiceIa(voiceIaId, accountId);
  };

  updateVoiceIa = async (
    voiceIaId: string,
    accountId: string,
    input: UpdateVoiceIaRequest
  ): Promise<boolean> => {
    return this.voiceIaUpdaterRepository.updateVoiceIa(
      voiceIaId,
      accountId,
      input
    );
  };

  deleteVoiceIa = async (
    voiceIaId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.voiceIaDeleterRepository.deleteVoiceIa(voiceIaId, accountId);
  };
}
