<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DataTableHeader } from 'vuetify';
import { VForm } from 'vuetify/components/VForm';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHolidayPermissions } from '@core/common/enums/EPermissions/holiday';
import { useHolidayStore } from '@/@webcore/stores/holiday';
import {
  betweenValidator,
  integerValidator,
  requiredValidator,
} from '@/@webcore/utils/validators';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useStatesAndCities } from '@/composables/useStatesAndCities';

interface NationalHolidayItem {
  date: string;
  name: string;
  type: string;
  weekday: string;
}

interface LocalHolidayItem {
  chatbot_holiday_id: string;
  scope: 'state' | 'municipal';
  name: string;
  month: number;
  day: number;
  state_id: string | null;
  city_id: string | null;
  state_name: string | null;
  state_abbreviation: string | null;
  city_name: string | null;
}

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EHolidayPermissions.holiday_group,
      EHolidayPermissions.holiday_access,
    ],
  },
});

const { t } = useI18n();
const holidayStore = useHolidayStore();
useSnackbarCleanup(holidayStore);

const {
  filteredStates,
  filteredCities,
  loadStates,
  loadCities,
  clearCities,
  loadingStates,
  loadingCities,
} = useStatesAndCities();

const currentYear = new Date().getFullYear();
const selectedYear = ref(currentYear);
const nationalHolidays = ref<NationalHolidayItem[]>([]);
const localHolidays = ref<LocalHolidayItem[]>([]);
const isSavingLocalHoliday = ref(false);
const isHydratingLocalHolidayForm = ref(false);
const isLocalHolidayDialogOpen = ref(false);
const editingHolidayId = ref<string | null>(null);
const isDialogDeleterShow = ref(false);
const holidayToDelete = ref<LocalHolidayItem | null>(null);
const refFormLocalHoliday = ref<VForm>();

const scope = ref<'state' | 'municipal'>('state');
const name = ref('');
const month = ref<number | null>(null);
const day = ref<number | null>(null);
const stateId = ref<string | null>(null);
const cityId = ref<string | null>(null);
const monthKeys = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const yearOptions = computed(() => {
  const years: Array<{ title: string; value: number }> = [];

  for (let year = currentYear - 1; year <= currentYear + 4; year += 1) {
    years.push({ title: String(year), value: year });
  }

  return years;
});

const scopeOptions = computed(() => [
  {
    title: t('chatbot_holiday_scope_state_label'),
    value: 'state',
  },
  {
    title: t('chatbot_holiday_scope_municipal_label'),
    value: 'municipal',
  },
]);

const monthOptions = computed(() =>
  monthKeys.map((monthKey, index) => ({
    title: t(`date_month_${monthKey}`),
    value: index + 1,
  }))
);

const nationalHeaders = computed<DataTableHeader<NationalHolidayItem>[]>(() => [
  { title: t('date'), key: 'date' },
  { title: t('name'), key: 'name' },
  { title: t('type'), key: 'type' },
  { title: t('chatbot_holiday_weekday'), key: 'weekday' },
]);

const localHeaders = computed<DataTableHeader<LocalHolidayItem>[]>(() => [
  { title: t('type'), key: 'scope' },
  { title: t('name'), key: 'name' },
  { title: t('day'), key: 'day' },
  { title: t('month'), key: 'month' },
  { title: t('state'), key: 'state_name' },
  { title: t('city'), key: 'city_name' },
  { title: t('actions'), key: 'actions', sortable: false },
]);

const localHolidayDialogTitle = computed(() =>
  editingHolidayId.value
    ? t('chatbot_holiday_local_edit_title')
    : t('chatbot_holiday_local_add_title')
);

const scopeRules = computed(() => [
  (value: unknown) => requiredValidator(value, t('type_required')),
]);

const hasLocalHolidayRuleValue = (value: unknown) =>
  value !== null && value !== undefined && String(value).trim().length > 0;

const nameRules = computed(() => [
  (value: unknown) =>
    requiredValidator(value, t('chatbot_holiday_name_required')),
]);

const dayRules = computed(() => [
  (value: unknown) =>
    requiredValidator(value, t('chatbot_holiday_day_required')),
  (value: unknown) =>
    hasLocalHolidayRuleValue(value)
      ? integerValidator(value, t('chatbot_holiday_day_invalid'))
      : true,
  (value: unknown) =>
    hasLocalHolidayRuleValue(value)
      ? betweenValidator(value, 1, 31, t('chatbot_holiday_day_invalid'))
      : true,
]);

