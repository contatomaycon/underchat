// ========== Definição de elemento Schema ==========

const DEFAULT_SELECTOR_DEFINITIONS = [
    {
        key: "input_box",
        description: "A caixa de entrada onde o usuário insere o texto (textarea ou contenteditable elemento)",
        enabled: true,
        required: true
    },
    {
        key: "send_btn",
        description: "botão para enviar uma mensagem (geralmente type=submit ou um botão com um ícone de envio)",
        enabled: true,
        required: true
    },
    {
        key: "result_container",
        description: "AI Um contêiner para conteúdo de resposta (contendo apenas AI texto de saída, excluindo mensagens do usuário)",
        enabled: true,
        required: true
    },
    {
        key: "new_chat_btn",
        description: "Botão para criar uma nova conversa (clique para iniciar uma nova conversa)",
        enabled: true,
        required: false
    },
    {
        key: "message_wrapper",
        description: "Contêiner completo de mensagem (elemento externo que envolve uma única mensagem, usado para emenda de vários nós)",
        enabled: false,
        required: false
    },
    {
        key: "generating_indicator",
        description: "Gerando indicador (como botão de parada, animação de carregamento, usado para detectar se a saída ainda está sendo produzida)",
        enabled: false,
        required: false
    },
    {
        key: "upload_btn",
        description: "Abra o botão de upload do seletor de arquivo (a seleção de arquivo nativo geralmente aparece após clicar nele)",
        enabled: false,
        required: false
    },
    {
        key: "file_input",
        description: "Caixa de entrada de arquivo nativo (input[type=file]），Usado para injetar arquivos diretamente",
        enabled: false,
        required: false
    },
    {
        key: "drop_zone",
        description: "Suporta área de upload de arrastar e soltar (alguns sites não suportam colar, mas suportam arrastar e soltar)",
        enabled: false,
        required: false
    }
];

// ========== Configuração Schema definição ==========

