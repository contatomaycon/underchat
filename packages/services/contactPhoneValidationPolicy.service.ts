import { inject, injectable } from 'tsyringe';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  ContactValidationPolicyRepository,
  type ContactValidationState,
} from '@core/repositories/contact/ContactValidationPolicy.repository';

interface ResolveContactPhoneValidationPolicyInput {
  accountId: string;
  contactId?: string;
  requestedChannelIds?: readonly string[];
}

export interface ContactPhoneValidationPolicy {
  channelIds: string[];
  isOfficialOnly: boolean;
  areAllChannelsResolved: boolean;
}

@injectable()
export class ContactPhoneValidationPolicyService {
  constructor(
    @inject(ContactValidationPolicyRepository)
    private readonly repository: ContactValidationPolicyRepository
  ) {}

  resolve = async ({
    accountId,
    contactId,
    requestedChannelIds,
  }: ResolveContactPhoneValidationPolicyInput): Promise<ContactPhoneValidationPolicy> => {
    const requestedIds = requestedChannelIds
      ? [...new Set(requestedChannelIds.filter(Boolean))]
      : undefined;

    let scopedChannelIds: string[] | undefined;
    if (requestedIds && requestedIds.length > 0) {
      scopedChannelIds = requestedIds;
    } else if (requestedChannelIds === undefined && contactId) {
      const assignedIds = [
        ...new Set(
          await this.repository.listContactChannelIds(accountId, contactId)
        ),
      ];
      if (assignedIds.length > 0) {
        scopedChannelIds = assignedIds;
      }
    }

    const channels = await this.repository.listAccountChannels(
      accountId,
      scopedChannelIds
    );
    const channelIds = channels.map(({ worker_id }) => worker_id);
    const areAllChannelsResolved = scopedChannelIds
      ? channelIds.length === scopedChannelIds.length
      : true;

    return {
      channelIds,
      areAllChannelsResolved,
      isOfficialOnly:
        channels.length > 0 &&
        areAllChannelsResolved &&
        channels.every(
          ({ worker_type_id }) => worker_type_id === EWorkerType.whatsapp
        ),
    };
  };

  viewValidationState = async (
    accountId: string,
    contactId: string
  ): Promise<ContactValidationState | null> => {
    return this.repository.viewValidationState(accountId, contactId);
  };
}