const monthRules = computed(() => [
  (value: unknown) =>
    requiredValidator(value, t('chatbot_holiday_month_required')),
  (value: unknown) =>
    hasLocalHolidayRuleValue(value)
      ? integerValidator(value, t('chatbot_holiday_month_invalid'))
      : true,
  (value: unknown) =>
    hasLocalHolidayRuleValue(value)
      ? betweenValidator(value, 1, 12, t('chatbot_holiday_month_invalid'))
      : true,
]);

const stateRules = computed(() => [
  (value: unknown) =>
    requiredValidator(value, t('chatbot_holiday_state_required')),
]);

const cityRules = computed(() => [
  (value: unknown) =>
    scope.value === 'municipal'
      ? requiredValidator(value, t('chatbot_holiday_city_required'))
      : true,
]);

const resetForm = () => {
  editingHolidayId.value = null;
  scope.value = 'state';
  name.value = '';
  month.value = null;
  day.value = null;
  stateId.value = null;
  cityId.value = null;
  clearCities();
};

const resetLocalHolidayFormValidation = async () => {
  await nextTick();
  refFormLocalHoliday.value?.resetValidation();
};

const openCreateLocalHolidayDialog = async () => {
  resetForm();
  isLocalHolidayDialogOpen.value = true;
  await resetLocalHolidayFormValidation();
};

const closeLocalHolidayDialog = async () => {
  if (isSavingLocalHoliday.value) {
    return;
  }

  isLocalHolidayDialogOpen.value = false;
  resetForm();
  await resetLocalHolidayFormValidation();
};

const loadNationalHolidays = async () => {
  const response = await holidayStore.listNationalHolidays(selectedYear.value);
  nationalHolidays.value = response;
};

const loadLocalHolidays = async () => {
  const response = await holidayStore.listLocalHolidays();
  localHolidays.value = response as LocalHolidayItem[];
};

const getScopeLabel = (localScope: 'state' | 'municipal') => {
  if (localScope === 'municipal') {
    return t('chatbot_holiday_scope_municipal_label');
  }

  return t('chatbot_holiday_scope_state_label');
};

const getMonthLabel = (monthValue: number): string => {
  if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
    return '-';
  }

  return t(`date_month_${monthKeys[monthValue - 1]}`);
};

const formatDateToBrazilian = (date: string): string => {
  if (!date || !date.includes('-')) {
    return date;
  }

  const [year, month, day] = date.split('-');
  if (!year || !month || !day) {
    return date;
  }

  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
};

const getHolidayTypeLabel = (type: string): string => {
  if (!type) {
    return '-';
  }

  const key = `chatbot_holiday_type_${type.toLowerCase()}`;
  const translated = t(key);
  return translated === key ? type : translated;
};

const getHolidayWeekdayLabel = (weekday: string): string => {
  if (!weekday) {
    return '-';
  }

  const normalizedWeekday = weekday
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const weekdayMap: Record<string, string> = {
    sunday: 'sunday',
    domingo: 'sunday',
    monday: 'monday',
    segunda: 'monday',
    'segunda-feira': 'monday',
    tuesday: 'tuesday',
    terca: 'tuesday',
    'terca-feira': 'tuesday',
    wednesday: 'wednesday',
    quarta: 'wednesday',
    'quarta-feira': 'wednesday',
    thursday: 'thursday',
    quinta: 'thursday',
    'quinta-feira': 'thursday',
    friday: 'friday',
    sexta: 'friday',
    'sexta-feira': 'friday',
    saturday: 'saturday',
    sabado: 'saturday',
  };

  const weekdayKey = weekdayMap[normalizedWeekday];
  if (!weekdayKey) {
    return weekday;
  }

  return t(weekdayKey);
};

const validateLocalHolidayForm = async (): Promise<boolean> => {
  const validateForm = await refFormLocalHoliday.value?.validate();
  return !!validateForm?.valid;
};

const saveLocalHoliday = async () => {
  if (!(await validateLocalHolidayForm())) {
    return;
  }

  isSavingLocalHoliday.value = true;

  try {
    const input = {
      scope: scope.value,
      name: name.value.trim(),
      month: month.value as number,
      day: day.value as number,
      state_id: stateId.value as string,
      city_id: scope.value === 'municipal' ? cityId.value : null,
    };

    let success = false;

    if (editingHolidayId.value) {
      success = await holidayStore.updateLocalHoliday(editingHolidayId.value, input);
    } else {
      const createdId = await holidayStore.createLocalHoliday(input);
      success = !!createdId;
    }

    if (success) {
      await loadLocalHolidays();
      isLocalHolidayDialogOpen.value = false;
      resetForm();
      await resetLocalHolidayFormValidation();
    }
  } finally {
    isSavingLocalHoliday.value = false;
  }
};

