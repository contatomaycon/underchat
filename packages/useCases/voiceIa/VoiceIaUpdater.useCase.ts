import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { VoiceIaService } from '@core/services/voiceIa.service';
import { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';
import { prepareVoiceIaUpdateConfiguration } from '@core/common/functions/voiceIaProviderConfiguration';

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

    const providerChanged =
      input.voice_ia_type !== null &&
      input.voice_ia_type !== undefined &&
      input.voice_ia_type !== exists.voice_ia_type;
    if (
      providerChanged &&
      (!input.api_key?.trim() || !input.voice_id?.trim())
    ) {
      return false;
    }

    const normalizedInput = prepareVoiceIaUpdateConfiguration({
      current: exists,
      input,
    });

    return this.voiceIaService.updateVoiceIa(
      voiceIaId,
      accountId,
      normalizedInput
    );
  }
}
