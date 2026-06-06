COMMIT_URL = "https://github.com/tulir/whatsmeow/commit/81f8702130bdaf55dd0482c778eda7f9eaa21fe4"

Você é um engenheiro sênior responsável por “portar” exatamente o commit referenciado em COMMIT_URL do repositório upstream para o meu projeto (um fork).

OBJETIVO

- Aplicar NO MEU PROJETO todas as alterações do commit em COMMIT_URL (100%: arquivos criados, removidos, renomeados e modificados).
- O resultado final deve refletir exatamente o efeito funcional do commit no upstream, porém preservando as customizações do meu fork.

REGRAS CRÍTICAS

1. Cobertura total:
   - Não pode faltar nenhuma mudança do commit em COMMIT_URL: toda diff deve ser portada.
   - Inclua renames/moves/deletes/adds e qualquer ajuste em testes, build, docs, typings, configs, etc.

2. Prioridade do meu código:
   - Quando existir conflito entre upstream e alterações do meu fork, preserve meu comportamento/customizações.
   - Ainda assim, garanta que o commit de COMMIT_URL seja efetivamente incorporado (mesmo que adaptado) sem perder o objetivo da mudança.

3. Se você precisar alterar algo que eu modifiquei:
   - Você DEVE identificar e relatar explicitamente:
     - Arquivo
     - Trecho/assinatura (função/classe/linha aproximada)
     - Motivo da mudança
     - Como manteve a intenção do meu fork
     - Alternativa possível (se houver)

4. Não “simplifique” nem “pule” mudanças:
   - Não remova partes do commit por “parecerem desnecessárias”.
   - Não reescreva em estilo diferente sem necessidade.
   - Alterações devem ser mínimas e focadas em portar o commit.

FLUXO DE TRABALHO (execute nesta ordem)
A) Analisar o commit em COMMIT_URL

- Liste todos os arquivos afetados (added/modified/deleted/renamed).
- Resuma a intenção do commit em 3–6 bullets.

B) Mapear para o meu fork

- Para cada arquivo do commit em COMMIT_URL, encontre o arquivo correspondente no meu fork.
- Se houver diferenças de estrutura, explique como fez o mapeamento.

C) Aplicar a portabilidade

- Faça as edições necessárias no meu fork para reproduzir as mudanças do commit em COMMIT_URL.
- Se existir rename/move, replique isso no fork.
- Se o commit remove arquivo/trecho, reflita isso no fork (a menos que conflite com customização minha — nesse caso, adapte mantendo o objetivo).

D) Verificação obrigatória

- Garanta que não ficou nada de fora: “Checklist de Portabilidade” (um item por arquivo/alteração do commit em COMMIT_URL).
- Rode/ajuste onde aplicável: tipos, lint, build e testes (ou no mínimo indique os comandos e possíveis impactos).
- Confirme que não há imports quebrados e que a API pública não foi afetada indevidamente.

FORMATO DE SAÍDA (obrigatório)

1. Resumo do commit (intenção) — baseado em COMMIT_URL
2. Arquivos afetados no commit (added/modified/deleted/renamed) — COMMIT_URL
3. Implementação no fork
   - Lista de alterações por arquivo (com explicação curta)
4. PONTOS ONDE MEU CÓDIGO FOI TOCADO (obrigatório mesmo que vazio)
   - Se vazio: “Nenhum ponto do fork foi alterado em trechos customizados.”
5. Checklist 100% concluído (um item por mudança/arquivo)
6. Observações finais + comandos sugeridos para validar

IMPORTANTE

- Se em algum momento você não conseguir mapear um arquivo ou entender uma diferença estrutural, NÃO pare: proponha a adaptação mais segura e siga, registrando no relatório.
- O resultado deve compilar e manter o comportamento do meu fork, incorporando integralmente o commit referenciado em COMMIT_URL.
- Não precisa gerar md com o relatório
- Se for possível e tiver problemas com a implementação, faça algo robusto para melhorar e atingir a ideia proposta.
