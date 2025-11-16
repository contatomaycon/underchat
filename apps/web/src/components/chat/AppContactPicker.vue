<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useContactStore } from '@/@webcore/stores/contact';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISelectedContactPreview } from '@core/common/interfaces/IChatFilePreview';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

const { t } = useI18n();
const contactStore = useContactStore();

const props = defineProps<{
  modelValue: boolean;
  existingContacts?: ISelectedContactPreview[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'select', contacts: ISelectedContactPreview[]): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const selectedContacts = ref<Set<string>>(new Set());
const searchQuery = ref('');
const debouncedSearch = refDebounced(searchQuery, 500);

const existingContactIds = computed(() => {
  return new Set(props.existingContacts?.map((c) => c.contact_id) || []);
});

const totalSelectedCount = computed(() => {
  return existingContactIds.value.size + selectedContacts.value.size;
});

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
  search: debouncedSearch.value || null,
}));

watch(debouncedSearch, () => {
  options.value.page = 1;
  loadContacts();
});

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      selectedContacts.value.clear();
      searchQuery.value = '';
      options.value.page = 1;
      loadContacts();
    }
  }
);

const loadContacts = async () => {
  await contactStore.listContact({
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    search: debouncedSearch.value || undefined,
  });
};

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
  loadContacts();
};

const toggleContact = (contactId: string) => {
  if (existingContactIds.value.has(contactId)) {
    return;
  }

  if (selectedContacts.value.has(contactId)) {
    selectedContacts.value.delete(contactId);
    return;
  }

  if (totalSelectedCount.value >= 10) {
    contactStore.showSnackbar(
      t('max_contacts_selected', { count: 10 }),
      EColor.warning
    );
    return;
  }

  selectedContacts.value.add(contactId);
};

const isContactSelected = (contactId: string): boolean => {
  return selectedContacts.value.has(contactId);
};

const isContactExisting = (contactId: string): boolean => {
  return existingContactIds.value.has(contactId);
};

const getSelectedContactsData = (): ISelectedContactPreview[] => {
  return contactStore.list
    .filter((contact) => selectedContacts.value.has(contact.contact_id))
    .map((contact) => ({
      contact_id: contact.contact_id,
      name: contact.name,
      last_name: contact.last_name ?? null,
      phone: null,
      phone_partial: contact.phone_partial ?? null,
      email: null,
      email_partial: contact.email_partial ?? null,
    }));
};

const handleSend = () => {
  const contacts = getSelectedContactsData();
  if (contacts.length === 0) {
    contactStore.showSnackbar(t('select_at_least_one_contact'), EColor.warning);
    return;
  }
  emit('select', contacts);
  isVisible.value = false;
};

const headers = computed(() => [
  { title: t('name'), key: 'name', sortable: true },
  { title: t('phone'), key: 'phone_partial', sortable: true },
  { title: t('email'), key: 'email_partial', sortable: true },
]);

onMounted(() => {
  loadContacts();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="800" persistent>
    <DialogCloseBtn @click="isVisible = false" />
    <VCard :title="$t('select_contacts')">
      <VCardText>
        <div class="d-flex align-center gap-4 mb-4">
          <AppTextField
            v-model="searchQuery"
            :placeholder="$t('search') + '...'"
            prepend-inner-icon="tabler-search"
            single-line
            hide-details
            dense
            outlined
            class="flex-grow-1"
          />
        </div>

        <VDataTableServer
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          :headers="headers"
          :items="contactStore.list"
          :items-length="contactStore.pagings.total"
          :loading="contactStore.loading"
          :sort-by="options.sortBy"
          @update:options="handleTableChange"
          :loading-text="$t('loading_text')"
        >
          <template #item.name="{ item }">
            <div class="d-flex align-center gap-2">
              <VCheckbox
                :model-value="
                  isContactSelected(item.contact_id) ||
                  isContactExisting(item.contact_id)
                "
                :disabled="isContactExisting(item.contact_id)"
                @update:model-value="toggleContact(item.contact_id)"
                hide-details
                density="compact"
              />
              <span>{{ item.name }} {{ item.last_name || '' }}</span>
            </div>
          </template>

          <template #item.phone_partial="{ item }">
            {{ item.phone_partial || '-' }}
          </template>

          <template #item.email_partial="{ item }">
            {{ item.email_partial || '-' }}
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

        <div class="mt-4 text-caption text-disabled">
          {{ $t('selected_contacts') }}: {{ totalSelectedCount }}/10
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn @click="handleSend">
          {{ $t('send') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
