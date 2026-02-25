<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useRandomMessageStore } from '@/@webcore/stores/randomMessage';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';

const randomMessageStore = useRandomMessageStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  randomMessageId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const randomMessageId = toRef(props, 'randomMessageId');

const name = ref<string>('');
const status = ref<ERandomMessageStatus>(ERandomMessageStatus.active);
const isLoading = ref(false);
const refFormEditRandomMessage = ref<VForm>();

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
  refFormEditRandomMessage.value?.resetValidation();
};

const updateRandomMessage = async () => {
  const validateForm = await refFormEditRandomMessage?.value?.validate();

  if (!validateForm?.valid) return;

  if (!randomMessageId.value) return;

  isLoading.value = true;

  try {
    const result = await randomMessageStore.updateRandomMessage(
      {
        random_message_id: randomMessageId.value,
      },
      {
        name: name.value.trim(),
        status: status.value,
      }
    );

    if (result) {
      isVisible.value = false;
      await randomMessageStore.listRandomMessages();
    }
  } finally {
    isLoading.value = false;
  }
};

watch(
  [isVisible, randomMessageId],
  async ([visible, id]) => {
    if (visible && id) {
      resetForm();

      const randomMessage = await randomMessageStore.getRandomMessageById(id);

      if (randomMessage) {
        name.value = randomMessage.name;
        status.value = randomMessage.status as ERandomMessageStatus;
      }
    } else if (!visible) {
      resetForm();
    }
  },
  { immediate: true }
);
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

    <VForm ref="refFormEditRandomMessage" @submit.prevent>
      <VCard :title="$t('edit_random_message')">
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
          <VBtn :loading="isLoading" @click="updateRandomMessage">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
