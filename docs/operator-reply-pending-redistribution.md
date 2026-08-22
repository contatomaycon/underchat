# Follow-up automático por falta de resposta

Esta automação redistribui um atendimento humano quando o contato aguarda uma resposta por mais tempo que o configurado no canal.

## Como a recorrência funciona

1. A primeira mensagem do contato sem resposta cria uma pendência.
2. Ao vencer o prazo, o atendimento é redistribuído pelo Round Robin para outro Atendente elegível.
3. Se ninguém responder ao contato, a pendência continua ativa e uma nova tentativa ocorre após o mesmo prazo.
4. Uma mensagem visível enviada por qualquer atendente encerra a pendência. Reações e anotações internas não a encerram.

Mensagens adicionais do contato não postergam a primeira tentativa enquanto a mesma pendência estiver aberta.

Quando a redistribuição é concluída, o Atendente selecionado passa a ser o único responsável primário. O responsável anterior e quaisquer Atendentes secundários são removidos das atribuições ativas do atendimento. Em redistribuições sucessivas, somente o Atendente selecionado na tentativa mais recente permanece atribuído.

## Escopo por setores

Nas configurações do canal, é possível selecionar um ou mais setores para limitar o follow-up:

- sem nenhum setor selecionado, a automação é global e acompanha atendimentos de todos os setores do canal;
- com setores selecionados, somente atendimentos que estejam em um desses setores criam e mantêm a pendência de redistribuição;
- se um atendimento sair dos setores configurados, a pendência de redistribuição é removida;
- se um atendimento já pendente entrar posteriormente em um setor configurado, ele passa a ser acompanhado a partir da próxima mensagem do contato.

A seleção de setores limita onde a automação acontece, mas não muda o setor do atendimento. O Round Robin continua escolhendo Atendentes elegíveis dentro do setor atual da conversa.

## Quem pode receber a redistribuição

Um Atendente só é elegível se, no momento da tentativa, estiver:

- ativo e não excluído;
- estritamente `online`;
- vinculado ao setor atual do atendimento;
- com acesso ao canal do atendimento;
- diferente do responsável atual;
- abaixo do limite simultâneo configurado para o canal.

Se não houver candidato elegível, o atendimento não é transferido nem encerrado: o responsável atual é preservado e a automação tenta novamente após o intervalo configurado.

## Validação operacional

Para validar mais de uma redistribuição, selecione os setores desejados na configuração do follow-up, associe pelo menos dois Atendentes ao mesmo setor e canal, mantenha ambos online e deixe o contato sem resposta. Confirme também que atendimentos de setores não selecionados não são redistribuídos. Se um Atendente estiver online, mas não estiver vinculado ao setor e ao canal, ele não será selecionado.
