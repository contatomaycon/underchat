import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { IWorkerConfigFields } from '@core/common/interfaces/IWorkerConfigFields';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';

@injectable()
export class WorkerConfigFieldsViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigFieldsByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigFields | null> => {
    const configMap = await this.fetchActiveConfigs(workerId);

    if (configMap.size === 0) {
      return null;
    }

    return this.buildConfigFields(configMap);
  };

  private async fetchActiveConfigs(
    workerId: string
  ): Promise<Map<EWorkerConfigType, string | null>> {
    const result = await this.dbRo
      .select({
        value: workerConfig.value,
        worker_config_type_id: workerConfig.worker_config_type_id,
      })
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.worker_id, workerId),
          eq(workerConfig.worker_config_status_id, EWorkerConfigStatus.active)
        )
      )
      .execute();

    const configMap = new Map<EWorkerConfigType, string | null>();
    for (const row of result) {
      configMap.set(row.worker_config_type_id as EWorkerConfigType, row.value);
    }

    return configMap;
  }

  private buildConfigFields(
    configMap: Map<EWorkerConfigType, string | null>
  ): IWorkerConfigFields {
    return {
      show_attendee_name: configMap.has(EWorkerConfigType.show_attendee_name)
        ? true
        : null,
      show_worker_name: configMap.has(EWorkerConfigType.show_worker_name)
        ? true
        : null,
      show_protocol_in_chat: configMap.has(
        EWorkerConfigType.show_protocol_in_chat
      )
        ? true
        : null,
      allow_attendance_only_online: configMap.has(
        EWorkerConfigType.allow_attendance_only_online
      )
        ? true
        : null,
      generate_protocol_at_start:
        configMap.get(EWorkerConfigType.generate_protocol_at_start) || null,
      generate_protocol_at_transfer:
        configMap.get(EWorkerConfigType.generate_protocol_at_transfer) || null,
      generate_protocol_at_transfer_sector:
        configMap.get(EWorkerConfigType.generate_protocol_at_transfer_sector) ||
        null,
      generate_protocol_at_transfer_sector_and_user:
        configMap.get(
          EWorkerConfigType.generate_protocol_at_transfer_sector_and_user
        ) || null,
      show_message_on_call:
        configMap.get(EWorkerConfigType.show_message_on_call) || null,
      send_message_on_finish_attendance:
        configMap.get(EWorkerConfigType.send_message_on_finish_attendance) ||
        null,
      attendance_hours:
        configMap.get(EWorkerConfigType.attendance_hours) || null,
      outside_hours_message:
        configMap.get(EWorkerConfigType.outside_hours_message) || null,
      attendance_inactivity_alert:
        configMap.get(EWorkerConfigType.attendance_inactivity_alert) || null,
      reject_call: configMap.has(EWorkerConfigType.reject_call) ? true : null,
      auto_save_contacts: configMap.has(EWorkerConfigType.auto_save_contacts)
        ? true
        : null,
      mark_as_read: configMap.has(EWorkerConfigType.mark_as_read) ? true : null,
      simultaneous_attendance: this.parseNumber(
        configMap.get(EWorkerConfigType.simultaneous_attendance)
      ),
      security_key: configMap.has(EWorkerConfigType.security_key) ? true : null,
      security_key_chatbot: configMap.has(
        EWorkerConfigType.security_key_chatbot
      )
        ? true
        : null,
      security_key_schedule: configMap.has(
        EWorkerConfigType.security_key_schedule
      )
        ? true
        : null,
      security_key_quick_message: configMap.has(
        EWorkerConfigType.security_key_quick_message
      )
        ? true
        : null,
    };
  }

  private parseNumber(value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
}
