import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { VoiceIaService } from '@core/services/voiceIa.service';
import { ListVoiceIaFinalResponse } from '@core/schema/voiceIa/listVoiceIa/response.schema';
import { ListVoiceIaRequest } from '@core/schema/voiceIa/listVoiceIa/request.schema';

@injectable()
export class VoiceIaListerUseCase {
  constructor(
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService
  ) {}

  async execute(
    query: ListVoiceIaRequest,
    accountId: string
  ): Promise<ListVoiceIaFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.voiceIaService.listVoiceIas(
      perPage,
      currentPage,
      query,
      accountId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
