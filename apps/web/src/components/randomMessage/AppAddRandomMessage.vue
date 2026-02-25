<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useRandomMessageStore } from '@/@webcore/stores/randomMessage';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';

const randomMessageStore = useRandomMessageStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string>('');
const status = ref<ERandomMessageStatus>(ERandomMessageStatus.active);
const isLoading = ref(false);
const refFormAddRandomMessage = ref<VForm>();

const itemsStatus = ref([
  { value: ERandomMessageStatus.active, text: t('active') },
  { value: ERandomMessageStatus.inactive, text: t('inactive') },
]);

const nameMaxLengthRule = (value: string) => {
  if (!value) return true;

  if (value.length > 250) {
    return t('random_message_name_max_250');
  }

  return true;
};

const resetForm = () => {
  name.value = '';
  status.value = ERandomMessageStatus.active;
  refFormAddRandomMessage.value?.resetValidation();
};

const addRandomMessage = async () => {
  const validateForm = await refFormAddRandomMessage?.value?.validate();

  if (!validateForm?.valid) return;

  isLoading.value = true;

  try {
    const result = await randomMessageStore.addRandomMessage({
      name: name.value.trim(),
      status: status.value,
    });

    if (result) {
      isVisible.value = false;
      await randomMessageStore.listRandomMessages();
    }
  } finally {
    isLoading.value = false;
  }
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" :persistent="isLoading">
    <DialogCloseBtn :disabled="isLoading" @click="isVisible = false" />

    <VOverlay
      :model-value="isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddRandomMessage" @submit.prevent>
      <VCard :title="$t('add_random_message')">
        <VCardText>
          <VRow no-gutters>
            <VCol cols="12" class="mb-3">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[
                  requiredValidator(name, $t('random_message_name_required')),
                  nameMaxLengthRule,
                ]"
                :maxlength="250"
                counter="250"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="status"
                :items="itemsStatus"
                :placeholder="$t('status')"
                :clearable="false"
                item-value="value"
                item-title="text"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isLoading"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn :loading="isLoading" @click="addRandomMessage">
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
