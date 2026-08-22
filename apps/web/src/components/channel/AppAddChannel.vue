<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EColor } from '@core/common/enums/EColor';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
import { VForm } from 'vuetify/components/VForm';
import { can } from '@layouts/plugins/casl';
import {
  isSilentWhatsappEmbeddedSignupError,
  useWhatsappEmbeddedSignup,
} from '@/composables/useWhatsappEmbeddedSignup';
import AppChannelTypeCards from './AppChannelTypeCards.vue';

type CreatedChannelPayload =
  ICreateWorkerResponse | ConnectWhatsappEmbeddedResponse;

const channelStore = useChannelsStore();
const { t } = useI18n();
const { isLoading: isSignupLoading, startSignup } = useWhatsappEmbeddedSignup();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'created', data: CreatedChannelPayload): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const canChooseServer = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const name = ref<string | null>(null);
const serverId = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);
const serverItems = ref<Array<{ value: string; title: string }>>([]);
const serversLoading = ref(false);
const refFormAddChannel = ref<VForm>();
const isAdding = ref(false);

const isOfficialSelected = computed(() => type.value === EWorkerType.whatsapp);

const isWhatsappEmbeddedConfigured = computed(
  () => channelStore.whatsappEmbeddedConfig?.is_configured === true
);

const isSubmitDisabled = computed(() => {
  if (!type.value || !name.value?.trim()) {
    return true;
  }

  return isOfficialSelected.value && !isWhatsappEmbeddedConfigured.value;
});

const submitLabel = computed(() =>
  isOfficialSelected.value
    ? t('connect_with_whatsapp_business')
    : t('connect_channel')
);

const loadWorkerServers = async () => {
  if (!canChooseServer.value) {
    return;
  }

  serversLoading.value = true;
  try {
    const result = await channelStore.listWorkerServers();

    if (result) {
      serverItems.value = result.map((s) => ({
        value: s.server_id,
        title: s.name,
      }));
    }
  } finally {
    serversLoading.value = false;
  }
};

const connectOfficialChannel = async () => {
  const config =
    channelStore.whatsappEmbeddedConfig ??
    (await channelStore.getWhatsappEmbeddedConfig());

  if (!config?.is_configured) {
    channelStore.showSnackbar(
      t('whatsapp_embedded_configure_required'),
      EColor.error
    );
    return;
  }

  const signupResult = await startSignup(config);
  const result = await channelStore.connectWhatsappEmbedded({
    name: name.value?.trim() ?? '',
    code: signupResult.code,
    business_id: signupResult.business_id,
    waba_id: signupResult.waba_id,
    phone_number_id: signupResult.phone_number_id,
  });

  if (!result) {
    return;
  }

  isVisible.value = false;
  emit('created', result);
  await channelStore.listChannels();
};

const addUnofficialChannel = async () => {
  if (!type.value) {
    return;
  }

  const payload: CreateWorkerRequest = {
    name: name.value?.trim() ?? '',
    worker_type: type.value,
  };

  if (canChooseServer.value && serverId.value) {
    payload.server_id = serverId.value;
  }

  const result = await channelStore.addChannel(payload);

  if (result) {
    isVisible.value = false;
    emit('created', result);

    await channelStore.listChannels();
  }
};

const addChannel = async () => {
  const validateForm = await refFormAddChannel.value?.validate();
  if (!validateForm?.valid || isSubmitDisabled.value) return;

  isAdding.value = true;
  try {
    if (isOfficialSelected.value) {
      await connectOfficialChannel();
      return;
    }

    await addUnofficialChannel();
  } catch (error) {
    if (isSilentWhatsappEmbeddedSignupError(error)) {
      return;
    }

    const message =
      error instanceof Error && error.message
        ? t(error.message)
        : t('whatsapp_embedded_signup_error');

    channelStore.showSnackbar(message, EColor.error);
  } finally {
    isAdding.value = false;
  }
};

const resetForm = () => {
  name.value = null;
  serverId.value = null;
  type.value = null;
  refFormAddChannel.value?.resetValidation();
};

