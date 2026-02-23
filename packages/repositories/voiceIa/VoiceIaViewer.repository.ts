import * as schema from '@core/models';
import { voiceIa } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';

@injectable()
export class VoiceIaViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewVoiceIa = async (
    voiceIaId: string,
    accountId: string
  ): Promise<ViewVoiceIaResponse | null> => {
    const result = await this.dbRo.query.voiceIa.findFirst({
      where: and(
        eq(voiceIa.voice_ia_id, voiceIaId),
        eq(voiceIa.account_id, accountId)
      ),
      columns: {
        voice_ia_id: true,
        name: true,
        voice_ia_type: true,
        api_key: true,
        status: true,
        voice_id: true,
        model_id: true,
        language_code: true,
        speed: true,
        stability: true,
        similarity_boost: true,
        style_exaggeration: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!result) {
      return null;
    }

    return {
      voice_ia_id: result.voice_ia_id,
      name: result.name,
      voice_ia_type: result.voice_ia_type,
      api_key: result.api_key,
      status: result.status,
      voice_id: result.voice_id,
      model_id: result.model_id,
      language_code: result.language_code,
      speed: result.speed,
      stability: result.stability,
      similarity_boost: result.similarity_boost,
      style_exaggeration: result.style_exaggeration,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  };
}
