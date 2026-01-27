import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class LabelTemplateViewerByNameRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewLabelTemplateByName = async (
    accountId: string,
    labelName: string
  ): Promise<{
    label_template_id: string;
    label: string;
    color: string;
  } | null> => {
    const result = await this.dbRo
      .select({
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          eq(labelTemplate.label, labelName),
          isNull(labelTemplate.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };

  viewLabelTemplateByNameInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountId: string,
    labelName: string
  ): Promise<{
    label_template_id: string;
    label: string;
    color: string;
  } | null> => {
    const result = await tx
      .select({
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          eq(labelTemplate.label, labelName),
          isNull(labelTemplate.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };
}
