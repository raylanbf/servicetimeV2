---
name: h5p-quiz
description: Implementa no servicetime-v2 o botão "Inserir quiz H5P do tópico" — com a página de um tópico da UDA aberta no editor do Canvas, busca no H5P.com o quiz com o mesmo título da página e o insere no lugar do marcador [iframe - Atividade de Fixação H5P], com 100% de largura — seguindo o PLANO-H5P.md da raiz do repositório. Use sempre que o usuário pedir para implementar, continuar ou retomar o plano do H5P, falar do botão/função do quiz H5P, de inserir H5P automaticamente nas páginas de tópico, ou contar que já tem acesso ao H5P.com — mesmo que não cite o plano pelo nome.
---

# Inserir quiz H5P do tópico

O plano completo está em `PLANO-H5P.md`, na raiz do repositório. Leia-o inteiro antes de qualquer outra coisa: ele traz o contexto já levantado, o código a reaproveitar, as decisões tomadas e as fases. Este arquivo só diz como conduzir o trabalho.

## Como conduzir

1. **Veja em que ponto estamos.** A seção "Andamento" do plano diz o que já foi feito. Continue da primeira etapa em aberto, em vez de recomeçar.

2. **Confira os pré-requisitos (seção 3 do plano) com o usuário.** Pergunte só pelo que ainda não está no plano. Sem conta de autor funcionando no H5P.com, nada da Fase 1 em diante é possível: explique o que falta, em linguagem simples, e pare aí.

3. **Faça a Fase 1 antes de escrever o botão de verdade.** A tela de busca do H5P.com nunca foi vista. Os seletores, a árvore de frames e as respostas de rede precisam vir do diagnóstico da Fase 1 ou do material que o usuário trouxer. Seletor inventado parece funcionar no teste simulado e falha no Canvas real.

4. **Registre o que descobrir.** Ao fim de cada fase, atualize a seção 2 do plano com o que foi visto (formato real do iframe, seletores, como o app abre) e marque o "Andamento". Assim a próxima sessão continua de onde esta parou.

5. **Fase 2 e depois, se for o caso, a Fase 3.** A Fase 3 (em lote) só entra se o teste 4.6 mostrar que um iframe montado à mão abre o quiz e se o usuário quiser o lote.

6. **Teste antes de entregar.** Siga a seção 7 do plano. Se mexer na regra da largura (inclusive ao movê-la para `h5p.js`), rode a regressão:

   ```bash
   # playwright-core numa pasta temporária (o scratchpad da sessão serve)
   cd <scratchpad> && npm init -y && npm i playwright-core
   cd <raiz do repo> && NODE_PATH=<scratchpad>/node_modules node .claude/skills/h5p-quiz/scripts/test-h5p.js
   ```

   Tem que terminar com "TUDO OK". O `extract-h5p.js` tira o `h5pResizeMain` do `background.js` real e segue `importScripts`, então continua valendo depois da refatoração.

7. **Entregue como nas outras funcionalidades.** Diga ao usuário o que mudou, o que foi testado e como (simulação ou Canvas real) e o que ainda depende dele. Commit e versão só se ele pedir; nesse caso, um commit da funcionalidade e outro "Sobe versao para X".

## Por que o plano é assim

- **Nunca salvar a página sozinho:** as páginas de tópico são editadas por várias pessoas ao mesmo tempo. Quem usa o botão confere o resultado e salva.
- **Na dúvida, não escolher o quiz:** inserir o quiz errado num tópico é pior do que pedir um clique. Com 0 ou 2+ nomes iguais, mostre os candidatos e deixe o popup aberto.
- **Mexer só no iframe do H5P:** o resto do HTML fica igual, com o mesmo cuidado do redimensionar H5P e da edição em escala. Os templates da PUC dependem de ids e estilos que uma reserialização estragaria.
- **Seguir o estilo do código ao redor:** JS puro, sem build. As funções injetadas são autocontidas e recebem tudo por `args`. O mundo `MAIN` é necessário para alcançar o TinyMCE e o CodeMirror. Comentários são curtos e em português.
