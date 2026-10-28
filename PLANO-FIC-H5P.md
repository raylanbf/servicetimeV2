# Plano — Conversor FIC → H5P (quizzes de fixação)

> **Status:** aguardando a FIC ter as questões de fixação. O usuário vai mostrar como elas ficam na FIC (out/2026).
> **Para retomar:** no Claude Code, digite `/fic-h5p` (ou diga "vamos implementar o conversor FIC → H5P").
> **Relacionado:** [PLANO-H5P.md](PLANO-H5P.md) (o botão que insere o quiz na página do Canvas, já pronto).

## Andamento

- [x] Formato `.h5p` validado no H5P.com da PUC (27/10/2026) — seção 2.1. Modelo guardado em `.claude/skills/fic-h5p/modelo/`.
- [ ] Pré-requisitos — seção 3 (HTML da FIC com as questões). Em aberto também: tabela na questão (seção 2.3).
- [ ] Fase 1 — leitor da FIC
- [ ] Fase 2 — gerador dos `.h5p` + tela no painel
- [ ] Fase 3 — envio automático ao H5P.com (opcional)

---

## 1. Objetivo

Hoje cada quiz de fixação é digitado à mão no H5P.com. O conversor faz isso a partir da FIC:

1. a pessoa abre a UDA na FIC (ou baixa o HTML dela) e manda para o conversor no painel da extensão;
2. o painel mostra uma **prévia** dos tópicos (normalmente 6) — título, pergunta, alternativas, qual é a certa e o feedback de cada uma — com avisos do que não bate;
3. um clique gera **um arquivo `.h5p` por tópico**, numa pasta com o nome da UDA em Downloads;
4. a pessoa sobe os arquivos no H5P.com (Add Content › Upload) — ou, na Fase 3, a extensão sobe sozinha;
5. depois, na página de cada tópico no Canvas, o botão **H5P** do editor (PLANO-H5P.md) acha o quiz pelo nome e o insere.

Tudo roda no navegador: sem servidor, sem IA, sem dependências.

## 2. O que já sabemos

### 2.1 Formato `.h5p` validado (27/10/2026)

Teste no `pucminasvirtual.h5p.com` com dois arquivos gerados (`teste-quiz-multichoice.h5p` e `-v2`): **Add Content › Upload › Upload a file** aceitou, e o editor abriu preenchido.

- O pacote leva **só o conteúdo** — um zip com `h5p.json` na raiz e `content/content.json` — **sem as pastas das bibliotecas**, que o H5P.com já tem instaladas.
- Tipo: **H5P.MultiChoice 1.16** (versão atual no repositório oficial `h5p/h5p-multi-choice`, 1.16.27). `preloadedDependencies` = a principal + as dependências diretas do `library.json` oficial: `FontAwesome 4.5`, `H5P.JoubelUI 1.3`, `H5P.Question 1.5`.
- `h5p.json`: `title` (vira o nome do quiz no H5P.com), `language` e `defaultLanguage` = `pt-br`, `mainLibrary`, `embedTypes: ["iframe"]`, `license: "U"`.
- `content.json`: os padrões do `semantics.json` oficial com os textos da tradução **pt-BR** oficial (`language/pt-br.json`: "Verificar", "Enviar", "Mostrar solução", "Tentar Novamente"…). Um grupo com um único campo é gravado direto como o valor (`overallFeedback: [{from: 0, to: 100}]`).
- **Modelo aprovado pelo usuário:** `.claude/skills/fic-h5p/modelo/h5p.json` e `content.json` (a v2). O gerador parte dele e só troca título, pergunta e alternativas.

### 2.2 Regras do usuário para os quizzes (27/10/2026)

- **Sempre Multiple Choice.** Com uma alternativa certa, ele mostra escolha única (bolinhas). *Em aberto:* existe questão com mais de uma certa? Se não, travar em `behaviour.type: "single"` e acusar na prévia questão com 0 ou 2+ certas.
- A alternativa certa marcada (`correct: true`).
- **Feedback em cada alternativa:** é a "mensagem exibida se a resposta for selecionada" → `tipsAndFeedback.chosenFeedback`.
- **`behaviour.showScorePoints: false`** — é questão de fixação, sem nota. O resto do `behaviour` fica nos padrões: `enableRetry`, `enableSolutionsButton`, `enableCheckButton` e `randomAnswers` ligados; `singlePoint`, `autoCheck` e os diálogos de confirmação desligados; `passPercentage` 100.
- Textos da interface ("Text overrides and translations") **sempre em português brasileiro**.
- **"Toolbar Below Content" desmarcado** (senão o aluno vê as opções de reutilizar o conteúdo). Isso **não cabe no `.h5p`**: é uma opção de exibição que o H5P.com guarda junto com o conteúdo ao salvar. Desmarcar à mão antes do Save, ou deixar para a Fase 3.
- Mesmo sem os pontos por alternativa, depois de "Verificar" o Multiple Choice mostra a barra "Você conseguiu X de Y pontos possíveis". Até onde se sabe, ela não tem opção para esconder.

