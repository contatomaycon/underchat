import * as schema from '@core/models';
import { server } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray } from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ServerStatusUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateServerStatusById = async (
    serverId: string,
    status: EServerStatus,
    expectedStatuses?: readonly EServerStatus[],
    lastSync = currentTime()
  ): Promise<boolean> => {
    const statusCondition =
      expectedStatuses && expectedStatuses.length > 0
        ? inArray(server.server_status_id, [...expectedStatuses])
        : undefined;

    const result = await this.dbRw
      .update(server)
      .set({
        server_status_id: status,
        last_sync: lastSync,
      })
      .where(
        statusCondition
          ? and(eq(server.server_id, serverId), statusCondition)
          : eq(server.server_id, serverId)
      )
      .execute();

    return result.rowCount === 1;
  };

  viewServerStatusById = async (
    serverId: string
  ): Promise<EServerStatus | null> => {
    const result = await this.dbRw
      .select({ server_status_id: server.server_status_id })
      .from(server)
      .where(eq(server.server_id, serverId))
      .limit(1)
      .execute();

    return (result[0]?.server_status_id as EServerStatus | undefined) ?? null;
  };
}
