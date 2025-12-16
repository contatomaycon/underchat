import { computed } from 'vue';

interface BrazilianDDD {
  value: string;
  title: string;
}

const brazilianDDDs: BrazilianDDD[] = [
  { value: '11', title: '11 - São Paulo' },
  { value: '12', title: '12 - Vale do Paraíba' },
  { value: '13', title: '13 - Baixada Santista' },
  { value: '14', title: '14 - Bauru' },
  { value: '15', title: '15 - Sorocaba' },
  { value: '16', title: '16 - Ribeirão Preto' },
  { value: '17', title: '17 - São José do Rio Preto' },
  { value: '18', title: '18 - Presidente Prudente' },
  { value: '19', title: '19 - Campinas' },
  { value: '21', title: '21 - Rio de Janeiro' },
  { value: '22', title: '22 - Interior do Rio' },
  { value: '24', title: '24 - Volta Redonda' },
  { value: '27', title: '27 - Vitória' },
  { value: '28', title: '28 - Cachoeiro de Itapemirim' },
  { value: '31', title: '31 - Belo Horizonte' },
  { value: '32', title: '32 - Juiz de Fora' },
  { value: '33', title: '33 - Governador Valadares' },
  { value: '34', title: '34 - Uberlândia' },
  { value: '35', title: '35 - Poços de Caldas' },
  { value: '37', title: '37 - Divinópolis' },
  { value: '38', title: '38 - Montes Claros' },
  { value: '41', title: '41 - Curitiba' },
  { value: '42', title: '42 - Ponta Grossa' },
  { value: '43', title: '43 - Londrina' },
  { value: '44', title: '44 - Maringá' },
  { value: '45', title: '45 - Foz do Iguaçu' },
  { value: '46', title: '46 - Francisco Beltrão' },
  { value: '47', title: '47 - Joinville' },
  { value: '48', title: '48 - Florianópolis' },
  { value: '49', title: '49 - Chapecó' },
  { value: '51', title: '51 - Porto Alegre' },
  { value: '53', title: '53 - Pelotas' },
  { value: '54', title: '54 - Caxias do Sul' },
  { value: '55', title: '55 - Santa Maria' },
  { value: '61', title: '61 - Brasília' },
  { value: '62', title: '62 - Goiânia' },
  { value: '63', title: '63 - Palmas' },
  { value: '64', title: '64 - Rio Verde' },
  { value: '65', title: '65 - Cuiabá' },
  { value: '66', title: '66 - Rondonópolis' },
  { value: '67', title: '67 - Campo Grande' },
  { value: '68', title: '68 - Rio Branco' },
  { value: '69', title: '69 - Porto Velho' },
  { value: '71', title: '71 - Salvador' },
  { value: '73', title: '73 - Ilhéus' },
  { value: '74', title: '74 - Juazeiro' },
  { value: '75', title: '75 - Feira de Santana' },
  { value: '77', title: '77 - Vitória da Conquista' },
  { value: '79', title: '79 - Aracaju' },
  { value: '81', title: '81 - Recife' },
  { value: '87', title: '87 - Petrolina' },
  { value: '82', title: '82 - Maceió' },
  { value: '83', title: '83 - João Pessoa' },
  { value: '84', title: '84 - Natal' },
  { value: '85', title: '85 - Fortaleza' },
  { value: '86', title: '86 - Teresina' },
  { value: '88', title: '88 - Juazeiro do Norte' },
  { value: '89', title: '89 - Picos' },
  { value: '91', title: '91 - Belém' },
  { value: '92', title: '92 - Manaus' },
  { value: '93', title: '93 - Santarém' },
  { value: '94', title: '94 - Marabá' },
  { value: '95', title: '95 - Boa Vista' },
  { value: '96', title: '96 - Macapá' },
  { value: '97', title: '97 - Coari' },
  { value: '98', title: '98 - São Luís' },
  { value: '99', title: '99 - Imperatriz' },
];

export const useBrazilianDDDs = () => {
  const items = computed(() => brazilianDDDs);

  return {
    items,
  };
};
