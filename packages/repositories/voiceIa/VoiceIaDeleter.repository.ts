import * as schema from '@core/models';
import { voiceIa } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class VoiceIaDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteVoiceIa = async (
    voiceIaId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(voiceIa)
      .where(
        and(
          eq(voiceIa.voice_ia_id, voiceIaId),
          eq(voiceIa.account_id, accountId)
        )
      )
      .execute();

    return (result?.rowCount ?? 0) > 0;
  };
}
