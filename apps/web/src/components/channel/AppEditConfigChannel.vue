<script lang="ts" setup>
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { VForm } from 'vuetify/components/VForm';
import { can } from '@layouts/plugins/casl';
import AppChannelTypeCards from './AppChannelTypeCards.vue';
import AppChannelConnectionStrategyDialog from './AppChannelConnectionStrategyDialog.vue';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

const settingsStore = useSettingsStore();

const props = defineProps<{
  modelValue: boolean;
  channel: ListChannelsResponse | null;
  standardAppearance?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (
    e: 'updated',
    data: {
      worker_id: string;
      worker_type?: EWorkerType;
      previous_worker_type?: EWorkerType;
      previous_session_storage?: ListChannelsResponse['session_storage'];
      previous_server_id?: string;
      previous_server_name?: string;
      server_id?: string;
      server_name?: string;
      account_id?: string;
      lifecycle_operation_id?: string;
      debug_trace_id?: string;
      connection_strategy?: EWorkerConnectionStrategy;
    }
  ): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const channel = toRef(props, 'channel');
const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);
const initialType = ref<EWorkerType | null>(null);
const initialServerId = ref<string | null>(null);
const serverId = ref<string | null>(null);
const serverItems = ref<Array<{ value: string; title: string }>>([]);
const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);
const isSaving = ref(false);
const isConnectionStrategyDialogVisible = ref(false);
const { t } = useI18n();

const isOfficialChannel = computed(
  () => initialType.value === EWorkerType.whatsapp
);
const isLegacySession = computed(
  () =>
    channel.value?.session_storage === EWorkerSessionStorage.legacy_volume &&
    initialType.value !== EWorkerType.whatsapp
);

const canChooseServer = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const disabledTypes = computed(() => {
  if (isLegacySession.value)
    return [
      EWorkerType.baileys,
      EWorkerType.wwebjs,
      EWorkerType.whatsmeow,
      EWorkerType.whatsapp,
    ];
  return isOfficialChannel.value
    ? [EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow]
    : [EWorkerType.whatsapp];
});

const isSubmitDisabled = computed(() => !type.value || !name.value?.trim());
const hasConnectionChange = computed(
  () =>
    !isLegacySession.value &&
    (Boolean(initialType.value && type.value !== initialType.value) ||
      Boolean(
        canChooseServer.value &&
        initialServerId.value &&
        serverId.value &&
        serverId.value !== initialServerId.value
      ))
);

const isLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

const loadServerOptions = async () => {
  if (!canChooseServer.value || isOfficialChannel.value) {
    serverItems.value = [];
    return;
  }

  const result = await settingsStore.getChannelServers();
  const items =
    result?.map((server) => ({
      value: server.server_id,
      title: server.name,
    })) ?? [];

  const currentServerId = channel.value?.server?.id;
  if (currentServerId) {
    const alreadyExists = items.some((item) => item.value === currentServerId);

    if (!alreadyExists) {
      items.unshift({
        value: currentServerId,
        title: channel.value?.server?.name ?? t('unknown'),
      });
    }
  }

  serverItems.value = items;
};

const initializeModal = async () => {
  if (!isVisible.value || !channel.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    name.value = channel.value.name;
    type.value = (channel.value.type?.id as EWorkerType) ?? null;
    initialType.value = type.value;
    serverId.value = channel.value.server?.id ?? null;
    initialServerId.value = serverId.value;

    await loadServerOptions();
  } finally {
    isInitializingModal.value = false;
  }
};