// Constantes do navegador Schema（Exibição chinesa pura) const BROWSER_CONSTANTS_SCHEMA = {
    connection: {
        label: 'Configuração de conexão',
        icon: '🔌',
        items: {
            DEFAULT_PORT: {
                label: 'Porta de depuração',
                desc: 'Chrome DevTools Porta de depuração remota',
                type: 'number',
                min: 1024,
                max: 65535,
                default: 9222
            },
            CONNECTION_TIMEOUT: {
                label: 'Tempo limite de conexão',
                unit: 'Segundo',
                desc: 'Tempo limite de conexão do navegador',
                type: 'number',
                min: 1,
                max: 60,
                default: 10
            }
        }
    },
    delay: {
        label: 'Atraso na operação',
        icon: '⏱️',
        desc: 'Faixas de latência aleatórias que simulam a operação humana',
        items: {
            STEALTH_DELAY_MIN: {
                label: 'Limite inferior de atraso furtivo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.1
            },
            STEALTH_DELAY_MAX: {
                label: 'Limite de atraso furtivo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.3
            },
            ACTION_DELAY_MIN: {
                label: 'Limite inferior de atraso de ação',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.15
            },
            ACTION_DELAY_MAX: {
                label: 'Limite superior de atraso de ação',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.3
            }
        }
    },
    element: {
        label: 'Pesquisa de elemento',
        icon: '🔍',
        items: {
            DEFAULT_ELEMENT_TIMEOUT: {
                label: 'Tempo de espera padrão',
                unit: 'Segundo',
                desc: 'Tempo limite padrão para encontrar elementos',
                type: 'number',
                min: 1,
                default: 3
            },
            FALLBACK_ELEMENT_TIMEOUT: {
                label: 'Tempo de espera de backup',
                unit: 'Segundo',
                desc: 'Tempo limite de nova tentativa após a primeira falha',
                type: 'number',
                min: 0.5,
                default: 1
            },
            ELEMENT_CACHE_MAX_AGE: {
                label: 'Período de validade do cache',
                unit: 'Segundo',
                desc: 'Tempo de cache da posição do elemento',
                type: 'number',
                min: 1,
                default: 5.0
            }
        }
    },
    stream: {
        label: 'Monitoramento de streaming',
        icon: '📡',
        desc: 'controlar AI Frequência de detecção de resposta e determinação de tempo limite',
        items: {
            STREAM_CHECK_INTERVAL_MIN: {
                label: 'Verifique o limite inferior do intervalo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0.05,
                default: 0.1
            },
            STREAM_CHECK_INTERVAL_MAX: {
                label: 'Verifique o limite superior do intervalo',
                unit: 'Segundo',
                type: 'number',
                step: 0.1,
                min: 0.1,
                default: 1.0
            },
            STREAM_CHECK_INTERVAL_DEFAULT: {
                label: 'Intervalo de verificação padrão',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0.05,
                default: 0.3
            },
            STREAM_SILENCE_THRESHOLD: {
                label: 'Limite de tempo limite silencioso',
                unit: 'Segundo',
                desc: 'Quanto tempo leva para determinar se não há conteúdo novo?',
                type: 'number',
                min: 1,
                default: 8.0
            },
            STREAM_SILENCE_THRESHOLD_FALLBACK: {
                label: 'Backup de tempo limite silencioso',
                unit: 'Segundo',
                desc: 'Limite alternativo para modelos lentos',
                type: 'number',
                min: 1,
                default: 12
            },
            STREAM_MAX_TIMEOUT: {
                label: 'tempo limite máximo',
                unit: 'Segundo',
                desc: 'Limite de tempo limite absoluto para uma única resposta',
                type: 'number',
                min: 60,
                default: 600
            },
            STREAM_INITIAL_WAIT: {
                label: 'espera inicial',
                unit: 'Segundo',
                desc: 'Tempo máximo de espera pela primeira resposta',
                type: 'number',
                min: 10,
                default: 180
            },
            STREAM_STABLE_COUNT_THRESHOLD: {
                label: 'Número de julgamentos estáveis',
                desc: 'Quantas verificações consecutivas devem ser feitas antes que seja determinado que está completo?',
                type: 'number',
                min: 1,
                default: 8
            }
        }
    },
    streamAdvanced: {
        label: 'Monitoramento de streaming (avançado)',
        icon: '⚙️',
        collapsed: true,
        items: {
            STREAM_RERENDER_WAIT: {
                label: 'Renderizar espera',
                unit: 'Segundo',
                desc: 'Aguarde a página ser renderizada novamente',
                type: 'number',
                step: 0.1,
                default: 0.5
            },
            STREAM_CONTENT_SHRINK_TOLERANCE: {
                label: 'Tempos de tolerância à redução de conteúdo',
                desc: 'O número de vezes que o conteúdo pode ser encurtado',
                type: 'number',
                min: 0,
                default: 3
            },
            STREAM_MIN_VALID_LENGTH: {
                label: 'Comprimento mínimo válido',
                unit: 'personagem',
                desc: 'Comprimento mínimo para que uma resposta seja considerada válida',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_INITIAL_ELEMENT_WAIT: {
                label: 'elemento inicial espera',
                unit: 'Segundo',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_MAX_ABNORMAL_COUNT: {
                label: 'Número máximo de exceções',
                desc: 'Quantas exceções consecutivas serão feitas antes de abortar?',
                type: 'number',
                min: 1,
                default: 5
            },
            STREAM_MAX_ELEMENT_MISSING: {
                label: 'Número máximo de elementos ausentes',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_CONTENT_SHRINK_THRESHOLD: {
                label: 'Limite de redução de conteúdo',
                desc: 'A redução de conteúdo que exceda esta proporção é considerada anormal',
                type: 'number',
                step: 0.05,
                min: 0,
                max: 1,
                default: 0.3
            }
        }
    },
    validation: {
        label: 'Validação de entrada',
        icon: '✅',
        items: {
            MAX_MESSAGE_LENGTH: {
                label: 'Comprimento máximo da mensagem',
                unit: 'personagem',
                type: 'number',
                min: 1000,
                default: 100000
            },
            MAX_MESSAGES_COUNT: {
                label: 'Número máximo de mensagens',
                unit: 'tira',
                type: 'number',
                min: 1,
                default: 100
            }
        }
    },

    // 🆕 Envio de imagem relacionado     image: {
        label: 'Envio de imagem',
        icon: '🖼️',
        items: {
            UPLOAD_HISTORY_IMAGES: {
                label: 'Faça upload de fotos de conversas históricas',
                desc: 'Ativado: também serão carregadas imagens que aparecem em mensagens históricas; desligado: apenas as imagens nas mensagens deste usuário serão carregadas.',
                type: 'switch',
                default: true
            }
        }
    },
    globalIntercept: {
        label: 'Interceptação de rede global',
        icon: '🛡️',
        collapsed: true,
        items: {
            GLOBAL_NETWORK_INTERCEPTION_ENABLED: {
                label: 'Habilitar escuta residente',
                desc: 'As guias inativas continuam monitorando eventos de rede; quando as tarefas são executadas, elas darão lugar automaticamente ao monitoramento do fluxo de trabalho.',
                type: 'switch',
                default: false
            },
            GLOBAL_NETWORK_INTERCEPTION_LISTEN_PATTERN: {
                label: 'Modo de escuta',
                desc: 'DrissionPage listen.start() de pattern，Normalmente usado http',
                type: 'text',
                default: 'http'
            },
            GLOBAL_NETWORK_INTERCEPTION_WAIT_TIMEOUT: {
                label: 'Tempo limite da pesquisa',
                unit: 'Segundo',
                desc: 'wait() Tempo limite de espera único: quanto menor o tempo limite, mais rápida será a resposta, mas maior será a sobrecarga.',
                type: 'number',
                step: 0.1,
                min: 0.1,
                default: 0.5
            },
            GLOBAL_NETWORK_INTERCEPTION_RETRY_DELAY: {
                label: 'Intervalo de novas tentativas de exceção',
                unit: 'Segundo',
                desc: 'Intervalo de reinicialização após exceção do ouvinte',
                type: 'number',
                step: 0.1,
                min: 0.2,
                default: 1.0
            }
        }
    }
};

// variáveis ​​de ambiente Schema
const ENV_CONFIG_SCHEMA = {
    service: {
        label: 'Configuração de serviço',
        icon: '🖥️',
        items: {
            APP_HOST: {
                label: 'endereço de escuta',
                desc: '0.0.0.0 Permitir acesso externo,127.0.0.1 apenas locais',
                type: 'text',
                default: '127.0.0.1'
            },
            APP_PORT: {
                label: 'porta de escuta',
                type: 'number',
                min: 1,
                max: 65535,
                default: 8199
            },
            APP_DEBUG: {
                label: 'modo de depuração',
                desc: 'ligar API Documentação e erros detalhados',
                type: 'switch',
                default: true
            },
            LOG_LEVEL: {
                label: 'Nível de registro',
                type: 'select',
                options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                default: 'INFO'
            }
        }
    },
    auth: {
        label: 'Configuração de autenticação',
        icon: '🔐',
        items: {
            AUTH_ENABLED: {
                label: 'ativar autenticação',
                type: 'switch',
                default: false
            },
            AUTH_TOKEN: {
                label: 'Bearer Token',
                type: 'password',
                desc: 'AUTH_ENABLED=true Deve ser definido quando',
                default: ''
            }
        }
    },
    cors: {
        label: 'CORS Configuração',
        icon: '🌐',
        items: {
            CORS_ENABLED: {
                label: 'habilitar CORS',
                type: 'switch',
                default: true
            },
            CORS_ORIGINS: {
                label: 'Fontes de origem cruzada permitidas',
                desc: 'Separe múltiplos com vírgulas,* Indica que todos são permitidos',
                type: 'text',
                default: '*'
            }
        }
    },
    browser: {
        label: 'Configuração do navegador',
        icon: '🌍',
        items: {
            BROWSER_PORT: {
                label: 'Chrome Porta de depuração',
                type: 'number',
                min: 1024,
                max: 65535,
                default: 9222
            }
        }
    },
    proxy: {
        label: 'Configuração do agente',
        icon: '🔀',
        items: {
            PROXY_ENABLED: {
                label: 'Habilitar proxy',
                desc: 'Quando ativado, o navegador acessará a Internet através de um servidor proxy',
                type: 'switch',
                default: false
            },
            PROXY_ADDRESS: {
                label: 'endereço proxy',
                desc: 'apoiar socks5:// ou http:// protocolo',
                type: 'text',
                default: 'socks5://127.0.0.1:1080'
            },
            PROXY_BYPASS: {
                label: 'ignorar proxy',
                desc: 'Não use endereços proxy. Separe vários endereços com vírgulas.',
                type: 'text',
                default: 'localhost,127.0.0.1'
            }
        }
    },
    dashboard: {
        label: 'Dashboard Configuração',
        icon: '📊',
        items: {
            DASHBOARD_ENABLED: {
                label: 'habilitar Dashboard',
                type: 'switch',
                default: true
            },
            DASHBOARD_FILE: {
                label: 'Dashboard caminho do arquivo',
                type: 'text',
                default: 'static/index.html'
            }
        }
    },
    ai: {
        label: 'AI Configuração de análise',
        icon: '🤖',
        desc: 'Auxiliar AI Usado para analisar automaticamente a estrutura da página',
        items: {
            HELPER_API_KEY: {
                label: 'API Key',
                type: 'password',
                default: ''
            },
            HELPER_BASE_URL: {
                label: 'API endereço',
                type: 'text',
                default: 'http://127.0.0.1:5104/v1'
            },
            HELPER_MODEL: {
                label: 'Nome do modelo',
                type: 'text',
                default: 'gemini-3.0-pro'
            },
            MAX_HTML_CHARS: {
                label: 'HTML Número máximo de caracteres',
                desc: 'Truncado se excedido para salvar Token',
                type: 'number',
                min: 10000,
                default: 120000
            }
        }
    },
    files: {
        label: 'Arquivo de configuração',
        icon: '📁',
        items: {
            SITES_CONFIG_FILE: {
                label: 'Caminho do arquivo de configuração do site',
                type: 'text',
                default: 'sites.json'
            }
        }
    }
};


window.DEFAULT_SELECTOR_DEFINITIONS = DEFAULT_SELECTOR_DEFINITIONS;
window.BROWSER_CONSTANTS_SCHEMA = BROWSER_CONSTANTS_SCHEMA;

window.ENV_CONFIG_SCHEMA = ENV_CONFIG_SCHEMA;

