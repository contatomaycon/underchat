<script lang="ts" setup>
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { ref, computed, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EColor } from '@core/common/enums/EColor';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import ContactValidationBadge from '@/components/contact/ContactValidationBadge.vue';

const contactGroupStore = useContactGroupStore();
const contactStore = useContactStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isHexColor = (s: string) => /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);

const backgroundColor = (s: string): string => {
  if (isHexColor(s)) return s;

  return EColor.primary;
};

const textColor = (s: string): string => {
  const hex = backgroundColor(s);

  if (!isHexColor(hex)) return '#FFFFFF';

  let c = hex.substring(1);
  if (c.length === 3) {
    c = c
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }

  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);

  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  return yiq >= 128 ? '#000000' : '#FFFFFF';
};

const headers = [
  { title: t('name'), key: 'name' },
  { title: t('phone'), key: 'phone_partial' },
  { title: t('status'), key: 'status', sortable: false },
  { title: t('label'), key: 'label_template' },
];

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: 200, title: '200' },
]);

const search = ref<string>('');
const searchDebounced = refDebounced(search, 500);

type ContactRow = Pick<
  ListContactResponse,
  | 'contact_id'
  | 'name'
  | 'phone_partial'
  | 'label_templates'
  | 'is_valided'
  | 'validation_status'
>;

const contactItems = computed(() => contactStore.list);
const selectedContactIds = ref<Set<string>>(new Set());
const selectedContactsMap = ref<Map<string, ContactRow>>(new Map());
const selectedContactsCount = computed(() => selectedContactIds.value.size);
const name = ref<string | null>(null);
const description = ref<string | null>(null);
const isLoadingContacts = ref(false);

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  search: null as string | null,
});

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  search: searchDebounced.value || null,
}));

const refFormAddContactGroup = ref<VForm>();

const addContact = async () => {
  const validateForm = await refFormAddContactGroup?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) {
    return;
  }

  const payload: CreateContactGroupRequest = {
    name: name.value,
    description: description.value ?? null,
    contacts: Array.from(selectedContactIds.value).map((contact_id) => ({
      contact_id,
    })),
  };

  const result = await contactGroupStore.addContactGroup(payload);

  if (result) {
    isVisible.value = false;

    await contactGroupStore.listContactGroup();
  }
};

const resetForm = () => {
  name.value = null;
  description.value = null;
  search.value = '';
  selectedContactIds.value = new Set();
  selectedContactsMap.value = new Map();
  options.value.page = 1;
  refFormAddContactGroup.value?.resetValidation();
};

onMounted(async () => {
  resetForm();
});

watch(isVisible, async (visible) => {
  if (!visible) return;

  resetForm();
  await loadContacts();
});

watch(searchDebounced, async () => {
  options.value.page = 1;
});

async function loadContacts() {
  if (isLoadingContacts.value) return;

  isLoadingContacts.value = true;
  await contactStore.listContact(query.value);
  isLoadingContacts.value = false;
}

watch(
  query,
  async () => {
    await loadContacts();
  },
  { immediate: true, deep: true }
);

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = Number(o.itemsPerPage);
  options.value.sortBy = o.sortBy;
  loadContacts();
};

const isContactSelected = (contactId: string): boolean => {
  return selectedContactIds.value.has(contactId);
};

const addSelectedContact = (contact: ContactRow) => {
  const nextIds = new Set(selectedContactIds.value);
  nextIds.add(contact.contact_id);
  selectedContactIds.value = nextIds;

  const nextMap = new Map(selectedContactsMap.value);
  nextMap.set(contact.contact_id, contact);
  selectedContactsMap.value = nextMap;
};

const removeSelectedContact = (contactId: string) => {
  const nextIds = new Set(selectedContactIds.value);
  nextIds.delete(contactId);
  selectedContactIds.value = nextIds;

  const nextMap = new Map(selectedContactsMap.value);
  nextMap.delete(contactId);
  selectedContactsMap.value = nextMap;
};

