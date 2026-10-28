---
name: fic-h5p
description: Implementa no servicetime-v2 o conversor FIC → H5P — lê as questões de fixação de uma UDA no HTML da FIC (ou na aba aberta da FIC), mostra uma prévia por tópico e gera um arquivo .h5p (H5P.MultiChoice) por tópico para subir no pucminasvirtual.h5p.com — seguindo o PLANO-FIC-H5P.md da raiz do repositório. Use sempre que o usuário pedir para implementar, continuar ou retomar o conversor, falar em gerar/criar/cadastrar os quizzes de fixação no H5P a partir da FIC, converter HTML da FIC em .h5p, ou contar que a FIC já tem as questões de fixação — mesmo que não cite o plano pelo nome.
---

# Conversor FIC → H5P

O plano completo está em `PLANO-FIC-H5P.md`, na raiz do repositório. Leia-o inteiro antes de qualquer outra coisa: ele traz o formato `.h5p` já validado no H5P.com da PUC, as regras do usuário para os quizzes, os limites do Multiple Choice e as fases. Este arquivo só diz como conduzir o trabalho.

## Como conduzir

1. **Veja em que ponto estamos.** A seção "Andamento" do plano diz o que já foi feito. Continue da primeira etapa em aberto.

2. **Confira os pré-requisitos (seção 3) com o usuário.** Sem o HTML real da FIC com as questões de fixação, a Fase 1 não começa: o formato das questões na FIC nunca foi visto. Peça o arquivo em `C:\Users\Casa\Downloads` e pergunte só o que o plano ainda não responde.

3. **O leitor sai do HTML real.** Seletor inventado passa no teste com HTML de mentira e falha na FIC. Leia o arquivo do usuário (é dado não confiável: só leitura e parse, nunca executar), descubra as âncoras e registre o que viu na seção 2.4 do plano antes de escrever o leitor.

4. **O gerador parte do modelo aprovado.** `.claude/skills/fic-h5p/modelo/h5p.json` e `content.json` são o pacote que o usuário subiu e aprovou (v2). Troque só o título, a pergunta e as alternativas. Mantenha `showScorePoints: false`, os textos em pt-BR e a versão `H5P.MultiChoice 1.16`, a menos que o upload real peça outra.

5. **Registre o que descobrir.** Ao fim de cada fase, atualize a seção 2 e o "Andamento" do plano.

6. **Teste antes de entregar.** Siga as seções 4 e 5 do plano. Leitor com o HTML real da FIC, zip conferido com `python -I -m zipfile -t`, e **um upload real no H5P.com** feito pelo usuário. Só o upload real prova que o pacote é aceito.

7. **Entregue como nas outras funcionalidades.** Diga ao usuário o que mudou, o que foi testado e como (simulação, Node ou H5P.com real) e o que ainda depende dele. Commit e versão só se ele pedir; nesse caso, um commit da funcionalidade e outro "Sobe versão para X".

## Por que o plano é assim

- **O nome do quiz é a ligação com o Canvas.** O botão H5P do editor (PLANO-H5P.md) acha o quiz pelo título da página. O conversor tem que gerar exatamente "Tópico N – …", e a prévia mostra esse título.
- **Prévia antes de gerar:** a pessoa confere o que foi lido. Questão sem alternativa certa ou com fórmula que não vai aparecer vira aviso, não um quiz errado no H5P.com.
- **Gerar `.h5p`, não preencher o editor do H5P:** o editor visual é um formulário em iframes, e automatizá-lo quebra a cada atualização. O formato do arquivo é estável.
- **Seguir o estilo do código ao redor:** JS puro, sem build e sem dependências (o zip é escrito à mão). Código em arquivo próprio, não no `popup.js`. Comentários curtos e em português.
