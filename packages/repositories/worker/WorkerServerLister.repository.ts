import * as schema from '@core/models';
import { server, serverSsh, serverWeb, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  lt,
  count,
  asc,
  desc,
  notInArray,
  sql,
} from 'drizzle-orm';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IListWorkerServer } from '@core/common/interfaces/IListWorkerServer';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';

@injectable()
export class WorkerServerListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listWorkerServers = async (): Promise<IListWorkerServer[]> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        name: server.name,
      })
      .from(server)
      .leftJoin(
        worker,
        and(
          eq(worker.server_id, server.server_id),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.blocked,
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
          ])
        )
      )
      .where(
        and(
          isNull(server.deleted_at),
          sql`EXISTS (
            SELECT 1
            FROM "server_web" AS active_web
            WHERE active_web."server_id" = ${server.server_id}
              AND active_web."deleted_at" IS NULL
          )`,
          eq(server.server_status_id, EServerStatus.online)
        )
      )
      .groupBy(server.server_id, server.quantity_workers, server.name)
      .having(lt(count(worker.worker_id), server.quantity_workers))
      .orderBy(asc(count(worker.worker_id)), asc(server.server_id))
      .execute();

    return result as IListWorkerServer[];
  };

  listWarmPoolEligibleServers = async (): Promise<IListWorkerServer[]> => {
    const result = await this.dbRo
      .select({
        server_id: server.server_id,
        name: server.name,
      })
      .from(server)
      .where(
        and(
          isNull(server.deleted_at),
          sql`EXISTS (
            SELECT 1
            FROM "server_web" AS active_web
            WHERE active_web."server_id" = ${server.server_id}
              AND active_web."deleted_at" IS NULL
          )`,
          eq(server.server_status_id, EServerStatus.online)
        )
      )
      .orderBy(server.name)
      .execute();

    return result as IListWorkerServer[];
  };

  listWarmPoolEligibleBalanceServers = async (): Promise<
    IBalanceMonitorServer[]
  > => {
    const result = await this.dbRo
      .selectDistinctOn([server.server_id], {
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
      .where(
        and(
          isNull(server.deleted_at),
          isNull(serverSsh.deleted_at),
          isNull(serverWeb.deleted_at),
          eq(server.server_status_id, EServerStatus.online)
        )
      )
      .orderBy(
        server.server_id,
        desc(serverWeb.updated_at),
        desc(serverWeb.created_at),
        desc(serverWeb.server_web_id),
        desc(serverSsh.updated_at),
        desc(serverSsh.created_at),
        desc(serverSsh.server_ssh_id)
      )
      .execute();

    return result as IBalanceMonitorServer[];
  };

  /**
   * Physical reconciliation must keep running while a Balance process is
   * stopped/offline. Exclude only deleted ownership/credentials; online status
   * remains a replenishment gate, not a garbage-collection gate.
   */
  listWarmPoolReconcileBalanceServers = async (): Promise<
    IBalanceMonitorServer[]
  > => {
    const result = await this.dbRo
      .selectDistinctOn([server.server_id], {
        server_id: server.server_id,
        server_status_id: server.server_status_id,
        ssh_ip: serverSsh.ssh_ip,
        ssh_port: serverSsh.ssh_port,
        ssh_username: serverSsh.ssh_username,
        ssh_password: serverSsh.ssh_password,
        web_domain: serverWeb.web_domain,
        web_port: serverWeb.web_port,
        web_protocol: serverWeb.web_protocol,
      })
      .from(server)
      .innerJoin(serverSsh, eq(serverSsh.server_id, server.server_id))
      .innerJoin(serverWeb, eq(serverWeb.server_id, server.server_id))
      .where(
        and(
          isNull(server.deleted_at),
          isNull(serverSsh.deleted_at),
          isNull(serverWeb.deleted_at)
        )
      )
      .orderBy(
        server.server_id,
        desc(serverWeb.updated_at),
        desc(serverWeb.created_at),
        desc(serverWeb.server_web_id),
        desc(serverSsh.updated_at),
        desc(serverSsh.created_at),
        desc(serverSsh.server_ssh_id)
      )
      .execute();

    return result as IBalanceMonitorServer[];
  };
}