const editLocalHoliday = async (item: LocalHolidayItem) => {
  isHydratingLocalHolidayForm.value = true;
  resetForm();

  editingHolidayId.value = item.chatbot_holiday_id;
  scope.value = item.scope;
  name.value = item.name;
  month.value = item.month;
  day.value = item.day;
  stateId.value = item.state_id;
  isLocalHolidayDialogOpen.value = true;

  if (item.state_id) {
    await loadCities(item.state_id);
  }

  cityId.value = item.city_id;
  await nextTick();
  isHydratingLocalHolidayForm.value = false;
  await resetLocalHolidayFormValidation();
};

const deleteLocalHoliday = (item: LocalHolidayItem) => {
  holidayToDelete.value = item;
  isDialogDeleterShow.value = true;
};

const handleDeleteLocalHoliday = async () => {
  if (!holidayToDelete.value) {
    return;
  }

  const holidayId = holidayToDelete.value.chatbot_holiday_id;
  const success = await holidayStore.deleteLocalHoliday(holidayId);

  if (success) {
    await loadLocalHolidays();

    if (editingHolidayId.value === holidayId) {
      isLocalHolidayDialogOpen.value = false;
      resetForm();
      await resetLocalHolidayFormValidation();
    }
  }

  isDialogDeleterShow.value = false;
  holidayToDelete.value = null;
};

watch(
  () => selectedYear.value,
  async () => {
    await loadNationalHolidays();
  }
);

watch(
  () => scope.value,
  async (newScope) => {
    if (isHydratingLocalHolidayForm.value) {
      return;
    }

    if (newScope === 'state') {
      cityId.value = null;
      clearCities();
      return;
    }

    if (stateId.value) {
      await loadCities(stateId.value);
    }
  }
);

watch(
  () => stateId.value,
  async (newStateId, oldStateId) => {
    if (isHydratingLocalHolidayForm.value) {
      return;
    }

    if (!newStateId) {
      cityId.value = null;
      clearCities();
      return;
    }

    if (newStateId !== oldStateId) {
      cityId.value = null;
      clearCities();

      if (scope.value === 'municipal') {
        await loadCities(newStateId);
      }
    }
  }
);

watch(
  () => isDialogDeleterShow.value,
  (isOpen) => {
    if (!isOpen) {
      holidayToDelete.value = null;
    }
  }
);

onMounted(async () => {
  await Promise.all([loadStates(), loadNationalHolidays(), loadLocalHolidays()]);
});
</script>

