import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { ServerLogsInstallQuery } from '@core/schema/server/serverLogsInstall/request.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ServerLogsInstallResponse } from '@core/schema/server/serverLogsInstall/response.schema';

@injectable()
export class ServerLogsInstallUseCase {
  constructor(
    private readonly serverService: ServerService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: string,
    query: ServerLogsInstallQuery
  ): Promise<ServerLogsInstallResponse[]> {
    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    const from = query.from ?? 0;
    const size = query.size ?? 100;
    const sort = query.sort ?? ESortOrder.desc;

    const queryElastic = {
      from: from,
      size: size,
      sort: [{ date: sort }],
      query: {
        term: { server_id: serverId },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.install_server,
      queryElastic
    );

    if (!result) {
      return [];
    }

    return result.hits.hits.map(
      (hit) => hit._source
    ) as ServerLogsInstallResponse[];
  }
}
