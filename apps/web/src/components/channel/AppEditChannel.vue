<script lang="ts" setup>
import { computed, ref, shallowRef, toRef, watch } from 'vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { can } from '@layouts/plugins/casl';
import AppChannelTypeCards from './AppChannelTypeCards.vue';
import AppChannelConnectionStrategyDialog from './AppChannelConnectionStrategyDialog.vue';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (
    e: 'updated',
    data: {
      worker_id: string;
      worker_type?: EWorkerType;
      previous_worker_type?: EWorkerType;
      previous_session_storage?: EWorkerSessionStorage;
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
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);
const initialType = ref<EWorkerType | null>(null);
const initialSessionStorage = ref<EWorkerSessionStorage | null>(null);
const serverId = shallowRef<string | null>(null);
const initialServerId = shallowRef<string | null>(null);
const serverItems = shallowRef<Array<{ value: string; title: string }>>([]);
const serversLoading = shallowRef(false);
const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);
const isConnectionStrategyDialogVisible = ref(false);

const isOfficialChannel = computed(
  () => initialType.value === EWorkerType.whatsapp
);

const canChooseServer = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const disabledTypes = computed(() =>
  isOfficialChannel.value
    ? [EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow]
    : [EWorkerType.whatsapp]
);

const isLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

const isSubmitDisabled = computed(() => !type.value || !name.value?.trim());
const hasServerChange = computed(() =>
  Boolean(
    canChooseServer.value &&
    initialServerId.value &&
    serverId.value &&
    serverId.value !== initialServerId.value
  )
);
const hasConnectionChange = computed(
  () =>
    Boolean(initialType.value && type.value !== initialType.value) ||
    hasServerChange.value
);
const isFormLoading = computed(
  () => isInitializingModal.value || channelStore.loading
);

const loadServerOptions = async (
  currentServer?: { id: string; name: string | null } | null
) => {
  if (!canChooseServer.value || isOfficialChannel.value) {
    serverItems.value = [];
    return;
  }

  serversLoading.value = true;
  try {
    const result = await channelStore.listWorkerServers();
    const items =
      result?.map((server) => ({
        value: server.server_id,
        title: server.name,
      })) ?? [];

    if (
      currentServer?.id &&
      !items.some((item) => item.value === currentServer.id)
    ) {
      items.unshift({
        value: currentServer.id,
        title: currentServer.name ?? t('unknown'),
      });
    }

    serverItems.value = items;
  } finally {
    serversLoading.value = false;
  }
};

const persistUpdate = async (
  connectionStrategy?: EWorkerConnectionStrategy
) => {
  if (!channelId.value || !name.value) {
    return false;
  }

  const payload: EditWorkerRequest = {
    name: name.value,
    worker_id: channelId.value,
    worker_type: type.value ?? undefined,
    connection_strategy: connectionStrategy,
  };

  if (
    canChooseServer.value &&
    !isOfficialChannel.value &&
    hasServerChange.value &&
    serverId.value
  ) {
    payload.server_id = serverId.value;
  }

  const result = await channelStore.updateChannel(payload);

  if (result) {
    isVisible.value = false;
    const lifecycleAck = isLifecycleAck(result) ? result : null;
    if (lifecycleAck) {
      emit('updated', {
        worker_id: payload.worker_id,
        worker_type:
          (lifecycleAck?.worker_type_id as EWorkerType | undefined) ??
          (payload.worker_type as EWorkerType | undefined),
        previous_worker_type: initialType.value ?? undefined,
        previous_session_storage: initialSessionStorage.value ?? undefined,
        previous_server_id: initialServerId.value ?? undefined,
        previous_server_name: serverItems.value.find(
          (item) => item.value === initialServerId.value
        )?.title,
        server_id: lifecycleAck.server_id ?? payload.server_id,
        server_name: serverItems.value.find(
          (item) => item.value === (lifecycleAck.server_id ?? payload.server_id)
        )?.title,
        account_id: lifecycleAck?.account_id,
        lifecycle_operation_id: lifecycleAck?.operation_id,
        debug_trace_id: lifecycleAck?.debug_trace_id,
        connection_strategy: connectionStrategy,
      });
    }

    await channelStore.listChannels();
    return true;
  }
  return false;
};

