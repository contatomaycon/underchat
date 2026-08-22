<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useContactStore } from '@/@webcore/stores/contact';

type BulkLabelOperation = 'add' | 'remove';

interface LabelTemplateOption {
  value: string;
  title: string;
  color: string;
}

const model = defineModel<boolean>({ required: true });
const props = defineProps<{
  contactIds: string[];
  labelTemplates: LabelTemplateOption[];
  operation: BulkLabelOperation;
}>();
const emit = defineEmits<{ completed: [] }>();

const { t } = useI18n();
const contactStore = useContactStore();
const selectedLabelTemplateIds = ref<string[]>([]);

const isAdding = computed(() => props.operation === 'add');
const title = computed(() =>
  t(isAdding.value ? 'add_labels_to_contacts' : 'remove_labels_from_contacts')
);
const confirmLabel = computed(() =>
  t(isAdding.value ? 'add_labels' : 'remove_labels')
);
const confirmationText = computed(() =>
  t(
    isAdding.value
      ? 'bulk_add_labels_confirmation'
      : 'bulk_remove_labels_confirmation',
    { count: props.contactIds.length }
  )
);
const canSubmit = computed(
  () =>
    props.contactIds.length > 0 && selectedLabelTemplateIds.value.length > 0
);
const selectedLabelTemplates = computed(() =>
  selectedLabelTemplateIds.value
    .map((labelTemplateId) =>
      props.labelTemplates.find(
        (labelTemplate) => labelTemplate.value === labelTemplateId
      )
    )
    .filter((labelTemplate): labelTemplate is LabelTemplateOption =>
      Boolean(labelTemplate)
    )
);

const close = () => {
  selectedLabelTemplateIds.value = [];
  model.value = false;
};

const removeSelectedLabel = (labelTemplateId: string) => {
  selectedLabelTemplateIds.value = selectedLabelTemplateIds.value.filter(
    (id) => id !== labelTemplateId
  );
};

const submit = async () => {
  if (!canSubmit.value) return;

  const result = await contactStore.bulkUpdateContactLabels({
    contact_ids: props.contactIds,
    label_template_ids: selectedLabelTemplateIds.value,
    operation: props.operation,
  });
  if (!result) return;

  close();
  emit('completed');
};
</script>

<template>
  <VDialog v-model="model" max-width="560">
    <VCard :title="title">
      <VCardText>
        <p class="text-body-2 mb-4">{{ confirmationText }}</p>
        <AppSelectSearch
          v-model="selectedLabelTemplateIds"
          :items="labelTemplates as any"
          :label="$t('labels')"
          :placeholder="$t('select_labels')"
          item-value="value"
          item-title="title"
          multiple
          chips
          closable-chips
          clearable
        >
          <template #chip="{ item }">
            <div class="d-flex align-center gap-1">
              <div
                v-if="item?.color"
                class="label-color-circle"
                :style="{ backgroundColor: item.color }"
              />
              <span>{{ item?.title }}</span>
            </div>
          </template>
          <template #item-prepend="{ item }">
            <div
              v-if="item?.color"
              class="label-color-circle"
              :style="{ backgroundColor: item.color }"
            />
          </template>
        </AppSelectSearch>
        <div
          v-if="selectedLabelTemplateIds.length > 0"
          class="d-flex flex-wrap align-center gap-2 mt-2"
        >
          <VChip
            v-for="labelTemplate in selectedLabelTemplates"
            :key="labelTemplate.value"
            :color="labelTemplate.color"
            size="small"
            closable
            @click:close="removeSelectedLabel(labelTemplate.value)"
          >
            {{ labelTemplate.title }}
          </VChip>
        </div>
      </VCardText>
      <VCardActions class="justify-end">
        <VBtn variant="text" @click="close">{{ $t('cancel') }}</VBtn>
        <VBtn
          :color="isAdding ? 'primary' : 'error'"
          :loading="contactStore.loading"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ confirmLabel }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.label-color-circle {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: 0 0 auto;
}
</style>