const toggleContact = (contact: ContactRow) => {
  if (isContactSelected(contact.contact_id)) {
    removeSelectedContact(contact.contact_id);
    return;
  }

  addSelectedContact(contact);
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="900">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="contactGroupStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddContactGroup" @submit.prevent>
      <VCard :title="$t('add_contact_group')">
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
              <VLabel class="text-body-2 mb-1">{{ $t('description') }}:</VLabel>
              <AppTextField
                v-model="description"
                :placeholder="$t('description')"
              />
            </VCol>
          </VRow>

          <VRow>
            <VCol cols="12">
              <VCardText class="d-flex flex-column px-0 gap-3">
                <div class="d-flex align-center gap-2">
                  <span class="text-caption text-medium-emphasis">
                    {{ $t('selected') }} ({{ selectedContactsCount }}):
                  </span>
                </div>

                <div
                  class="d-flex align-center justify-space-between flex-wrap gap-4"
                >
                  <div class="d-flex align-center gap-x-2">
                    <div>{{ $t('show') }}</div>
                    <AppSelect
                      :model-value="options.itemsPerPage"
                      :items="itemsPerPage"
                      @update:model-value="
                        options.itemsPerPage = parseInt($event, 10)
                      "
                    />
                  </div>

                  <div class="invoice-list-filter d-flex align-center gap-2">
                    <VLabel>{{ $t('search') }}:</VLabel>
                    <AppTextField
                      v-model="search"
                      :placeholder="$t('search') + '...'"
                      append-inner-icon="tabler-search"
                      single-line
                      hide-details
                      dense
                      outlined
                      class="flex-grow-1"
                      style="min-width: 280px"
                    />
                  </div>
                </div>
              </VCardText>
            </VCol>
          </VRow>

          <VRow>
            <VCol cols="12">
              <VDataTableServer
                v-model:page="options.page"
                v-model:items-per-page="options.itemsPerPage"
                :headers="headers"
                :items="contactItems"
                :items-length="contactStore.pagings.total"
                :loading="isLoadingContacts"
                :sort-by="options.sortBy"
                @update:options="handleTableChange"
                :loading-text="$t('loading_text')"
              >
                <template #item.name="{ item }">
                  <div class="d-flex align-center gap-2">
                    <VCheckbox
                      :model-value="isContactSelected(item.contact_id)"
                      @update:model-value="toggleContact(item)"
                      hide-details
                      density="compact"
                    />
                    <span class="font-weight-medium">
                      {{ item.name }}
                    </span>
                  </div>
                </template>

                <template #item.phone_partial="{ item }">
                  <span>{{ item.phone_partial }}</span>
                </template>

                <template #item.status="{ item }">
                  <ContactValidationBadge
                    :validation-status="item.validation_status"
                    :is-validated="item.is_valided"
                    compact
                  />
                </template>

                <template #item.label_template="{ item }">
                  <div
                    v-if="
                      item.label_templates && item.label_templates.length > 0
                    "
                    class="d-flex align-center gap-1"
                  >
                    <VChip
                      class="uc-chip"
                      size="small"
                      :style="{
                        backgroundColor: backgroundColor(
                          item.label_templates[0].color
                        ),
                        color: textColor(item.label_templates[0].color),
                      }"
                    >
                      {{ item.label_templates[0].label }}
                    </VChip>
                    <span v-if="item.label_templates.length > 1">
                      <VTooltip
                        location="top"
                        transition="scale-transition"
                        activator="parent"
                      >
                        <span>{{
                          item.label_templates
                            .slice(1)
                            .map((lt) => lt.label)
                            .join(', ')
                        }}</span>
                      </VTooltip>
                      <VChip
                        class="uc-chip uc-badge--muted uc-chip-count"
                        size="x-small"
                      >
                        +{{ item.label_templates.length - 1 }}
                      </VChip>
                    </span>
                  </div>

                  <VChip v-else class="uc-chip uc-badge--muted" size="small"
                    >-</VChip
                  >
                </template>
                <template #no-data>
                  {{ $t('no_data_available') }}
                </template>

                <template #bottom>
                  <TablePagination
                    v-model:page="options.page"
                    :items-per-page="options.itemsPerPage"
                    :total-items="contactStore.pagings.total"
                  />
                </template>
              </VDataTableServer>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addContact"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>

<style lang="scss">
.uc-chip {
  height: 24px;
  min-width: 88px;
  justify-content: center;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.uc-chip-count {
  height: 18px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
}
</style>