const updateServer = async () => {
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

const initializeModal = async () => {
  if (!isVisible.value || !channelId.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    const channel = await channelStore.getWorkerById(channelId.value);
    if (channel) {
      name.value = channel.name;
      type.value = (channel.type?.id as EWorkerType) ?? null;
      initialType.value = type.value;
      initialSessionStorage.value = channel.session_storage;
      serverId.value = channel.server?.id ?? null;
      initialServerId.value = serverId.value;
      await loadServerOptions(channel.server);
    }
  } finally {
    isInitializingModal.value = false;
  }
};

watch(
  isVisible,
  async (visible) => {
    if (visible && channelId.value) {
      await initializeModal();
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="980">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent="updateServer">
      <VCard
        class="channel-form position-relative"
        data-testid="edit-channel-dialog"
        :aria-busy="isFormLoading"
      >
        <VOverlay
          :model-value="isFormLoading"
          class="channel-form__loading-overlay align-center justify-center"
          scrim="surface"
          opacity="0.96"
          contained
          persistent
        >
          <div
            class="channel-form__loading"
            data-testid="edit-channel-loading"
            role="status"
            aria-live="polite"
          >
            <span class="channel-form__loading-indicator" aria-hidden="true">
              <VProgressCircular
                color="primary"
                indeterminate
                size="36"
                width="4"
              />
            </span>
            <span class="channel-form__loading-copy">
              <strong>{{ $t('channel_form_loading') }}</strong>
              <small>{{ $t('please_wait') }}</small>
            </span>
          </div>
        </VOverlay>

        <header class="channel-form__hero">
          <span class="channel-form__hero-icon" aria-hidden="true">
            <VIcon icon="tabler-adjustments" size="29" />
          </span>
          <div class="channel-form__hero-copy">
            <p>{{ $t('channel_form_edit_eyebrow') }}</p>
            <h2>{{ $t('edit_channel') }}</h2>
            <span>{{ $t('channel_form_edit_description') }}</span>
          </div>
          <VChip color="primary" variant="tonal" size="small">
            <VIcon icon="tabler-shield-check" size="15" start />
            {{ $t('channel_form_safe_edit') }}
          </VChip>
        </header>

        <VCardText class="channel-form__body">
          <section class="channel-form__section">
            <div class="channel-form__section-heading">
              <span class="channel-form__section-number">01</span>
              <div>
                <h3>{{ $t('channel_select_type_title') }}</h3>
                <p>{{ $t('channel_edit_type_description') }}</p>
              </div>
            </div>
            <div class="channel-form__cards">
              <AppChannelTypeCards
                v-model="type"
                :allow-official="isOfficialChannel"
                :lock-official="isOfficialChannel"
                :disabled-types="disabledTypes"
              />
            </div>
          </section>

          <section v-if="type" class="channel-form__section">
            <div class="channel-form__section-heading">
              <span class="channel-form__section-number">02</span>
              <div>
                <h3>{{ $t('channel_form_identity_title') }}</h3>
                <p>{{ $t('channel_form_edit_identity_description') }}</p>
              </div>
            </div>

            <div class="channel-form__fields">
              <div class="channel-form__field">
                <VLabel>{{ $t('name') }}</VLabel>
                <small>{{ $t('channel_form_name_hint') }}</small>
                <AppTextField
                  v-model="name"
                  :placeholder="$t('name')"
                  :rules="[requiredValidator(name, $t('name_required'))]"
                />
              </div>

              <div
                v-if="canChooseServer && !isOfficialChannel"
                class="channel-form__field"
              >
                <VLabel>{{ $t('server') }}</VLabel>
                <small>{{ $t('channel_form_server_hint') }}</small>
                <AppSelectSearch
                  v-model="serverId"
                  :items="serverItems"
                  :placeholder="$t('select_server')"
                  :loading="serversLoading"
                  :clearable="true"
                  item-value="value"
                  item-title="title"
                />
              </div>
            </div>
          </section>

          <VAlert
            v-if="hasConnectionChange"
            color="info"
            variant="tonal"
            density="comfortable"
            icon="tabler-arrows-right-left"
            class="channel-form__change-alert"
          >
            {{ $t('channel_form_connection_change_note') }}
          </VAlert>
        </VCardText>

        <VCardActions class="channel-form__actions">
          <span class="channel-form__actions-note">
            <VIcon icon="tabler-shield-lock" size="17" />
            {{ $t('channel_form_edit_secure_note') }}
          </span>
          <VSpacer />
          <VBtn
            class="channel-form__cancel-action"
            variant="outlined"
            color="secondary"
            prepend-icon="tabler-x"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            data-testid="edit-channel-save"
            class="channel-form__primary-action"
            type="submit"
            color="primary"
            variant="flat"
            :disabled="isSubmitDisabled"
          >
            {{ $t('save') }}
            <VIcon icon="tabler-arrow-right" end />
          </VBtn>
        </VCardActions>
      </VCard>
    </VForm>
  </VDialog>

  <AppChannelConnectionStrategyDialog
    v-model="isConnectionStrategyDialogVisible"
    :loading="channelStore.loading"
    @select="selectConnectionStrategy"
  />
</template>

<style scoped lang="scss">
.channel-form {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 22px;
  box-shadow: 0 32px 90px rgba(24, 39, 75, 0.2);
}

.channel-form__hero {
  display: grid;
  align-items: center;
  gap: 16px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 26px 30px;
  background:
    radial-gradient(
      circle at 92% 12%,
      rgba(var(--v-theme-info), 0.14),
      transparent 34%
    ),
    linear-gradient(135deg, rgba(var(--v-theme-primary), 0.1), transparent 58%);
}

.channel-form__hero-icon,
.channel-form__section-number {
  display: grid;
  color: rgb(var(--v-theme-primary));
  place-items: center;
}

.channel-form__hero-icon {
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.1);
  block-size: 58px;
  inline-size: 58px;
}

.channel-form__hero-copy {
  display: grid;
  gap: 4px;
}

.channel-form__hero-copy p,
.channel-form__hero-copy h2,
.channel-form__hero-copy span,
.channel-form__section-heading h3,
.channel-form__section-heading p {
  margin: 0;
}

.channel-form__hero-copy p {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.channel-form__hero-copy h2 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.55rem;
  font-weight: 780;
  letter-spacing: -0.03em;
}

.channel-form__hero-copy span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  line-height: 1.5;
}

.channel-form__body {
  display: grid;
  gap: 22px;
  padding: 26px 30px 30px;
}

.channel-form__section {
  display: grid;
  gap: 16px;
}

.channel-form__section-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.channel-form__section-number {
  flex: 0 0 30px;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  block-size: 30px;
  font-size: 0.7rem;
  font-weight: 800;
  inline-size: 30px;
}

.channel-form__section-heading h3 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.94rem;
  font-weight: 740;
}

.channel-form__section-heading p {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.76rem;
  line-height: 1.45;
  margin-block-start: 2px;
}

.channel-form__cards,
.channel-form__fields,
.channel-form__change-alert {
  margin-inline-start: 41px;
}

.channel-form__fields {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.channel-form__field {
  display: grid;
  gap: 5px;
}

.channel-form__field :deep(.v-label) {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
  font-weight: 700;
}

.channel-form__field small {
  min-block-size: 17px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
}

.channel-form__actions {
  padding: 18px 30px 22px;
  border-block-start: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.channel-form__actions-note {
  display: inline-flex;
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.72rem;
  gap: 7px;
}

.channel-form__actions-note :deep(.v-icon) {
  color: rgb(var(--v-theme-success));
}

.channel-form__cancel-action,
.channel-form__primary-action {
  min-block-size: 42px;
  border-radius: 9px;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0;
  padding-inline: 18px;
  text-transform: none;
}

.channel-form__cancel-action {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.76) !important;
}

.channel-form__primary-action {
  min-inline-size: 116px;
  box-shadow: 0 8px 20px rgba(var(--v-theme-primary), 0.24);
}

.channel-form__primary-action.v-btn--disabled {
  background: rgba(var(--v-theme-primary), 0.34) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
  opacity: 1;
  box-shadow: none;
}

.channel-form__loading-overlay {
  z-index: 4 !important;
}

.channel-form__loading {
  display: grid;
  align-items: center;
  border: 1px solid rgb(var(--v-theme-primary) / 20%);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 18px 48px rgb(18 32 66 / 16%),
    0 2px 8px rgb(18 32 66 / 8%);
  gap: 14px;
  grid-template-columns: auto minmax(0, 1fr);
  inline-size: min(360px, calc(100vw - 64px));
  padding-block: 18px;
  padding-inline: 20px;
}

.channel-form__loading-indicator {
  display: grid;
  border: 1px solid rgb(var(--v-theme-primary) / 12%);
  border-radius: 13px;
  background: rgb(var(--v-theme-primary) / 8%);
  block-size: 54px;
  inline-size: 54px;
  place-items: center;
}

.channel-form__loading-copy {
  display: grid;
  gap: 3px;
}

.channel-form__loading-copy strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.88rem;
  font-weight: 750;
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.channel-form__loading-copy small {
  color: rgb(var(--v-theme-on-surface) / 58%);
  font-size: 0.72rem;
  line-height: 1.4;
}

@media (max-width: 720px) {
  .channel-form__hero {
    align-items: start;
    grid-template-columns: auto minmax(0, 1fr);
    padding: 24px 20px;
  }

  .channel-form__hero > :deep(.v-chip) {
    display: none;
  }

  .channel-form__body {
    padding: 24px 20px;
  }

  .channel-form__cards,
  .channel-form__fields,
  .channel-form__change-alert {
    margin-inline-start: 0;
  }

  .channel-form__fields {
    grid-template-columns: 1fr;
  }

  .channel-form__actions {
    align-items: stretch;
    flex-direction: column;
    padding: 18px 20px;
  }

  .channel-form__actions-note,
  .channel-form__actions :deep(.v-spacer) {
    display: none;
  }
}
</style>
