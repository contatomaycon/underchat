import { injectable } from 'tsyringe';
import { VoiceIaService } from '@core/services/voiceIa.service';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';

@injectable()
export class VoiceIaViewerUseCase {
  constructor(private readonly voiceIaService: VoiceIaService) {}

  async execute(
    voiceIaId: string,
    accountId: string
  ): Promise<ViewVoiceIaResponse | null> {
    return this.voiceIaService.viewVoiceIa(voiceIaId, accountId);
  }
}
