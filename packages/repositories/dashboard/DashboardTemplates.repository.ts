import { ITemplateTotals } from '@core/common/interfaces/ITemplateTotals';
import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class DashboardTemplatesRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getTemplateTotals = async (accountId: string): Promise<ITemplateTotals> => {
    const query = `
      SELECT
        (
          SELECT COUNT(*)
          FROM contact_group
          WHERE account_id = '${accountId}' AND deleted_at IS NULL
        ) AS contact_groups_total,
        (
          SELECT COUNT(*)
          FROM message_template
          WHERE account_id = '${accountId}' AND deleted_at IS NULL
        ) AS message_templates_total,
        (
          SELECT COUNT(*)
          FROM label_template
          WHERE account_id = '${accountId}' AND deleted_at IS NULL
        ) AS label_templates_total
    `;

    const result = await this.dbRo.execute(query);
    const row = result.rows[0] ?? {};

    return {
      contactGroupsTotal: Number(row.contact_groups_total ?? 0),
      messageTemplatesTotal: Number(row.message_templates_total ?? 0),
      labelTemplatesTotal: Number(row.label_templates_total ?? 0),
    };
  };
}
