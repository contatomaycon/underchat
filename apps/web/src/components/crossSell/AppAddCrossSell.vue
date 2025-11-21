<script lang="ts" setup>
import { useCrossSellStore } from '@/@webcore/stores/crossSell';
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';

const crossSellStore = useCrossSellStore();
const planStore = usePlanStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const plan_product_id = ref<string | null>(null);
const quantity = ref<number | null>(null);
const priceRaw = ref<number | null>(null);

const planProducts = ref<{ value: string; title: string }[]>([]);

const refFormAddCrossSell = ref<VForm>();

const { locale } = useI18n();

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const config = getCurrencyConfig();
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(value);
};

const removeInvalidChars = (value: string, allowedChars: string): string => {
  return value
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (code >= 48 && code <= 57) || allowedChars.includes(char);
    })
    .join('');
};

const parseCurrency = (value: string): number | null => {
  if (!value) return null;
  const config = getCurrencyConfig();
  let cleanValue = removeInvalidChars(value, '.,-');

  if (config.currency === 'BRL') {
    cleanValue = cleanValue.replaceAll('.', '');
    const commaIndex = cleanValue.indexOf(',');
    if (commaIndex !== -1) {
      cleanValue =
        cleanValue.substring(0, commaIndex) +
        '.' +
        cleanValue.substring(commaIndex + 1);
    }
  } else if (config.currency === 'USD' || config.currency === 'EUR') {
    cleanValue = cleanValue.replaceAll(',', '');
  }

  const parsed = Number.parseFloat(cleanValue);
  return Number.isNaN(parsed) ? null : parsed;
};

const priceDisplay = ref<string>('');

const price = computed({
  get: () => priceDisplay.value,
  set: (value: string) => {
    priceDisplay.value = value;
    priceRaw.value = parseCurrency(value);
  },
});

const handlePriceInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value;

  const config = getCurrencyConfig();

  if (config.currency === 'BRL') {
    value = removeInvalidChars(value, ',');
    const parts = value.split(',');
    if (parts.length > 2) {
      value = parts[0] + ',' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + ',' + parts[1].substring(0, 2);
    }
  } else {
    value = removeInvalidChars(value, '.');
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }
  }

  priceDisplay.value = value;
  priceRaw.value = parseCurrency(value);
};

const handlePriceBlur = () => {
  if (priceRaw.value !== null) {
    priceDisplay.value = formatCurrency(priceRaw.value);
    return;
  }

  if (priceDisplay.value) {
    const parsed = parseCurrency(priceDisplay.value);
    if (parsed !== null) {
      priceRaw.value = parsed;
      priceDisplay.value = formatCurrency(parsed);
    } else {
      priceDisplay.value = '';
      priceRaw.value = null;
    }
  } else {
    priceDisplay.value = '';
  }
};

const addCrossSell = async () => {
  const validateForm = await refFormAddCrossSell?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !plan_product_id.value ||
    quantity.value === null ||
    priceRaw.value === null
  ) {
    return;
  }

  const payload: CreateCrossSellRequest = {
    plan_product_id: plan_product_id.value,
    quantity: quantity.value,
    price: priceRaw.value,
  };

  const result = await crossSellStore.createCrossSell(payload);
  if (result) {
    isVisible.value = false;
    await crossSellStore.listCrossSell();
  }
};

const resetForm = () => {
  plan_product_id.value = null;
  quantity.value = null;
  priceRaw.value = null;
  priceDisplay.value = '';
  refFormAddCrossSell.value?.resetValidation();
};

const loadPlanProducts = async () => {
  const products = await planStore.listPlanProductAll();
  if (products) {
    planProducts.value = products.map((p) => ({
      value: p.plan_product_id,
      title: p.name || '',
    }));
  }
};

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    await loadPlanProducts();
  }
});

onMounted(async () => {
  resetForm();
  await loadPlanProducts();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="crossSellStore.loading">
      <VOverlay
        :model-value="crossSellStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddCrossSell" @submit.prevent>
      <VCard :title="$t('add_cross_sell')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppAutocomplete
                v-model="plan_product_id"
                :items="planProducts"
                :label="$t('plan_product') + ':'"
                :placeholder="$t('select_plan_product')"
                :rules="[
                  requiredValidator(
                    plan_product_id,
                    $t('plan_product_required')
                  ),
                ]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="quantity"
                :label="$t('quantity') + ':'"
                :placeholder="$t('quantity')"
                type="number"
                :rules="[requiredValidator(quantity, $t('quantity_required'))]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="price"
                :label="$t('price') + ':'"
                :placeholder="formatCurrency(0)"
                :rules="[requiredValidator(priceRaw, $t('price_required'))]"
                @input="handlePriceInput"
                @blur="handlePriceBlur"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addCrossSell"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
