import * as schema from '@core/models';
import { voiceIa } from '@core/models';
import { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class VoiceIaUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateVoiceIaRequest
  ): Partial<typeof voiceIa.$inferInsert> {
    const inputUpdate: Partial<typeof voiceIa.$inferInsert> = {};

    if (input.name !== undefined) {
      inputUpdate.name = input.name ?? undefined;
    }
    if (input.api_key !== undefined) {
      inputUpdate.api_key = input.api_key ?? undefined;
    }
    if (input.voice_id !== undefined) {
      inputUpdate.voice_id = input.voice_id ?? undefined;
    }
    if (input.model_id !== undefined) {
      inputUpdate.model_id = input.model_id ?? undefined;
    }
    if (input.speed !== undefined) {
      inputUpdate.speed = input.speed ?? undefined;
    }
    if (input.stability !== undefined) {
      inputUpdate.stability = input.stability ?? undefined;
    }
    if (input.similarity_boost !== undefined) {
      inputUpdate.similarity_boost = input.similarity_boost ?? undefined;
    }
    if (input.style_exaggeration !== undefined) {
      inputUpdate.style_exaggeration = input.style_exaggeration ?? undefined;
    }
    if (input.status !== undefined) {
      inputUpdate.status = input.status ?? undefined;
    }
    if (input.enable_transcription !== undefined) {
      inputUpdate.enable_transcription =
        input.enable_transcription ?? undefined;
    }

    return inputUpdate;
  }

  updateVoiceIa = async (
    voiceIaId: string,
    accountId: string,
    input: UpdateVoiceIaRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return true;
    }

    const result = await this.dbRw
      .update(voiceIa)
      .set({
        ...updateInput,
        updated_at: new Date().toISOString(),
      })
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
