import * as schema from '@core/models';
import { aiAgent, aiAgentHumanTransferTarget } from '@core/models';
import { EAiAgentHumanTransferTargetType } from '@core/common/enums/EAiAgentHumanTransferTargetType';
import { IAiAgentHumanTransferTargetInsertRow } from '@core/common/interfaces/IAiAgentHumanTransferTargetInsertRow';
import { Transaction } from '@core/common/types/Transaction.type';
import { UpsertAiAgentHumanTransferBody } from '@core/schema/aiAgent/upsertAiAgentHumanTransfer/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class AiAgentHumanTransferUpserterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  upsert = async (
    aiAgentId: string,
    accountId: string,
    body: UpsertAiAgentHumanTransferBody
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const updated = await this.updateEnableHumanTransfer(
        tx,
        aiAgentId,
        accountId,
        body.enable_human_transfer
      );
      if (!updated) {
        return false;
      }

      await this.deleteTargetsByAiAgentId(tx, aiAgentId);

      if (body.enable_human_transfer && body.sector_targets.length > 0) {
        const rows = this.buildTargetRows(aiAgentId, accountId, body);
        if (rows.length > 0) {
          await this.insertTargetRows(tx, rows);
        }
      }

      return true;
    });
  };

  private updateEnableHumanTransfer = async (
    tx: Transaction,
    aiAgentId: string,
    accountId: string,
    enableHumanTransfer: boolean
  ): Promise<boolean> => {
    const result = await tx
      .update(aiAgent)
      .set({ enable_human_transfer: enableHumanTransfer })
      .where(
        and(
          eq(aiAgent.ai_agent_id, aiAgentId),
          eq(aiAgent.account_id, accountId)
        )
      )
      .execute();
    return result.rowCount === 1;
  };

  private deleteTargetsByAiAgentId = async (
    tx: Transaction,
    aiAgentId: string
  ): Promise<void> => {
    await tx
      .delete(aiAgentHumanTransferTarget)
      .where(eq(aiAgentHumanTransferTarget.ai_agent_id, aiAgentId))
      .execute();
  };

  private buildTargetRows = (
    aiAgentId: string,
    accountId: string,
    body: UpsertAiAgentHumanTransferBody
  ): IAiAgentHumanTransferTargetInsertRow[] => {
    const rows: IAiAgentHumanTransferTargetInsertRow[] = [];
    for (const target of body.sector_targets) {
      rows.push({
        ai_agent_id: aiAgentId,
        account_id: accountId,
        target_type: EAiAgentHumanTransferTargetType.sector,
        sector_id: target.sector_id,
        user_id: null,
      });
      for (const userId of target.user_ids) {
        rows.push({
          ai_agent_id: aiAgentId,
          account_id: accountId,
          target_type: EAiAgentHumanTransferTargetType.user,
          sector_id: target.sector_id,
          user_id: userId,
        });
      }
    }
    return rows;
  };

  private insertTargetRows = async (
    tx: Transaction,
    rows: IAiAgentHumanTransferTargetInsertRow[]
  ): Promise<void> => {
    await tx.insert(aiAgentHumanTransferTarget).values(rows).execute();
  };
}
