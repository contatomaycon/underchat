---
title: Token da API
description: Ciclo de vida, segurança, geração, consulta, rotação e revogação do token público.
---

# Token da API

Cada conta pode manter **um token público ativo**. A credencial identifica a conta,
não um usuário: quem a gerou permanece registrado somente para auditoria. Em cada
operação, `x-underchat-user-id` seleciona o usuário executor cujas permissões,
canais e setores serão aplicados.

A credencial possui 256 bits de entropia e um prefixo identificável; o valor não é
uma sessão JWT, não muda ao entrar ou sair do painel e continua válido se o usuário
que a gerou for desativado ou perder permissões.

## Ciclo de vida

| Estado          | Significado                                                  | Efeito nas chamadas                                |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Não configurado | A conta nunca gerou um token ativo.                          | Toda chamada autenticada falha.                    |
| Ativo           | A chave pode ser usada enquanto conta e plano forem válidos. | A API valida o executor de cada requisição.        |
| Rotacionado     | Um novo valor substituiu o anterior.                         | O valor anterior deixa de funcionar imediatamente. |
| Revogado        | O token foi desativado pelo painel.                          | O valor revogado retorna erro de autenticação.     |

Não existe expiração automática. A Underchat recusa a chave quando ela estiver
revogada ou o plano estiver indisponível. Depois de autenticar a conta, a chamada é
recusada se o executor informado estiver inativo, excluído, fora da conta ou sem a
permissão exigida pela rota.

## Gerar pelo painel

1. Acesse **Integração** no menu administrativo.
2. No card **API pública**, selecione **Gerar token**.
3. Revise o usuário registrado como gerador para fins de auditoria.
4. Confirme e copie a credencial.
5. Armazene-a no cofre de segredos da aplicação consumidora.

O card permite revelar e consultar novamente o token ativo. Isso é possível porque
o valor é armazenado de forma criptografada; a autenticação, porém, compara apenas
o hash da credencial.

## Administração pelo painel

Geração, consulta, rotação e revogação pertencem ao painel administrativo,
não à API PUBLIC. Não tente administrar a credencial pela base URL documentada
neste portal nem autenticar a tela com o próprio token.

O card **API pública** mostra o estado da credencial, uma prévia para conferência,
o gerador registrado para auditoria e o último uso conhecido. O valor completo
pode ser revelado no painel por um usuário autorizado; ainda assim, prefira
transferi-lo diretamente para um cofre de segredos e evite copiá-lo por canais de
mensagem ou tickets.

## Rotacionar sem indisponibilidade

A rotação invalida o valor anterior imediatamente. Faça uma janela coordenada:

1. pause consumidores ou impeça novas tarefas;
2. gere o novo token no card;
3. atualize o secret manager;
4. reinicie ou recarregue os consumidores;
5. valide uma operação de leitura e uma operação de escrita;
6. retome o processamento.

Como só existe um token ativo, não há período de sobreposição entre chaves. Planeje
a rotação como uma troca atômica do segredo da aplicação.

## Revogar

Use **Revogar token** quando uma credencial puder ter sido exposta ou quando a
integração for descontinuada. Para impedir que uma pessoa atue como executor,
desative o usuário ou remova suas permissões; não é necessário rotacionar a chave
da conta. A revogação invalida o cache de autenticação sem janela de tolerância.

::: danger Poder da credencial
Quem possui a chave pode selecionar qualquer usuário ativo da conta em
`x-underchat-user-id`. O header de executor é um seletor de contexto, não um segundo
segredo. Restrinja a chave a serviços confiáveis e monitore o executor registrado
em cada operação.
:::

::: warning Chaves diferentes, finalidades diferentes
A chave inserida no caminho de `/v1/webhook/:keyapi` identifica um webhook de entrada
e está vinculada a um canal/worker. Ela não autentica `/v1/chat`,
`/v1/label-template`, `/v1/sector` ou `/v1/user`. Da mesma forma, o token público do
card API não autentica o webhook.
:::

## Práticas recomendadas

- restrinja a leitura do segredo ao serviço que faz as chamadas;
- nunca registre headers completos em logs, traces ou ferramentas de erro;
- não reutilize o token entre contas ou ambientes;
- rotacione ao suspeitar de exposição ou trocar o sistema consumidor;
- monitore `last_used_at` para detectar credenciais abandonadas;
- prefira chamadas server-to-server; não exponha o token no navegador.
