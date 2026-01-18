<script lang="ts" setup>
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { VForm } from 'vuetify/components/VForm';
import { ref, computed, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import {
  EditContactGroupParamsRequest,
  UpdateContactGroupRequest,
} from '@core/schema/contactGroup/editContactGroup/request.schema';
import { EColor } from '@core/common/enums/EColor';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

const contactGroupStore = useContactGroupStore();
const contactStore = useContactStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  contactGroupId: string | null;
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

type ContactRow = Pick<
  ListContactResponse,
  'contact_id' | 'name' | 'phone_partial' | 'label_templates'
>;

const search = ref<string>('');
const searchDebounced = refDebounced(search, 500);
const onlyGroup = ref(false);
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

const normalizedSearch = computed(() =>
  (searchDebounced.value ?? '').trim().toLowerCase()
);

const selectedContactIds = ref<Set<string>>(new Set());
const selectedContactsMap = ref<Map<string, ContactRow>>(new Map());
const selectedContactsList = computed(() =>
  Array.from(selectedContactsMap.value.values())
);
const selectedContactsCount = computed(() => selectedContactIds.value.size);

const selectedContactsFiltered = computed(() => {
  const term = normalizedSearch.value;
  if (!term) return selectedContactsList.value;

  return selectedContactsList.value.filter((contact) => {
    const name = contact.name?.toLowerCase() ?? '';
    const phone = contact.phone_partial?.toLowerCase() ?? '';
    return name.includes(term) || phone.includes(term);
  });
});

const contactGroupId = toRef(props, 'contactGroupId');

const contactItems = computed(() => {
  if (onlyGroup.value) return selectedContactsFiltered.value;

  return contactStore.list;
});

const contactItemsLength = computed(() => {
  if (onlyGroup.value) return selectedContactsFiltered.value.length;

  return contactStore.pagings.total;
});
const name = ref<string | null>(null);
const description = ref<string | null>(null);

const refFormAddContactGroup = ref<VForm>();

const addContactGroup = async () => {
  const validateForm = await refFormAddContactGroup?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactGroupId.value || !name.value) {
    return;
  }

  const payload: EditContactGroupParamsRequest = {
    contact_group_id: contactGroupId.value,
  };

  const body: UpdateContactGroupRequest = {
    name: name.value,
    description: description.value ?? undefined,
    contacts: Array.from(selectedContactIds.value).map((contact_id) => ({
      contact_id,
    })),
  };

  const result = await contactGroupStore.updateContactGroup(payload, body);

  if (result) {
    isVisible.value = false;

    await contactGroupStore.listContactGroup();
  }
};

const resetForm = () => {
  name.value = null;
  description.value = null;
  search.value = '';
  onlyGroup.value = false;
  selectedContactIds.value = new Set();
  selectedContactsMap.value = new Map();
  options.value.page = 1;
  refFormAddContactGroup.value?.resetValidation();
};

onMounted(async () => {
  resetForm();
  await loadGroupContacts();
});

watch(isVisible, async (visible) => {
  if (!visible) return;

  resetForm();
  await loadContacts();
  await loadGroupContacts();
});

watch(searchDebounced, async () => {
  options.value.page = 1;
  if (onlyGroup.value) return;
});

watch(onlyGroup, async (value) => {
  options.value.page = 1;
  if (value) return;

  await loadContacts();
});

async function loadContacts() {
  if (isLoadingContacts.value) return;

  isLoadingContacts.value = true;
  await contactStore.listContact(query.value);
  isLoadingContacts.value = false;
  syncSelectedWithList();
}

watch(
  query,
  async () => {
    if (onlyGroup.value) return;

    await loadContacts();
  },
  { immediate: true, deep: true }
);

function syncSelectedWithList() {
  const nextMap = new Map(selectedContactsMap.value);

  for (const contact of contactStore.list) {
    if (!selectedContactIds.value.has(contact.contact_id)) continue;

    nextMap.set(contact.contact_id, contact);
  }

  selectedContactsMap.value = nextMap;
}

async function loadGroupContacts() {
  if (!contactGroupId.value) return;

  const contactGroup = await contactGroupStore.getContactGroupById(
    contactGroupId.value
  );
  if (!contactGroup) return;

  name.value = contactGroup.name;
  description.value = contactGroup.description ?? null;

  const groupContacts = contactGroup.contacts ?? [];
  for (const groupContact of groupContacts) {
    addSelectedContact({
      contact_id: groupContact.contact_id,
      name: groupContact.name,
      phone_partial: groupContact.phone_partial ?? null,
      label_templates: [],
    });
  }

  syncSelectedWithList();
}

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = Number(o.itemsPerPage);
  options.value.sortBy = o.sortBy;
  if (onlyGroup.value) return;

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
      <VCard :title="$t('add_or_delete_contact_group')">
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
                <VCheckbox
                  v-model="onlyGroup"
                  :label="`${$t('selected_contacts')} (${selectedContactsCount})`"
                  hide-details
                  density="compact"
                />

                <div class="d-flex align-center justify-space-between flex-wrap gap-4">
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
                      style="min-width: 280px;"
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
                :items-length="contactItemsLength"
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
                    :total-items="contactItemsLength"
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
          <VBtn @click="addContactGroup"> {{ $t('add') }} </VBtn>
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
