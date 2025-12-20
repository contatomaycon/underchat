import { ref, computed } from 'vue';
import { useRegisterStore } from '@/@webcore/stores/register';

interface StateItem {
  id_zipcode_state: string;
  state: string;
  abbreviation: string | null;
  fiscal_code: string | null;
}

interface CityItem {
  id_zipcode_city: string;
  city: string;
  fiscal_code: string | null;
}

export const useRegisterStatesAndCities = () => {
  const registerStore = useRegisterStore();
  const states = ref<StateItem[]>([]);
  const cities = ref<CityItem[]>([]);
  const loadingStates = ref(false);
  const loadingCities = ref(false);
  const stateSearchQuery = ref('');
  const citySearchQuery = ref('');

  const filteredStates = computed(() => {
    if (!stateSearchQuery.value) {
      return states.value.map((state) => ({
        value: state.id_zipcode_state,
        title: state.abbreviation
          ? `${state.state} (${state.abbreviation})`
          : state.state,
      }));
    }
    const query = stateSearchQuery.value.toLowerCase();
    return states.value
      .filter(
        (state) =>
          state.state.toLowerCase().includes(query) ||
          state.abbreviation?.toLowerCase().includes(query)
      )
      .map((state) => ({
        value: state.id_zipcode_state,
        title: state.abbreviation
          ? `${state.state} (${state.abbreviation})`
          : state.state,
      }));
  });

  const filteredCities = computed(() => {
    if (!citySearchQuery.value) {
      return cities.value.map((city) => ({
        value: city.id_zipcode_city,
        title: city.city,
      }));
    }
    const query = citySearchQuery.value.toLowerCase();
    return cities.value
      .filter((city) => city.city.toLowerCase().includes(query))
      .map((city) => ({
        value: city.id_zipcode_city,
        title: city.city,
      }));
  });

  const loadStates = async (countryId?: number) => {
    try {
      loadingStates.value = true;
      const params: { country_id?: number } = {};
      if (countryId) {
        params.country_id = countryId;
      }
      const response = await registerStore.listStates(params);
      if (response) {
        states.value = response;
      } else {
        states.value = [];
      }
    } catch (error) {
      console.error('Error loading states:', error);
      states.value = [];
    } finally {
      loadingStates.value = false;
    }
  };

  const loadCities = async (stateId: string) => {
    try {
      loadingCities.value = true;
      const response = await registerStore.listCities({
        id_zipcode_state: stateId,
      });
      if (response) {
        cities.value = response;
      } else {
        cities.value = [];
      }
    } catch (error) {
      console.error('Error loading cities:', error);
      cities.value = [];
    } finally {
      loadingCities.value = false;
    }
  };

  const clearCities = () => {
    cities.value = [];
    citySearchQuery.value = '';
  };

  return {
    states,
    cities,
    loadingStates,
    loadingCities,
    stateSearchQuery,
    citySearchQuery,
    filteredStates,
    filteredCities,
    loadStates,
    loadCities,
    clearCities,
  };
};
