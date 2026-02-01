import * as schema from '@core/models';
import { voiceIa } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, ilike, SQLWrapper } from 'drizzle-orm';
import { ListVoiceIaRequest } from '@core/schema/voiceIa/listVoiceIa/request.schema';
import { ListVoiceIaResponse } from '@core/schema/voiceIa/listVoiceIa/response.schema';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';

@injectable()
export class VoiceIaListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersVoiceIa = (
    query: ListVoiceIaRequest,
    accountId: string
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [eq(voiceIa.account_id, accountId)];

    if (query.name) {
      filters.push(ilike(voiceIa.name, `%${query.name}%`));
    }

    if (query.status) {
      filters.push(eq(voiceIa.status, query.status));
    }

    return filters;
  };

  listVoiceIas = async (
    perPage: number,
    currentPage: number,
    query: ListVoiceIaRequest,
    accountId: string
  ): Promise<ListVoiceIaResponse[]> => {
    const filters = this.setFiltersVoiceIa(query, accountId);

    const result = await this.dbRo.query.voiceIa.findMany({
      where: and(...filters),
      columns: {
        voice_ia_id: true,
        name: true,
        voice_ia_type: true,
        status: true,
        created_at: true,
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
      orderBy: (v, { desc }) => [desc(v.created_at)],
    });

    if (!result) {
      return [];
    }

    const voiceIaTypeNames: Record<string, string> = {
      [EVoiceIaType.eleven_labs]: 'ElevenLabs',
      [EVoiceIaType.gpt]: 'GPT',
      [EVoiceIaType.gemini]: 'Gemini',
    };

    return result.map((item) => ({
      voice_ia_id: item.voice_ia_id,
      name: item.name,
      voice_ia_type_name:
        voiceIaTypeNames[item.voice_ia_type] ?? item.voice_ia_type,
      status: item.status,
      created_at: item.created_at,
    }));
  };

  listVoiceIasTotal = async (
    query: ListVoiceIaRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFiltersVoiceIa(query, accountId);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(voiceIa)
      .where(and(...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