watch(
  isVisible,
  async (visible) => {
    if (visible) {
      resetForm();
      serverItems.value = [];
      await nextTick();
      await Promise.all([
        canChooseServer.value ? loadWorkerServers() : Promise.resolve(),
        channelStore.getWhatsappEmbeddedConfig(),
      ]);
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="980">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddChannel" @submit.prevent="addChannel">
      <VCard class="channel-form position-relative">
        <VOverlay
          :model-value="channelStore.loading || isSignupLoading"
          class="align-center justify-center"
          contained
        >
          <div class="channel-form__loading">
            <VProgressCircular color="primary" indeterminate size="54" />
            <span>{{ $t('channel_form_loading') }}</span>
          </div>
        </VOverlay>

        <header class="channel-form__hero">
          <span class="channel-form__hero-icon" aria-hidden="true">
            <VIcon icon="tabler-plug-connected" size="29" />
          </span>
          <div class="channel-form__hero-copy">
            <p>{{ $t('channel_form_add_eyebrow') }}</p>
            <h2>{{ $t('add_channel') }}</h2>
            <span>{{ $t('channel_form_add_description') }}</span>
          </div>
          <div class="channel-form__step">
            <strong>01</strong>
            <span>/ 02</span>
          </div>
        </header>

        <VCardText class="channel-form__body">
          <section class="channel-form__section">
            <div class="channel-form__section-heading">
              <span class="channel-form__section-number">01</span>
              <div>
                <h3>{{ $t('channel_select_type_title') }}</h3>
                <p>{{ $t('channel_select_type_description') }}</p>
              </div>
            </div>
            <div class="channel-form__cards">
              <AppChannelTypeCards v-model="type" />
            </div>
          </section>

          <VAlert
            v-if="isOfficialSelected && !isWhatsappEmbeddedConfigured"
            type="warning"
            variant="tonal"
            border="start"
            density="comfortable"
            class="channel-form__alert"
          >
            {{ $t('whatsapp_embedded_configure_required') }}
          </VAlert>

          <Transition name="channel-fields">
            <section v-if="type" class="channel-form__section">
              <div class="channel-form__section-heading">
                <span class="channel-form__section-number">02</span>
                <div>
                  <h3>{{ $t('channel_form_identity_title') }}</h3>
                  <p>{{ $t('channel_form_identity_description') }}</p>
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
                  v-if="canChooseServer && !isOfficialSelected"
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
          </Transition>
        </VCardText>

        <VCardActions class="channel-form__actions">
          <span class="channel-form__actions-note">
            <VIcon icon="tabler-shield-check" size="17" />
            {{ $t('channel_form_secure_note') }}
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
            class="channel-form__primary-action"
            type="submit"
            color="primary"
            variant="flat"
            :loading="isAdding || isSignupLoading"
            :disabled="isSubmitDisabled"
          >
            {{ submitLabel }}
            <VIcon icon="tabler-arrow-right" end />
          </VBtn>
        </VCardActions>
      </VCard>
    </VForm>
  </VDialog>
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

.channel-form__hero-icon {
  display: grid;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.1);
  block-size: 58px;
  color: rgb(var(--v-theme-primary));
  inline-size: 58px;
  place-items: center;
}

.channel-form__hero-copy {
  display: grid;
  gap: 4px;
}

.channel-form__hero-copy p,
.channel-form__hero-copy h2,
.channel-form__hero-copy span {
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

.channel-form__step {
  display: flex;
  align-items: baseline;
  color: rgba(var(--v-theme-on-surface), 0.34);
  font-size: 0.72rem;
}

.channel-form__step strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.25rem;
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
  display: grid;
  flex: 0 0 30px;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  block-size: 30px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 800;
  inline-size: 30px;
  place-items: center;
}

.channel-form__section-heading h3,
.channel-form__section-heading p {
  margin: 0;
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

.channel-form__cards {
  padding-inline-start: 41px;
}

.channel-form__fields {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding-inline-start: 41px;
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
  min-inline-size: 158px;
  box-shadow: 0 8px 20px rgba(var(--v-theme-primary), 0.24);
}

.channel-form__primary-action.v-btn--disabled {
  background: rgba(var(--v-theme-primary), 0.34) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
  opacity: 1;
  box-shadow: none;
}

.channel-form__loading {
  display: grid;
  justify-items: center;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
  gap: 12px;
}

.channel-fields-enter-active,
.channel-fields-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.channel-fields-enter-from,
.channel-fields-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 720px) {
  .channel-form__hero {
    align-items: start;
    grid-template-columns: auto minmax(0, 1fr);
    padding: 24px 20px;
  }

  .channel-form__step {
    display: none;
  }

  .channel-form__body {
    padding: 24px 20px;
  }

  .channel-form__cards,
  .channel-form__fields {
    padding-inline-start: 0;
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

@media (prefers-reduced-motion: reduce) {
  .channel-fields-enter-active,
  .channel-fields-leave-active {
    transition: none;
  }
}
</style>
