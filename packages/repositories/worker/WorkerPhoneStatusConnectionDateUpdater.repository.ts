import * as schema from '@core/models';
import { worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerPhoneStatusConnectionDateUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly connectionDate = (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ) => {
    if (input.status === EWorkerStatus.disponible || !input.number) {
      return null;
    }

    if (input.connection_date) {
      return input.connection_date;
    }

    return currentTime();
  };

  updateWorkerPhoneStatusConnectionDate = async (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ): Promise<boolean> => {
    console.log(
      '[WorkerPhoneStatusConnectionDateUpdater] Input received:',
      input
    );

    const phoneNumber =
      input.status === EWorkerStatus.disponible ? null : input.number;
    const connectionDate = this.connectionDate(input);

    console.log('[WorkerPhoneStatusConnectionDateUpdater] Computed values:', {
      phoneNumber,
      connectionDate,
      isDisponible: input.status === EWorkerStatus.disponible,
    });

    const updateData: Partial<typeof worker.$inferInsert> = {};

    if (input.status) {
      updateData.worker_status_id = input.status;
    }

    if (phoneNumber) {
      updateData.number = phoneNumber;
    }

    if (connectionDate) {
      updateData.connection_date = connectionDate;
    }

    console.log(
      '[WorkerPhoneStatusConnectionDateUpdater] Update data before check:',
      updateData
    );

    if (Object.keys(updateData).length === 0) {
      console.log(
        '[WorkerPhoneStatusConnectionDateUpdater] No fields to update, returning false'
      );
      return false;
    }

    updateData.updated_at = currentTime();

    console.log('[WorkerPhoneStatusConnectionDateUpdater] Final update data:', {
      updateData,
      worker_id: input.worker_id,
    });

    const result = await this.dbRw
      .update(worker)
      .set(updateData)
      .where(and(eq(worker.worker_id, input.worker_id)))
      .execute();

    console.log('[WorkerPhoneStatusConnectionDateUpdater] Update result:', {
      rowCount: result.rowCount,
      success: result.rowCount === 1,
    });

    return result.rowCount === 1;
  };
}
