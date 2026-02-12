import { injectable, inject } from 'tsyringe';
import { VoiceIaService } from '@core/services/voiceIa.service';
import { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';

@injectable()
export class VoiceIaCreatorUseCase {
  constructor(
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService
  ) {}

  async execute(
    input: CreateVoiceIaRequest,
    accountId: string
  ): Promise<string | null> {
    return this.voiceIaService.createVoiceIa(input, accountId);
  }
}
