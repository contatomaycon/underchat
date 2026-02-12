import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { VoiceIaService } from '@core/services/voiceIa.service';
import { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';

@injectable()
export class VoiceIaUpdaterUseCase {
  constructor(
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    voiceIaId: string,
    accountId: string,
    input: UpdateVoiceIaRequest
  ): Promise<boolean> {
    const exists = await this.voiceIaService.viewVoiceIa(voiceIaId, accountId);

    if (!exists) {
      throw new Error(t('voice_ia_not_found'));
    }

    return this.voiceIaService.updateVoiceIa(voiceIaId, accountId, input);
  }
}
