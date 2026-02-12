import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { VoiceIaService } from '@core/services/voiceIa.service';

@injectable()
export class VoiceIaDeleterUseCase {
  constructor(
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    voiceIaId: string,
    accountId: string
  ): Promise<boolean> {
    const exists = await this.voiceIaService.viewVoiceIa(voiceIaId, accountId);

    if (!exists) {
      throw new Error(t('voice_ia_not_found'));
    }

    return this.voiceIaService.deleteVoiceIa(voiceIaId, accountId);
  }
}
