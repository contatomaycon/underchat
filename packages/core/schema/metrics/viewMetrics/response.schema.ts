import { Static, Type } from '@sinclair/typebox';

const socketsSchema = Type.Object({
  open_fds: Type.Number({
    description: 'Número de descritores de arquivo abertos',
  }),
  max_fds: Type.Number({
    description: 'Número máximo de descritores de arquivo',
  }),
  connections: Type.Number({
    description: 'Número de conexões ativas',
  }),
});

const disksSchema = Type.Object({
  size: Type.Number({ description: 'Tamanho total do disco em bytes' }),
  used: Type.Number({ description: 'Espaço usado no disco em bytes' }),
  available: Type.Number({ description: 'Espaço livre no disco em bytes' }),
  busy_percentage: Type.Number({
    description: 'Porcentagem de uso do disco',
  }),
  read_bytes_sec: Type.Number({
    description: 'Taxa de leitura em bytes por segundo',
  }),
  disks: Type.Array(
    Type.Object({
      fs: Type.String({ description: 'Sistema de arquivos' }),
      type: Type.String({ description: 'Tipo de disco' }),
      size: Type.Number({ description: 'Tamanho total do disco em bytes' }),
      used: Type.Number({ description: 'Espaço usado no disco em bytes' }),
      available: Type.Number({
        description: 'Espaço livre no disco em bytes',
      }),
      busy_percentage: Type.Number({
        description: 'Porcentagem de uso do disco',
      }),
      read_bytes_sec: Type.Number({
        description: 'Taxa de leitura em bytes por segundo',
      }),
    })
  ),
});

const networksSchema = Type.Object({
  speed: Type.Number({ description: 'Velocidade da rede em bytes' }),
  upload: Type.Number({ description: 'Upload em bytes' }),
  upload_percentage: Type.Number({ description: 'Upload em %' }),
  download: Type.Number({ description: 'Download em bytes' }),
  download_percentage: Type.Number({ description: 'Download em %' }),
  rtt_ms: Type.Number({ description: 'RTT em milissegundos' }),
  retrans_percentage: Type.Number({
    description: 'Porcentagem de retransmissões',
  }),
  established_conns: Type.Number({
    description: 'Conexões estabelecidas',
  }),
  errors: Type.Number({ description: 'Erros de rede' }),
});

const osSchema = Type.Object({
  platform: Type.String({ description: 'Plataforma do sistema operacional' }),
  distro: Type.String({ description: 'Distribuição do sistema operacional' }),
  release: Type.String({ description: 'Versão do sistema operacional' }),
  codename: Type.String({
    description: 'Nome de código do sistema operacional',
  }),
  kernel: Type.String({ description: 'Versão do kernel' }),
  arch: Type.String({ description: 'Arquitetura do sistema operacional' }),
  hostname: Type.String({ description: 'Nome do host' }),
});

export const viewMetricsResponseSchema = Type.Object({
  cpu: Type.Object({
    manufacturer: Type.String({ description: 'Fabricante do processador' }),
    brand: Type.String({ description: 'Modelo do processador' }),
    cores: Type.Number({ description: 'Quantidade de núcleos lógicos' }),
    usage: Type.Number({ description: 'Uso médio da CPU em %' }),
    load_avg: Type.Array(Type.Number(), {
      description: 'Carga média da CPU nos últimos 1, 5 e 15 minutos',
    }),
    temperature: Type.Number({
      description: 'Temperatura do processador em graus Celsius',
    }),
    iowait_percentage: Type.Number({
      description: 'Porcentagem de tempo em espera de I/O',
    }),
  }),
  memory: Type.Object({
    total: Type.Number({ description: 'Memória total em bytes' }),
    used: Type.Number({ description: 'Memória usada em bytes' }),
    free: Type.Number({ description: 'Memória livre em bytes' }),
  }),
  disk: disksSchema,
  network: networksSchema,
  os: osSchema,
  uptime: Type.Number({
    description: 'Tempo de atividade do servidor em segundos',
  }),
  sockets: socketsSchema,
});

export type ViewMetricsResponse = Static<typeof viewMetricsResponseSchema>;
export type ViewMetricsDisksResponse = Static<typeof disksSchema>;
export type ViewMetricsNetworksResponse = Static<typeof networksSchema>;
export type ViewMetricsSocketsResponse = Static<typeof socketsSchema>;