### 2.3 Limites do Multiple Choice (semantics.json oficial)

- **Pergunta:** HTML só com `strong em sub sup h2 h3 pre code` (parágrafos `<p>`). **Alternativas:** `strong em sub sup code`. **Feedback:** `strong em sub sup a code`. **Não aceitam `<img>`**: o H5P remove ao validar.
- Imagem só pelo campo **mídia** (`media.type`): **uma**, acima da pergunta (`H5P.Image 1.1`). Ela vai como arquivo dentro do pacote (`content/images/…`) e é referenciada em `params.file.path`.
- Fórmula como texto: LaTeX entre `\( … \)` — **só funciona se o H5P.com da PUC tiver o MathDisplay ligado. Não testado.**
- **Tabela não cabe no Multiple Choice** (27/10/2026). A lista de tags é regra do tipo de conteúdo, aplicada pelo H5P ao colar no editor e ao salvar. Por isso nem um botão de "inserir HTML" nem o `.h5p` conseguem pôr uma tabela na pergunta. **Opção conferida nos arquivos oficiais:** o tipo **H5P.Column 1.22**, que aceita **H5P.Table 1.2** (tags `strong em del a table code`, com linhas e colunas pelo editor) e **H5P.MultiChoice 1.16**. Questão com tabela = Column [Table em cima, Multiple Choice embaixo]. É acessível (tabela de verdade, e não imagem) e o botão de inserir acha pelo título do mesmo jeito. No pacote, cada item do Column é um subconteúdo com `library` ("H5P.Table 1.2"), `params`, `subContentId` (uuid) e `metadata`. **Teste manual do usuário (28/10/2026): "parece que não deu"** — os detalhes não ficaram registrados (se o tipo Column não aparece no H5P.com da PUC, ou se o resultado não ficou bom). Ao retomar, perguntar o que aconteceu antes de gerar Column. Por ora, **tabela na questão continua sem solução**: a prévia do conversor deve avisar "questão com tabela — não cabe no Multiple Choice".

### 2.4 FIC (do que já foi investigado — ver a memória do projeto)

- A FIC (`conteudo.virtual.pucminas.br/fic/…`) usa **Quill + KaTeX**. A fórmula digitada na FIC fica num blot com `data-latex`; a **colada do Word vira PNG base64** (`<img src="data:image/png;base64,…">`, sem alt), e o LaTeX se perde.
- O relatório da UDA fica em `/fic/relatorio-uda/<id>`. As questões de fixação ainda não estão na FIC: o formato é desconhecido.
- A extensão UDA (`C:\Users\Casa\ava\UDA`) importa os tópicos da FIC para o Canvas, mas **não lê questões de fixação** hoje.

### 2.5 Ligação com o botão de inserir

O nome do quiz tem que ser **igual ao título da página do tópico no Canvas** ("Tópico N – …"). O botão compara ignorando acentos, maiúsculas, espaços extras e tipo de traço (hífen = travessão), e busca só em "My Content". A prévia do conversor deve mostrar o título exatamente como vai ficar no H5P.com.

## 3. O que o usuário vai trazer

- [ ] **HTML da FIC** de uma UDA com as questões de fixação, salvo em `C:\Users\Casa\Downloads` (de preferência um que tenha fórmula numa questão).
- [ ] **Respostas:**
  - É sempre uma alternativa certa? Quantas alternativas, em geral?
  - O feedback existe para cada alternativa ou só para a certa?
  - O título de cada tópico na FIC é igual ao título da página no Canvas?
  - As questões podem ter fórmula ou imagem?
- [ ] *(Se houver fórmulas)* Testar se o H5P.com mostra LaTeX: criar à mão um quiz com `\( x^2 + 1 \)` na pergunta e ver se aparece formatado.

## 4. Fase 1 — Leitor da FIC

1. **Entrada:** o arquivo `.html` (campo de arquivo no painel) **ou** a aba aberta da FIC (`chrome.scripting.executeScript` na aba de `conteudo.virtual.pucminas.br/fic/…`; o `<all_urls>` já dá permissão). O usuário propôs o arquivo; ler a aba economiza um passo. Oferecer os dois.
2. **Saída:** `{ uda, topicos: [{ numero, titulo, pergunta, alternativas: [{ html, correta, feedback }] }] }`.
3. **Seletores:** sair do HTML real (seção 3). **Não inventar** antes de ver a FIC com as questões.
4. **Limpeza do HTML** para caber nas tags do Multiple Choice (seção 2.3): tirar classes e spans do Quill, manter `strong em sub sup`, `<p>` na pergunta. Blot de fórmula com `data-latex` → `\( latex \)`, se o LaTeX funcionar no H5P.com; senão, avisar na prévia. `<img>` dentro do texto → aviso (não passa); imagem que for "a" imagem da questão → campo mídia.
5. **Validação** (vira aviso na prévia, por tópico): título no padrão "Tópico N – …"; pelo menos 2 alternativas; exatamente 1 certa (se for a regra); feedback presente; nada que o H5P vá remover (imagem, tabela).
6. **Teste:** script Node com o HTML real da FIC, conferindo a saída tópico a tópico.

