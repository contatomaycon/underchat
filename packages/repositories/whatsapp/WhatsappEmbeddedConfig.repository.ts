import * as schema from '@core/models';
import { whatsappEmbeddedConfig } from '@core/models';
import { currentTime } from '@core/common/functions/currentTime';
import { IWhatsappEmbeddedConfigInternal } from '@core/common/interfaces/IWhatsappEmbeddedConfigInternal';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class WhatsappEmbeddedConfigRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  view = async (): Promise<IWhatsappEmbeddedConfigInternal | null> => {
    const result = await this.dbRo.query.whatsappEmbeddedConfig.findFirst({
      orderBy: (table, { desc }) => [desc(table.updated_at)],
    });

    return result ?? null;
  };

  upsert = async (input: {
    app_id: string;
    app_secret_encrypted?: string;
    configuration_id: string;
    api_version: string;
  }): Promise<IWhatsappEmbeddedConfigInternal> => {
    return this.dbRw.transaction(async (tx) => {
      const existing = await tx.query.whatsappEmbeddedConfig.findFirst({
        orderBy: (table, { desc }) => [desc(table.updated_at)],
      });

      if (!existing) {
        const id = uuidv7();
        const [created] = await tx
          .insert(whatsappEmbeddedConfig)
          .values({
            whatsapp_embedded_config_id: id,
            app_id: input.app_id,
            app_secret_encrypted: input.app_secret_encrypted ?? '',
            configuration_id: input.configuration_id,
            api_version: input.api_version,
          })
          .returning();

        return created;
      }

      const updatePayload: Partial<typeof whatsappEmbeddedConfig.$inferInsert> =
        {
          app_id: input.app_id,
          configuration_id: input.configuration_id,
          api_version: input.api_version,
          updated_at: currentTime(),
        };

      if (input.app_secret_encrypted !== undefined) {
        updatePayload.app_secret_encrypted = input.app_secret_encrypted;
      }

      const [updated] = await tx
        .update(whatsappEmbeddedConfig)
        .set(updatePayload)
        .where(
          eq(
            whatsappEmbeddedConfig.whatsapp_embedded_config_id,
            existing.whatsapp_embedded_config_id
          )
        )
        .returning();

      return updated;
    });
  };
}
