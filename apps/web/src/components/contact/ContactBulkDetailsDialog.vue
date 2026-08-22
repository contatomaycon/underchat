<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { useContactStore } from '@/@webcore/stores/contact';
import type { BulkUpdateContactDetailsRequest } from '@core/schema/contact/bulkUpdateContactDetails/request.schema';

type BulkDetailsOperation = BulkUpdateContactDetailsRequest['operation'];

interface UserOption {
  value: string;
  title: string;
}

interface ChannelOption {
  value: string;
  title: string;
}

const model = defineModel<boolean>({ required: true });
const props = defineProps<{
  contactIds: string[];
  operation: BulkDetailsOperation;
  responsibleAttendants: UserOption[];
}>();
const emit = defineEmits<{ completed: [] }>();

const { t } = useI18n();
const contactStore = useContactStore();
const responsibleAttendantId = ref<string | null>(null);
const ignore = ref<EContactIgnore>(EContactIgnore.not_ignore);
const channelIds = ref<string[]>([]);
const channels = ref<ChannelOption[]>([]);
const notes = ref('');

const isChannelOperation = computed(
  () =>
    props.operation === 'add_channels' || props.operation === 'remove_channels'
);
const needsInput = computed(
  () =>
    props.operation !== 'remove_responsible_attendant' &&
    props.operation !== 'clear_notes'
);
const operationTitle = computed(() => {
  const titleKeys: Record<BulkDetailsOperation, string> = {
    set_responsible_attendant: 'set_responsible_attendant',
    remove_responsible_attendant: 'remove_responsible_attendant',
    set_ignore: 'set_ignore',
    add_channels: 'add_channels',
    remove_channels: 'remove_channels',
    append_notes: 'append_notes',
    clear_notes: 'clear_notes',
  };
  return t(titleKeys[props.operation]);
});
const confirmationText = computed(() =>
  t('bulk_contact_details_confirmation', { count: props.contactIds.length })
);
const canSubmit = computed(() => {
  if (!needsInput.value) return props.contactIds.length > 0;
  if (props.operation === 'set_responsible_attendant') {
    return Boolean(responsibleAttendantId.value);
  }
  if (isChannelOperation.value) return channelIds.value.length > 0;
  if (props.operation === 'append_notes') return Boolean(notes.value.trim());
  return props.contactIds.length > 0;
});

const close = () => {
  model.value = false;
};

const buildRequest = (): BulkUpdateContactDetailsRequest | null => {
  const contact_ids = props.contactIds;
  switch (props.operation) {
    case 'set_responsible_attendant':
      return responsibleAttendantId.value
        ? {
            contact_ids,
            operation: props.operation,
            user_id: responsibleAttendantId.value,
          }
        : null;
    case 'remove_responsible_attendant':
      return { contact_ids, operation: props.operation };
    case 'set_ignore':
      return { contact_ids, operation: props.operation, ignore: ignore.value };
    case 'add_channels':
    case 'remove_channels':
      return channelIds.value.length > 0
        ? { contact_ids, operation: props.operation, channel_ids: channelIds.value }
        : null;
    case 'append_notes':
      return notes.value.trim()
        ? { contact_ids, operation: props.operation, notes: notes.value.trim() }
        : null;
    case 'clear_notes':
      return { contact_ids, operation: props.operation };
  }
};

const submit = async () => {
  const request = buildRequest();
  if (!request) return;

  const result = await contactStore.bulkUpdateContactDetails(request);
  if (!result) return;

  close();
  emit('completed');
};

onMounted(async () => {
  if (!isChannelOperation.value) return;

  const response = await contactStore.listContactChannels();
  channels.value =
    response?.map((channel) => ({
      value: channel.channel_id,
      title: channel.number
        ? `${channel.name} (${channel.number})`
        : channel.name,
    })) ?? [];
});
</script>

<template>
  <VDialog v-model="model" max-width="560">
    <VCard :title="operationTitle">
      <VCardText>
        <p class="text-body-2 mb-4">{{ confirmationText }}</p>

        <AppSelectSearch
          v-if="operation === 'set_responsible_attendant'"
          v-model="responsibleAttendantId"
          :items="responsibleAttendants as any"
          :label="$t('responsible_attendant')"
          :placeholder="$t('select_responsible_attendant')"
          item-value="value"
          item-title="title"
        />

        <AppSelectSearch
          v-else-if="operation === 'set_ignore'"
          v-model="ignore"
          :items="[
            { value: EContactIgnore.not_ignore, title: $t('not_ignore') },
            {
              value: EContactIgnore.ignore_automation,
              title: $t('ignore_automation'),
            },
            {
              value: EContactIgnore.ignore_totally,
              title: $t('ignore_totally'),
            },
          ]"
          :label="$t('ignore')"
          item-value="value"
          item-title="title"
        />

        <AppSelectSearch
          v-else-if="isChannelOperation"
          v-model="channelIds"
          :items="channels as any"
          :label="$t('channels')"
          :placeholder="$t('select_channels')"
          item-value="value"
          item-title="title"
          multiple
          chips
          closable-chips
          clearable
        />

        <VTextarea
          v-else-if="operation === 'append_notes'"
          v-model="notes"
          :label="$t('notes')"
          :placeholder="$t('notes')"
          auto-grow
        />
      </VCardText>
      <VCardActions class="justify-end">
        <VBtn variant="text" @click="close">{{ $t('cancel') }}</VBtn>
        <VBtn
          :color="
            operation === 'remove_responsible_attendant' ||
            operation === 'remove_channels' ||
            operation === 'clear_notes'
              ? 'error'
              : 'primary'
          "
          :loading="contactStore.loading"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ $t('confirm') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