## 5. Fase 2 — Gerador e tela no painel

**Tela:** "🧩 Converter FIC → H5P" no painel (🎓 Canvas, seção de edição em escala, ou uma seção H5P própria). Passos: escolher o arquivo ou "Ler da aba da FIC" → prévia (cartão por tópico, com avisos em laranja) → **Gerar arquivos .h5p**.

**Gerador** (arquivo próprio, ex.: `fic-h5p.js`, carregado pelo `popup.html` — não crescer o `popup.js`):

- `content.json` a partir do modelo (seção 2.1), trocando `question` e `answers` (`text`, `correct`, `tipsAndFeedback.chosenFeedback`). UI em pt-BR e `behaviour` fixos no código, iguais ao modelo.
- `h5p.json` com `title` = título do tópico.
- **ZIP sem dependência:** escritor mínimo em JS, com cabeçalhos local e central e CRC32, no modo STORE (sem compressão) — os arquivos são pequenos —, ou `CompressionStream('deflate-raw')`. Conferir o zip gerado com `python -I -m zipfile -t` e com um upload real.
- **Download:** `chrome.downloads.download` (a permissão já existe) com `filename: "<UDA>/Tópico N – ….h5p"`, tirando os caracteres proibidos no Windows (`\ / : * ? " < > |`).
- A **versão do Multiple Choice** fica numa constante: se um dia o upload falhar com "Missing required library H5P.MultiChoice 1.16", é só trocar.

**Testes:**

- Node: leitor (HTML real) + gerador (JSON igual ao modelo; zip válido);
- simulação do painel (o mesmo esquema do `test-quiz.js`);
- um upload manual no H5P.com e a conferência do quiz (pergunta, alternativas, feedback, sem pontos, pt-BR).

## 6. Fase 3 — Envio automático ao H5P.com (opcional)

No site `pucminasvirtual.h5p.com` (não no popup do LTI), um content script:

1. cria a pasta "UDA – <nome>" se não existir (botão "New Folder");
2. para cada tópico: **antes**, busca o título em "My Content" (`?search=…&content_scope=mine`, ver PLANO-H5P.md 2.1) e **pula** o que já existe (rodar duas vezes não duplica);
3. Add Content › **Upload** › põe o arquivo no `input[type=file]` (via `DataTransfer`) › espera o editor carregar › **desmarca "Toolbar Below Content"** › aba **Folder** › escolhe a pasta › **Save**;
4. relatório no painel: criado / já existia / erro.

Precisa de um diagnóstico da tela de criação antes (os seletores do Upload, das Display Options e da aba Folder), como na Fase 1 do PLANO-H5P. Risco: a tela do H5P.com mudar.

## 7. Decisões (mudar só se o usuário pedir)

- **Na extensão Service Timer, em arquivos próprios** — não numa extensão separada. O nome do quiz é a ligação com o botão de inserir, e o conhecimento do H5P.com já está aqui (decisão de 27/10/2026).
- **Gerar `.h5p`, não automatizar o editor visual do H5P** (formulário em iframes com editor rico em cada campo: quebra a cada atualização).
- **Sempre Multiple Choice**, uma pergunta por tópico, com as regras da seção 2.2.
- **Prévia antes de gerar:** nada é gerado sem a pessoa ver o que foi lido.

## 8. Riscos e como lidar

| Risco | Como lidar |
|---|---|
| Formato da FIC mudar | Leitor por âncoras de texto, validação na prévia, teste com o HTML real |
| Questão com tabela | Sem solução por enquanto: o teste manual com Column [Table + Multiple Choice] não deu certo (seção 2.3). A prévia avisa, e a questão é ajustada na FIC |
| Fórmula como imagem (colada do Word) | Não passa no texto do Multiple Choice: aviso na prévia; corrigir na FIC ou usar o campo mídia (uma imagem por questão) |
| H5P.com sem LaTeX | Testar antes (seção 3); sem ele, fórmula só como texto simples ou imagem no campo mídia |
| Versão do Multiple Choice mudar no H5P.com | Constante única no gerador; a mensagem de erro do upload diz a versão que falta |
| Título da FIC diferente do título da página no Canvas | Prévia mostra o título final; o botão de inserir já normaliza traço, acento e espaço |
| Esquecer de desmarcar "Toolbar Below Content" no upload manual | Lembrete na tela do conversor; a Fase 3 resolve |
