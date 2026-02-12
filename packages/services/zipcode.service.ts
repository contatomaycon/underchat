import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { ZipcodeResponseSchema } from '@core/schema/zipcode/viewZipcode/response.schema';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { ZipcodeViewRepository } from '@core/repositories/zipcode/ZipcodeView.repository';
import { ZipcodeStateViewRepository } from '@core/repositories/zipcode/ZipcodeStateView.repository';
import { ZipcodeCityViewRepository } from '@core/repositories/zipcode/ZipcodeCityView.repository';
import { ListStatesRequest } from '@core/schema/zipcode/listStates/request.schema';
import { ListCitiesRequest } from '@core/schema/zipcode/listCities/request.schema';
import { StateListResponse } from '@core/schema/zipcode/listStates/response.schema';
import { CityListResponse } from '@core/schema/zipcode/listCities/response.schema';

@injectable()
export class ZipcodeService {
  constructor(
    @inject(ZipcodeViewRepository)
    private readonly zipcodeViewRepository: ZipcodeViewRepository,
    @inject(ZipcodeStateViewRepository)
    private readonly zipcodeStateViewRepository: ZipcodeStateViewRepository,
    @inject(ZipcodeCityViewRepository)
    private readonly zipcodeCityViewRepository: ZipcodeCityViewRepository
  ) {}

  private readonly clearCode = (zipCode: string): string => {
    return zipCode.replaceAll(/\D/g, '');
  };

  private readonly axiosViaCepInstance = () => {
    return axios.create({
      baseURL: `https://viacep.com.br`,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  private readonly viacep = async (zipCode: string) => {
    return this.axiosViaCepInstance().get(`/ws/${zipCode}/json/`);
  };

  searchZipCodeApi = async (
    zipcode: string
  ): Promise<ZipcodeResponseSchema | null> => {
    const responseViaCep = await this.viacep(zipcode);

    if (!responseViaCep?.data?.erro && responseViaCep.status === 200) {
      const zipCodeResponse = {
        zipcode: this.clearCode(responseViaCep.data.cep),
        address_1: responseViaCep.data.logradouro,
        address_2: responseViaCep.data.complemento,
        district: responseViaCep.data.bairro,
        city: responseViaCep.data.localidade,
        state: responseViaCep.data.uf,
      } as ZipcodeResponseSchema;

      return zipCodeResponse;
    }

    return null;
  };

  viewZipcode = async (request: ViewZipcodeRequest) => {
    return this.zipcodeViewRepository.zipcodeView(request);
  };

  listStates = async (
    request: ListStatesRequest
  ): Promise<StateListResponse> => {
    return this.zipcodeStateViewRepository.listStates(request);
  };

  listCities = async (
    request: ListCitiesRequest
  ): Promise<CityListResponse> => {
    return this.zipcodeCityViewRepository.listCities(request);
  };
}