const persistUpdate = async (
  connectionStrategy?: EWorkerConnectionStrategy
) => {
  if (!channel.value?.id || !name.value) {
    return false;
  }

  const payload: UpdateChannelRequest = {
    channel_id: channel.value.id,
    name: name.value,
    worker_type: isLegacySession.value
      ? (initialType.value ?? undefined)
      : (type.value ?? undefined),
    connection_strategy: connectionStrategy,
  };

  if (canChooseServer.value && !isOfficialChannel.value && serverId.value) {
    payload.server_id = isLegacySession.value
      ? (initialServerId.value ?? serverId.value)
      : serverId.value;
  }

  isSaving.value = true;
  try {
    const result = await settingsStore.updateChannel(payload);
    if (!result) return;

    const previousSessionStorage = channel.value?.session_storage;
    const previousServerId = initialServerId.value ?? undefined;
    const previousServerName = serverItems.value.find(
      (item) => item.value === previousServerId
    )?.title;

    isVisible.value = false;
    await nextTick();
    if (isLifecycleAck(result)) {
      const targetServerId = result.server_id ?? payload.server_id;
      const targetServerName = serverItems.value.find(
        (item) => item.value === targetServerId
      )?.title;

      emit('updated', {
        worker_id: payload.channel_id,
        worker_type:
          (result.worker_type_id as EWorkerType | undefined) ??
          (payload.worker_type as EWorkerType | undefined),
        previous_worker_type: initialType.value ?? undefined,
        previous_session_storage: previousSessionStorage,
        previous_server_id: previousServerId,
        previous_server_name: previousServerName,
        server_id: targetServerId,
        server_name: targetServerName,
        account_id: result.account_id,
        lifecycle_operation_id: result.operation_id,
        debug_trace_id: result.debug_trace_id,
        connection_strategy: connectionStrategy,
      });
      return true;
    }

    emit('updated', {
      worker_id: payload.channel_id,
    });
    return true;
  } finally {
    isSaving.value = false;
  }
};

const updateChannel = async () => {
  const validateForm = await refFormEditChannel.value?.validate();
  if (!validateForm?.valid || isSubmitDisabled.value) return;

  if (hasConnectionChange.value) {
    isConnectionStrategyDialogVisible.value = true;
    return;
  }

  await persistUpdate();
};

const selectConnectionStrategy = async (
  connectionStrategy: EWorkerConnectionStrategy
) => {
  const updated = await persistUpdate(connectionStrategy);
  if (updated) {
    isConnectionStrategyDialogVisible.value = false;
  }
};

watch(
  isVisible,
  async (visible) => {
    if (visible && channel.value) {
      await initializeModal();
      return;
    }

    if (!visible) {
      refFormEditChannel.value?.resetValidation();
    }
  },
  { immediate: true }
);

watch(
  channel,
  async (nextChannel) => {
    if (isVisible.value && nextChannel) {
      await initializeModal();
    }
  },
  { deep: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="860">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent="updateChannel">
      <VCard :title="$t('edit_channel')" class="position-relative">
        <VOverlay
          :model-value="isInitializingModal || isSaving"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>

        <VCardText>
          <VAlert
            v-if="isLegacySession"
            color="info"
            variant="tonal"
            icon="tabler-shield-lock"
            class="mb-5"
          >
            {{ $t('legacy_session_editor_migration_required') }}
          </VAlert>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-2">
                {{ $t('channel_select_type_title') }}
              </VLabel>
              <AppChannelTypeCards
                v-model="type"
                :allow-official="isOfficialChannel"
                :lock-official="isOfficialChannel"
                :disabled-types="disabledTypes"
              />
            </VCol>

            <VCol v-if="type" cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol
              v-if="type && canChooseServer && !isOfficialChannel"
              cols="12"
              md="6"
            >
              <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
              <AppSelectSearch
                v-model="serverId"
                :items="serverItems"
                :placeholder="$t('select_server')"
                :clearable="true"
                item-value="value"
                item-title="title"
                :disabled="isLegacySession"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn type="submit" :loading="isSaving" :disabled="isSubmitDisabled">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>

  <AppChannelConnectionStrategyDialog
    v-model="isConnectionStrategyDialogVisible"
    :loading="isSaving"
    :standard-appearance="standardAppearance"
    @select="selectConnectionStrategy"
  />
</template>
