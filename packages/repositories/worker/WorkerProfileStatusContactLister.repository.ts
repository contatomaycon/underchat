import * as schema from '@core/models';
import { workerProfileStatusContact, contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class WorkerProfileStatusContactListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listContactsByStatusId = async (
    workerProfileStatusId: string
  ): Promise<{ phone_ddi: string | null; phone: string | null }[]> => {
    const result = await this.dbRo
      .select({
        phone_ddi: contact.phone_ddi,
        phone: contact.phone,
      })
      .from(workerProfileStatusContact)
      .innerJoin(
        contact,
        eq(workerProfileStatusContact.contact_id, contact.contact_id)
      )
      .where(
        and(
          eq(
            workerProfileStatusContact.worker_profile_status_id,
            workerProfileStatusId
          ),
          isNull(contact.deleted_at)
        )
      )
      .execute();

    return result.map(
      (item: { phone_ddi: string | null; phone: string | null }) => ({
        phone_ddi: item.phone_ddi ?? null,
        phone: item.phone ?? null,
      })
    );
  };
}
