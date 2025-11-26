<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { useI18n } from 'vue-i18n';
import { useExpendituresStore } from '@/@webcore/stores/expenditure';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EFinancialPermissions.financial_group,
      EFinancialPermissions.financial_view,
    ],
  },
});

const { t } = useI18n();
const expenditureStore = useExpendituresStore();

// Tipo de visualização: Anual, Mensal, Diário
const viewType = ref<'annual' | 'monthly' | 'daily'>('annual');

// Mock data - será substituído quando a API estiver pronta
const annualRevenue = ref(1225);
const annualExpense = ref(2300);
const annualNet = computed(() => annualRevenue.value - annualExpense.value);

interface MonthlyDetail {
  month: string;
  income: number;
  outgoing: number;
  net: number;
}

const monthlyDetails = ref<MonthlyDetail[]>([
  {
    month: 'Novembro',
    income: 1225,
    outgoing: 2300,
    net: -1075,
  },
]);

const loading = ref(false);

// Filtros
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);
const selectedExpenditure = ref<string | null>(null);

// Carregar despesas para o filtro
onMounted(async () => {
  await expenditureStore.listExpenditures({});
});
</script>

<template>
  <div>
    <VCard :title="$t('financial_report')" no-padding>
      <VCardText>
        <div class="d-flex align-center gap-4 mb-6">
          <VTabs v-model="viewType" class="flex-grow-1">
            <VTab value="annual">
              {{ $t('annual') }}
            </VTab>
            <VTab value="monthly" prepend-icon="tabler-calendar">
              {{ $t('monthly') }}
            </VTab>
            <VTab value="daily">
              {{ $t('daily') }}
            </VTab>
          </VTabs>
        </div>

        <!-- Filtros -->
        <div class="d-flex align-center flex-wrap gap-4 mb-6">
          <div class="invoice-list-filter">
            <VLabel>{{ $t('start_date') }}:</VLabel>
            <AppDateTimePicker
              v-model="startDate"
              :placeholder="$t('select_date')"
            />
          </div>
          <div class="invoice-list-filter">
            <VLabel>{{ $t('end_date') }}:</VLabel>
            <AppDateTimePicker
              v-model="endDate"
              :placeholder="$t('select_date')"
            />
          </div>
          <div class="invoice-list-filter">
            <VLabel>{{ $t('expenditure') }}:</VLabel>
            <AppSelect
              v-model="selectedExpenditure"
              :items="[
                { value: null, title: $t('all') },
                ...expenditureStore.list.map((exp) => ({
                  value: exp.expenditure_id,
                  title: exp.name,
                })),
              ]"
              :placeholder="$t('select_expenditure')"
            />
          </div>
        </div>

        <!-- Cards de Resumo Anual -->
        <VWindow v-model="viewType" class="disable-tab-transition">
          <VWindowItem value="annual">
            <div class="d-flex gap-4 flex-wrap mb-6">
              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_revenue') }}
                      </div>
                      <div class="text-h5 text-success font-weight-bold">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualRevenue)
                        }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      color="success"
                    />
                  </div>
                </VCardText>
              </VCard>

              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_expense') }}
                      </div>
                      <div class="text-h5 text-error font-weight-bold">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualExpense)
                        }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      color="error"
                    />
                  </div>
                </VCardText>
              </VCard>

              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_net') }}
                      </div>
                      <div
                        class="text-h5 font-weight-bold"
                        :class="annualNet >= 0 ? 'text-success' : 'text-error'"
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualNet)
                        }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      :color="annualNet >= 0 ? 'success' : 'error'"
                    />
                  </div>
                </VCardText>
              </VCard>
            </div>

            <!-- Detalhamento Mensal -->
            <VCard>
              <VCardTitle>{{ $t('monthly_detail') }}</VCardTitle>
              <VCardText>
                <VTable>
                  <thead>
                    <tr>
                      <th scope="col" class="text-left">{{ $t('month') }}</th>
                      <th scope="col" class="text-left">{{ $t('income') }}</th>
                      <th scope="col" class="text-left">{{ $t('outgoing') }}</th>
                      <th scope="col" class="text-left">{{ $t('net') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="detail in monthlyDetails" :key="detail.month">
                      <td>{{ detail.month }}</td>
                      <td class="text-success font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(detail.income)
                        }}
                      </td>
                      <td class="text-error font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(detail.outgoing)
                        }}
                      </td>
                      <td
                        class="font-weight-medium"
                        :class="detail.net >= 0 ? 'text-success' : 'text-error'"
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(detail.net)
                        }}
                      </td>
                    </tr>
                  </tbody>
                </VTable>
              </VCardText>
            </VCard>
          </VWindowItem>

          <VWindowItem value="monthly">
            <VCard>
              <VCardTitle>{{ $t('monthly_report') }}</VCardTitle>
              <VCardText>
                <div class="text-body-1 text-medium-emphasis">
                  {{ $t('monthly_view_coming_soon') }}
                </div>
              </VCardText>
            </VCard>
          </VWindowItem>

          <VWindowItem value="daily">
            <VCard>
              <VCardTitle>{{ $t('daily_report') }}</VCardTitle>
              <VCardText>
                <div class="text-body-1 text-medium-emphasis">
                  {{ $t('daily_view_coming_soon') }}
                </div>
              </VCardText>
            </VCard>
          </VWindowItem>
        </VWindow>
      </VCardText>
    </VCard>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
