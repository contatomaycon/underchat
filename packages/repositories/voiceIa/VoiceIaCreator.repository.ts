import * as schema from '@core/models';
import { voiceIa } from '@core/models';
import { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

@injectable()
export class VoiceIaCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createVoiceIa = async (
    input: CreateVoiceIaRequest,
    accountId: string
  ): Promise<string | null> => {
    const voiceIaId = uuidv7();

    const result = await this.dbRw
      .insert(voiceIa)
      .values({
        voice_ia_id: voiceIaId,
        account_id: accountId,
        name: input.name,
        api_key: input.api_key,
        voice_id: input.voice_id,
        model_id: input.model_id ?? 'eleven_multilingual_v2',
        speed: input.speed ?? '1',
        stability: input.stability ?? '0.5',
        similarity_boost: input.similarity_boost ?? '0.75',
        style_exaggeration: input.style_exaggeration ?? '0',
        status: input.status ?? EVoiceIaStatus.active,
      })
      .execute();

    if (!result) {
      return null;
    }

    return voiceIaId;
  };
}
