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
  <VDialog v-model="isVisible" max-width="860">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddChannel" @submit.prevent="addChannel">
      <VCard :title="$t('add_channel')" class="position-relative">
        <VOverlay
          :model-value="channelStore.loading || isSignupLoading"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>

        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-2">
                {{ $t('channel_select_type_title') }}
              </VLabel>
              <AppChannelTypeCards v-model="type" />
            </VCol>

            <VCol
              v-if="isOfficialSelected && !isWhatsappEmbeddedConfigured"
              cols="12"
            >
              <VAlert
                type="warning"
                variant="tonal"
                border="start"
                density="comfortable"
              >
                {{ $t('whatsapp_embedded_configure_required') }}
              </VAlert>
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
              v-if="type && canChooseServer && !isOfficialSelected"
              cols="12"
              md="6"
            >
              <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
              <AppSelectSearch
                v-model="serverId"
                :items="serverItems"
                :placeholder="$t('select_server')"
                :loading="serversLoading"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            type="submit"
            :loading="isAdding || isSignupLoading"
            :disabled="isSubmitDisabled"
          >
            {{ submitLabel }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
