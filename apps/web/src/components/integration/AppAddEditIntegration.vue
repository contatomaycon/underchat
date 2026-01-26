<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';

const { t } = useI18n();
const integrationStore = useIntegrationStore();

const props = defineProps<{
  modelValue: boolean;
  apiKeyId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  created: [];
  updated: [];
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isEditMode = computed(() => !!props.apiKeyId);
const isInitializingModal = ref(false);
const refForm = ref<VForm>();

const name = ref('');
const workerId = ref<string | null>(null);
const workers = ref<Array<{ value: string; title: string }>>([]);
const workersLoading = ref(false);

const loadWorkers = async () => {
  if (workers.value.length > 0) {
    return;
  }

  workersLoading.value = true;
  try {
    const result = await integrationStore.listAvailableChannels();

    if (result) {
      workers.value = result.map((w: { id: string; name: string; number: string | null }) => ({
        value: w.id,
        title: w.number ? `${w.name} (${w.number})` : w.name,
      }));
    }
  } catch {
  } finally {
    workersLoading.value = false;
  }
};

const loadIntegration = async () => {
  if (!props.apiKeyId) {
    return;
  }

  isInitializingModal.value = true;
  try {
    const integration = await integrationStore.viewIntegrationById(
      props.apiKeyId
    );

    if (integration) {
      name.value = integration.name;
      workerId.value = integration.worker_id;
    }
  } catch {
  } finally {
    isInitializingModal.value = false;
  }
};

const saveIntegration = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) {
    return;
  }

  if (!name.value || !workerId.value) {
    return;
  }

  if (isEditMode.value && props.apiKeyId) {
    const request: UpdateIntegrationRequest = {
      name: name.value,
      worker_id: workerId.value,
    };

    const success = await integrationStore.updateIntegration(
      props.apiKeyId,
      request
    );

    if (success) {
      emit('updated');
    }
  } else {
    const request: CreateIntegrationRequest = {
      name: name.value,
      worker_id: workerId.value,
    };

    const result = await integrationStore.createIntegration(request);

    if (result) {
      emit('created');
    }
  }
};

const resetForm = () => {
  name.value = '';
  workerId.value = null;
  refForm.value?.resetValidation();
};

watch(isVisible, async (visible) => {
  if (visible) {
    await loadWorkers();
    if (isEditMode.value) {
      await nextTick();
      await loadIntegration();
    } else {
      resetForm();
    }
  }
});

onMounted(async () => {
  if (isVisible.value) {
    await loadWorkers();
    if (isEditMode.value) {
      await loadIntegration();
    }
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="isInitializingModal || integrationStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refForm" @submit.prevent>
      <VCard
        :title="isEditMode ? $t('edit_integration') : $t('add_integration')"
      >
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('channel') }} *</VLabel>
              <AppSelectSearch
                v-model="workerId"
                :items="workers"
                :placeholder="$t('select_channel')"
                :loading="workersLoading"
                :rules="[requiredValidator(workerId, $t('channel_required'))]"
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
          <VBtn @click="saveIntegration">
            {{ isEditMode ? $t('save') : $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
