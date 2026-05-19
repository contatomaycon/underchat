<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DataTableHeader } from 'vuetify';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHolidayPermissions } from '@core/common/enums/EPermissions/holiday';
import { EColor } from '@core/common/enums/EColor';
import { useHolidayStore } from '@/@webcore/stores/holiday';
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
const editingHolidayId = ref<string | null>(null);
const isDialogDeleterShow = ref(false);
const holidayToDelete = ref<LocalHolidayItem | null>(null);

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

const validateLocalHolidayForm = (): boolean => {
  if (!name.value.trim()) {
    holidayStore.showSnackbar(t('chatbot_holiday_name_required'), EColor.error);
    return false;
  }

  if (!month.value || month.value < 1 || month.value > 12) {
    holidayStore.showSnackbar(t('chatbot_holiday_month_required'), EColor.error);
    return false;
  }

  if (!day.value || day.value < 1 || day.value > 31) {
    holidayStore.showSnackbar(t('chatbot_holiday_day_required'), EColor.error);
    return false;
  }

  if (!stateId.value) {
    holidayStore.showSnackbar(t('chatbot_holiday_state_required'), EColor.error);
    return false;
  }

  if (scope.value === 'municipal' && !cityId.value) {
    holidayStore.showSnackbar(t('chatbot_holiday_city_required'), EColor.error);
    return false;
  }

  return true;
};

const saveLocalHoliday = async () => {
  if (!validateLocalHolidayForm()) {
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
      resetForm();
    }
  } finally {
    isSavingLocalHoliday.value = false;
  }
};

const editLocalHoliday = async (item: LocalHolidayItem) => {
  editingHolidayId.value = item.chatbot_holiday_id;
  scope.value = item.scope;
  name.value = item.name;
  month.value = item.month;
  day.value = item.day;
  stateId.value = item.state_id;

  if (item.state_id) {
    await loadCities(item.state_id);
  }

  cityId.value = item.city_id;
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
      resetForm();
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
  (newScope) => {
    if (newScope === 'state') {
      cityId.value = null;
      clearCities();
    }
  }
);

watch(
  () => stateId.value,
  async (newStateId, oldStateId) => {
    if (!newStateId) {
      cityId.value = null;
      clearCities();
      return;
    }

    if (newStateId !== oldStateId) {
      cityId.value = null;
      await loadCities(newStateId);
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
        <VRow>
          <VCol cols="12" md="3">
            <AppSelectSearch
              v-model="scope"
              :items="scopeOptions"
              item-title="title"
              item-value="value"
              :label="$t('type')"
            />
          </VCol>

          <VCol cols="12" md="3">
            <AppTextField
              v-model="name"
              :label="$t('name')"
              :placeholder="$t('chatbot_holiday_name_placeholder')"
            />
          </VCol>

          <VCol cols="6" md="2">
            <AppTextField
              v-model.number="day"
              type="number"
              :label="$t('day')"
              min="1"
              max="31"
            />
          </VCol>

          <VCol cols="6" md="2">
            <AppSelect
              v-model="month"
              :items="monthOptions"
              item-title="title"
              item-value="value"
              :label="$t('month')"
            />
          </VCol>

          <VCol cols="12" md="3">
            <AppSelectSearch
              v-model="stateId"
              :items="filteredStates"
              :label="$t('state')"
              :loading="loadingStates"
              item-title="title"
              item-value="value"
              clearable
            />
          </VCol>

          <VCol cols="12" md="3" v-if="scope === 'municipal'">
            <AppSelectSearch
              v-model="cityId"
              :items="filteredCities"
              :label="$t('city')"
              :loading="loadingCities"
              item-title="title"
              item-value="value"
              :disabled="!stateId"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6" class="d-flex align-end gap-2">
            <VBtn
              color="primary"
              :loading="isSavingLocalHoliday"
              @click="saveLocalHoliday"
            >
              {{ editingHolidayId ? $t('save') : $t('add') }}
            </VBtn>

            <VBtn
              v-if="editingHolidayId"
              variant="outlined"
              color="secondary"
              @click="resetForm"
            >
              {{ $t('cancel') }}
            </VBtn>
          </VCol>
        </VRow>

        <VDivider class="my-4" />

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