<template>
  <div class="d-flex flex-column gap-4">
    <VCard :title="$t('chatbot_holiday_national_table_title')">
      <VCardText>
        <div class="d-flex align-center mb-4" style="max-width: 220px">
          <AppSelect
            v-model="selectedYear"
            :items="yearOptions"
            :label="$t('year')"
          />
        </div>

        <VDataTable
          :headers="nationalHeaders"
          :items="nationalHolidays"
          :loading="holidayStore.loading"
          :items-per-page="10"
          :loading-text="$t('loading_text')"
        >
          <template #item.date="{ item }">
            <span>{{ formatDateToBrazilian(item.date) }}</span>
          </template>

          <template #item.type="{ item }">
            <span>{{ getHolidayTypeLabel(item.type) }}</span>
          </template>

          <template #item.weekday="{ item }">
            <span>{{ getHolidayWeekdayLabel(item.weekday) }}</span>
          </template>
        </VDataTable>
      </VCardText>
    </VCard>

    <VCard :title="$t('chatbot_holiday_local_table_title')">
      <VCardText>
        <div class="d-flex justify-start mb-4">
          <VBtn
            color="primary"
            prepend-icon="tabler-plus"
            @click="openCreateLocalHolidayDialog"
          >
            {{ $t('add') }}
          </VBtn>
        </div>

        <VDataTable
          :headers="localHeaders"
          :items="localHolidays"
          :items-per-page="10"
          :loading="holidayStore.loading"
          :loading-text="$t('loading_text')"
        >
          <template #item.scope="{ item }">
            <VChip size="small" variant="tonal">
              {{ getScopeLabel(item.scope) }}
            </VChip>
          </template>

          <template #item.state_name="{ item }">
            <span>
              {{
                item.state_name
                  ? `${item.state_name}${
                      item.state_abbreviation
                        ? ` (${item.state_abbreviation})`
                        : ''
                    }`
                  : '-'
              }}
            </span>
          </template>

          <template #item.city_name="{ item }">
            <span>{{ item.city_name || '-' }}</span>
          </template>

          <template #item.month="{ item }">
            <span>{{ getMonthLabel(item.month) }}</span>
          </template>

          <template #item.actions="{ item }">
            <div class="d-flex gap-1">
              <IconBtn @click="editLocalHoliday(item)">
                <VIcon icon="tabler-edit" />
              </IconBtn>
              <IconBtn @click="deleteLocalHoliday(item)">
                <VIcon icon="tabler-trash" />
              </IconBtn>
            </div>
          </template>
        </VDataTable>

        <VDialog
          v-model="isLocalHolidayDialogOpen"
          max-width="720"
          persistent
        >
          <VOverlay
            :model-value="isSavingLocalHoliday"
            class="align-center justify-center"
            contained
          >
            <VProgressCircular color="primary" indeterminate size="64" />
          </VOverlay>

          <VCard>
            <VCardTitle class="d-flex align-center justify-space-between pa-4">
              <span>{{ localHolidayDialogTitle }}</span>
              <VBtn
                icon
                size="small"
                variant="text"
                :disabled="isSavingLocalHoliday"
                @click="closeLocalHolidayDialog"
              >
                <VIcon icon="tabler-x" />
              </VBtn>
            </VCardTitle>

            <VDivider />

            <VCardText class="pa-4">
              <VForm
                ref="refFormLocalHoliday"
                @submit.prevent="saveLocalHoliday"
              >
                <VRow>
                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
                    <AppSelectSearch
                      v-model="scope"
                      :items="scopeOptions"
                      item-title="title"
                      item-value="value"
                      :rules="scopeRules"
                      :disabled="isSavingLocalHoliday"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
                    <AppTextField
                      v-model="name"
                      :placeholder="$t('chatbot_holiday_name_placeholder')"
                      :rules="nameRules"
                      :disabled="isSavingLocalHoliday"
                      autofocus
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('day') }}:</VLabel>
                    <AppTextField
                      v-model.number="day"
                      type="number"
                      min="1"
                      max="31"
                      :rules="dayRules"
                      :disabled="isSavingLocalHoliday"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('month') }}:</VLabel>
                    <AppSelect
                      v-model="month"
                      :items="monthOptions"
                      item-title="title"
                      item-value="value"
                      :rules="monthRules"
                      :disabled="isSavingLocalHoliday"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('state') }}:</VLabel>
                    <AppSelectSearch
                      v-model="stateId"
                      :items="filteredStates"
                      :loading="loadingStates"
                      item-title="title"
                      item-value="value"
                      :rules="stateRules"
                      :disabled="isSavingLocalHoliday"
                      clearable
                    />
                  </VCol>

                  <VCol v-if="scope === 'municipal'" cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">{{ $t('city') }}:</VLabel>
                    <AppSelectSearch
                      v-model="cityId"
                      :items="filteredCities"
                      :loading="loadingCities"
                      item-title="title"
                      item-value="value"
                      :rules="cityRules"
                      :disabled="!stateId || isSavingLocalHoliday"
                      clearable
                    />
                  </VCol>
                </VRow>
              </VForm>
            </VCardText>

            <VCardText class="d-flex justify-end flex-wrap gap-3">
              <VBtn
                variant="tonal"
                color="secondary"
                :disabled="isSavingLocalHoliday"
                @click="closeLocalHolidayDialog"
              >
                {{ $t('cancel') }}
              </VBtn>
              <VBtn
                color="primary"
                :loading="isSavingLocalHoliday"
                @click="saveLocalHoliday"
              >
                {{ editingHolidayId ? $t('save') : $t('add') }}
              </VBtn>
            </VCardText>
          </VCard>
        </VDialog>

        <VDialogHandler
          v-if="isDialogDeleterShow"
          v-model="isDialogDeleterShow"
          :title="$t('delete_holiday')"
          :message="$t('delete_holiday_confirmation')"
          @confirm="handleDeleteLocalHoliday"
        />
      </VCardText>
    </VCard>
  </div>
</template>
