# Service Timer

Extensão Chrome (Manifest V3) para controle de tempo por tipo de serviço, com ferramentas de produtividade para edição de conteúdo em plataformas LMS e rich text editors.

Funciona como **painel lateral** (Side Panel), ficando sempre visível enquanto você trabalha nas abas.

---

## Cronômetro

- Inicia, pausa, retoma e finaliza o tempo de cada atendimento
- Exibe o estado no ícone da extensão: 🟢 rodando · 🟠 pausado · 🔴 inativo
- Pausa automática ao fechar todas as janelas do Chrome
- **Suspender card** — pausa o atendimento atual sem finalizá-lo e permite iniciar outro; o card suspenso pode ser retomado a qualquer momento; múltiplos cards podem ficar suspensos simultaneamente

---

## Registros

- Cada atendimento salva: tipo de serviço, usuário, data, horário de início/fim, duração total, pausas (com entrada e retorno), URL da aba ativa, links adicionais e comentário opcional
- Modal de resumo exibido ao finalizar
- Histórico completo acessível via **Ver todos**, com opção de deletar registros individuais
- Últimos 3 registros visíveis direto na tela principal
- Cards marcados como **suspensos** ficam identificados com tag no detalhe do registro

---

## Tipos de serviço

- Lista editável: adicionar, remover e reordenar com setas
- O tipo pode ser alterado durante o atendimento em andamento

---

## Links

- A URL da aba ativa é capturada automaticamente ao iniciar
- Links extras podem ser adicionados durante o atendimento
- **Links salvos** — favoritos com rótulo, acessíveis em qualquer momento; clique para abrir em nova aba
- **Starters** — links marcados com ⭐ que abrem todos juntos com o botão "Abrir links do dia"

---

## Integração com Google Sheets

### Ativar

Use o **toggle Google Sheets** na tela principal para habilitar a seção. Quando ativado:

- Se a URL do Web App ainda não estiver configurada, aparece um campo para digitá-la e salvá-la diretamente na tela principal
- Se a URL já estiver configurada, aparece o botão **📊 Enviar ao Google Sheets**

### Como funciona

Ao enviar, os registros pendentes são enviados para o Google Apps Script, que:

1. Busca ou cria automaticamente uma aba chamada **"Service Timer"** na planilha
2. Cria cabeçalhos com fundo verde e linha congelada na primeira execução
3. Adiciona cada registro como uma nova linha, evitando duplicatas pelo ID

| Coluna | Conteúdo |
|---|---|
| ID | Identificador único do registro |
| Usuário | Nome configurado na extensão |
| Tipo de Serviço | Tipo selecionado no cronômetro |
| Data | Data do atendimento |
| Início | Horário de início |
| Fim | Horário de término |
| Duração | Tempo total formatado |
| Duração (s) | Duração em segundos |
| Pausas | Lista de pausas com entrada → retorno |
| URLs | URL principal + links adicionais |
| Comentário | Comentário inserido ao finalizar |
| Suspenso | Indica se o card foi suspenso |

### Configuração do Apps Script

1. Abra a planilha desejada no Google Sheets
2. Clique em **Extensões › Apps Script**
3. Apague o código existente e cole o script disponível em **Configurações → Ver script do Apps Script**
4. Salve e clique em **Implantar › Nova implantação**
5. Tipo: **App da Web** | Acesso: **Qualquer pessoa**
6. Copie a URL gerada e cole em Configurações ou diretamente na tela principal

---

## Ferramentas de menu de contexto

Disponíveis com **botão direito** em qualquer página:

### Sobre texto selecionado

| Opção | Descrição |
|---|---|
| 🔠 Copiar em CAIXA ALTA | Copia o texto selecionado convertido para maiúsculas, mantendo formatações básicas |
| 🧹 Copiar texto limpo | Copia o texto removendo atributos e estilos desnecessários, mantendo negrito, itálico e listas |
| ✨ Copia Inteligente | Cópia avançada para colar em editores rich text (Canvas, TinyMCE, CKEditor, Moodle, Bubble.io) |
| 🖼 Criar capa de vídeo com o texto | Abre o editor de capa 1920×1080 com o texto selecionado na moldura do template escolhido; editar o texto, trocar o template e baixar o PNG ou copiar a imagem |

#### Capas de vídeo — templates

Os templates ficam em `thumb-templates.js`, com as imagens de fundo (sem texto) em `thumbs/`. Para criar outro, ponha a imagem 1920×1080 em `thumbs/` e acrescente uma entrada com a área do texto (`box`, em pixels da imagem), a fonte, a cor e o tamanho máximo da letra. A fonte dos títulos é a Alegreya Sans Bold (SIL OFL, em `thumbs/fonts/`).

#### Copia Inteligente — detalhes

Produz um HTML minimalista e limpo, ideal para colar diretamente em editores sem deixar lixo de código:

- **Corrige mojibake** automaticamente: `JoÃ£o` → `João`, `InformaÃ§Ã£o` → `Informação`
- Remove completamente `class`, `id`, `style`, `data-*` e qualquer atributo desnecessário
- Força a cor padrão `#333333` em todos os parágrafos e listas
- Converte listas numeradas `<ol>` em listas com bullets `<ul>`
- Remove elementos ocultos, scripts, estilos, iframes, formulários e tags vazias
- Mantém apenas as formatações essenciais: `<p>` `<br>` `<strong>` `<b>` `<em>` `<i>` `<ul>` `<li>`
- Normaliza espaços especiais (`&nbsp;`, zero-width spaces)
- Exibe toast de confirmação azul ao copiar

HTML gerado ao colar e visualizar o código no editor:

```html
<p style="color:#333333;">Texto com <strong>negrito</strong> e <em>itálico</em>.</p>

<ul style="color:#333333;">
<li>Primeiro item</li>
<li>Segundo item</li>
</ul>
```

### Sobre imagens

| Opção | Descrição |
|---|---|
| 🔢 Converter fórmula para LaTeX | Envia a imagem para a API OpenRouter/OpenAI e copia o LaTeX resultante |
| ⭕ Baixar imagem redonda | Abre um editor para posicionar e dimensionar o círculo sobre a imagem (arrastar, roda do mouse, setas) e baixa o recorte em PNG 200×200 px |

### Sobre a página

| Opção | Descrição |
|---|---|
| 📐 Redimensionar vídeos da página | Ajusta os vídeos (YouTube, Vimeo, Canvas Studio, mídia do Canvas) às dimensões configuradas (padrão 700×442), no editor visual ou HTML; Genially, H5P e outros embeds ficam como estão |
| 📐 Redimensionar H5P (largura 100%) | Põe em 100% só o quiz H5P da caixa abaixo da faixa "Atividade de Fixação" (no Microfundamento, o logo abaixo do banner de Atividades de Fixação); os outros H5P da página ficam como estão |
| 🔍 Localizar e substituir | Abre painel flutuante para busca e substituição em campos de texto da página |
| 🔎 Procurar texto em outra aba ou arquivo (Word/HTML) | Procura o trecho selecionado (ou colado) em outra aba aberta ou num arquivo `.docx`/`.html` (ex.: o relatório da FIC) e diz se está igual, parecido ou não está, em que questão, e mostra as diferenças palavra a palavra |

#### Procurar texto — detalhes

Para conferir se o texto de um quiz (ou de qualquer página) bate com o documento de origem. Só leitura: nada muda na aba lida nem no Word. **Vem desligado:** o item só aparece no menu com a chave "Procurar texto em outra aba ou arquivo" ligada nas configurações (Canvas LMS; `findTextEnabled`, padrão `false`). O `find-text.js` mostra ou esconde o item (`contextMenus.update`, `visible`) na hora em que a chave muda, e o `open` confere a chave de novo antes de abrir o painel.

- **O trecho** vem da seleção (inclusive dentro do H5P no Canvas) ou é colado no painel. Sem seleção, o menu abre o painel vazio.
- **Onde procurar:** um arquivo (Word `.docx` ou `.html`) ou qualquer aba aberta, de todas as janelas — sem escolha guardada, vem marcada a aba aberta na outra janela (o outro monitor). A última escolha fica guardada: da próxima vez, selecionar e clicar no menu já mostra o resultado.
- **O arquivo** é lido pelo leitor do Extrator de Questões (`extrator.js`). A busca é no texto inteiro, e as questões que ele reconhece dão o "Questão N" do resultado — no relatório da FIC (HTML salvo pelo navegador), com o nome da sessão: `📄 Microfundamento_….html › Questão 11 (Custo médio ponderado do capital)`. O texto fica guardado até escolher outro arquivo. Um HTML aberto numa aba do Chrome (`file://`) só pode ser lido com "Permitir acesso aos URLs de arquivo" ligado; pelo botão "📄 Escolher arquivo…" não precisa.
- **Resultado:** ✔ IGUAL (100%), ≈ PARCIAL (a partir de 85%), ✘ DIFERENTE ou ✘ NÃO ENCONTRADO, com onde está (`📄 arquivo.docx › Questão 11`, `🗂 aba › H5P`) e o diff: vermelho riscado = só no trecho procurado; verde = está lá e falta nele. Aspas curvas, travessões, espaços, ponto final e maiúscula inicial não contam, nem o "Links para um site externo" que o Canvas põe nos links.
- **👁 Mostrar na aba** ativa a aba, rola até o trecho (inclusive dentro do iframe do H5P) e o destaca em amarelo, sem mexer no HTML; o destaque some no próximo clique.
- Páginas do Chrome e de outras extensões (ex.: a do Extrator) não podem ser lidas por extensão; aparecem desabilitadas na lista.

O motor (`text-compare.js`) é a tradução do `comparator.py` do programa Comparador de Questões (Python) e dá os mesmos percentuais (o `difflib` foi traduzido junto). Única diferença: quando o texto lido é só um pouco maior que o trecho (ex.: o iframe de um H5P), o trecho achado é recortado em vez de comparado inteiro. O `extrator.js` é gerado a partir do projeto Machine-Learning: depois de mudar o Extrator, rode `node .claude/skills/h5p-quiz/scripts/build-extrator.mjs`.

---

## Canvas LMS

Quando o painel lateral está aberto em uma aba de curso do Canvas (`/courses/XXXX/`), aparece automaticamente a seção **🎓 Canvas LMS** com o ID do curso detectado.

### Aplicar recuo nos módulos

O botão **🔧 Aplicar recuo nos módulos** percorre todos os módulos do curso via API do Canvas e aplica automaticamente a indentação:

- **`indent: 0`** — páginas cujo nome contém algum dos termos configurados em **Páginas sem recuo** (permanecem como cabeçalho do módulo)
- **`indent: 1`** — todas as demais páginas

**Exemplo prático:** configurando as exceções `Orientação do professor` e `Material complementar`, a extensão reconhece automaticamente `Unidade 1 Orientação do professor`, `Unidade 2 Orientação do professor`, etc. — a comparação é **parcial e sem diferenciação de maiúsculas**.

A função só faz chamadas PUT nos itens que precisam ser alterados, evitando chamadas desnecessárias. Ao concluir, exibe o resultado:

```
✅ 34 item(s) ajustado(s) em 5 módulo(s) · 60 total
```

> Funciona com a sessão ativa do Canvas — não requer token de API.

### Redimensionar vídeos em lote

O botão **📐 Redimensionar vídeos em lote** passa nas páginas dos módulos escolhidos do curso da aba e põe todos os vídeos (Canvas Studio, YouTube, Vimeo, mídia do Canvas) no tamanho de **Dimensões padrão dos vídeos** das Configurações. Genially, H5P e outros embeds não mudam, nem o resto da página.

1. **Ler módulos do curso** — todos os módulos com páginas já vêm marcados.
2. **Ver prévia** — mostra os vídeos que vão mudar em cada página (`Studio 620×398 → 700×442`), sem gravar nada, e avisa páginas editadas há menos de 30 minutos.
3. **Aplicar** — pede para redigitar o número do curso; se não for o da aba aberta (ou se a aba mudou de curso depois da prévia), dá um alerta e não grava.

Cada página é lida de novo na hora de gravar, e só as tags dos vídeos mudam. Entram só as Páginas dos módulos.

### Inserir vídeos do Studio

O botão **🎬 Inserir vídeos do Studio** põe as videoaulas da coleção do curso no Studio nas páginas já montadas, seguindo uma planilha. Cada vídeo entra no lugar de um parágrafo que só tem texto entre colchetes (`[videoaula]` ou outro), e o título logo acima dele recebe o texto da planilha com a mesma formatação.

1. **Ler vídeos do Studio** — abre o Studio do curso numa aba, lê a coleção inteira (todas as páginas da lista) e volta. Fica guardado em `studioVideos:<curso>`.
2. **Planilha** — `Página | Título acima do vídeo | Nome do vídeo no Studio`, uma linha por vídeo, na ordem da página. `.xlsx`, `.csv` ou linhas coladas do Excel/Google Sheets. **📥 Baixar exemplo** baixa o modelo `modelos/planilha-videos-studio.xlsx`.
3. **Ler módulos do curso** — nenhum vem marcado; as páginas só são procuradas nos módulos marcados.
4. **Ver prévia** e **Aplicar** (redigitando o número do curso).

A página não é gravada se o nome for ambíguo, se um vídeo não estiver na coleção, se houver mais vídeos que espaços ou se faltar o título acima de um espaço. Regra em `video-slots.js`; leitura do Studio em `studio-hook.js` (mundo MAIN, pede as páginas seguintes da lista com os cabeçalhos da própria SPA) e `studio-capture.js`; `.xlsx` lido por `xlsx-read.js`.

### Pasta H5P

O botão **📁 Pasta H5P**, na página de Módulos ao lado do **+ Módulo**, prepara a UDA no H5P.com, em até três passos escolhidos na confirmação. Ele só aparece com a chave **Botão "📁 Pasta H5P"** ligada nas configurações (`h5pFolderEnabled`, padrão desligado; vale na hora, sem recarregar).

O destino é a chave **Salvar na pasta da equipe (produção)** (`h5pFolderTeam`, padrão desligado, lida a cada clique). Desligada (teste): raiz do *My Content*, pasta privada (POST `/content`, `type=1`). Ligada: dentro de *PRODUÇÕES › UDA - UNIDADE DIGITAL DE APRENDIZAGEM* (`H5P_FOLDER.TEAM`, `/content/1293047322003249328`), onde nada pode ser apagado — `createInTeam` confere o título da página e a lista dela, e envia o formulário que o botão **New Folder** da própria tela abre (pasta comum ou `/organization-folders`), com `parent` igual à pasta da equipe; se algo não bater, nada é enviado. Na confirmação do modo equipe, as pastas de lá são lidas antes (`h5p-list` com `team`): nome igual usa a existente; mesmo nome com outro prefixo de sigla ("UDA - ", "MF - "…) segura o **Criar** até a pessoa escolher a existente ou "criar outra mesmo assim". O nome nunca ganha prefixo sozinho. Em nenhum modo a extensão apaga ou altera o que já existe no H5P.com: só lê e cria.

1. **Pasta** com o nome da disciplina (editável).
2. **1 quiz por tópico** — um Multiple Choice para cada página marcada na confirmação, com o título exato da página e "Toolbar Below Content" desmarcado. A lista traz todas as páginas dos módulos (`modulePages`). Vêm marcadas as que já têm o H5P ou o marcador da AVA no lugar do quiz (`slotState` em `h5p-insert.js`, pela leitura do selo H5P, `__svcH5pMarks.pages()`, ou lendo `/pages?include[]=body`), com o selo "H5P"/"marcador" na lista. Se nenhuma tiver, ou se não der para ler, vêm marcadas as de tópico. As outras páginas aparecem com "Mostrar as outras páginas dos módulos". Quizzes, `.h5p` e inserção valem só para as marcadas, na ordem dos módulos. Com os `.h5p` lidos (`h5p-package.js` › `read`), cada página marcada tem uma lista para trocar a questão à mão; marcar ou desmarcar refaz a ligação automática (`match`, só entre as marcadas). Questão sem página vai para "Fora", e a mesma questão em duas páginas segura o **Criar**. Um por vez, com pausa entre eles. A questão vem dos `.h5p` escolhidos na confirmação (gerados pelo Extrator de Questões a partir do Word: um por questão, o `.zip` com todos ou um Question Set), ligados pelo "Tópico N" do título ou do nome do arquivo, com as configurações do arquivo; sem arquivo, vai provisória. Só Múltipla escolha 1.16 sem mídia; o conteúdo (`content.json`) vai pelo mesmo formulário de criação (`h5p-package.js`). Quiz que já existe não muda.
3. **Inserir nas páginas** — cada quiz vai para a caixa abaixo da faixa "Atividade de Fixação" da sua página. Prévia por página (dá para desmarcar e testar numa só) e número do curso redigitado antes de gravar; cada página é lida de novo e conferida depois.

**Microfundamento** (modelo antigo): o botão vira **📁 Pasta H5P MF**.
- **Tipo da disciplina:** vem das páginas dos módulos. Só "UNIDADE N - Tema N - …" é Microfundamento; só "Tópico N" é comum. Se as páginas não decidirem (nenhuma, ou dos dois tipos), vale o nome do curso: "Microfundamento: …", "MF - …" ou "(MF) …".
- Ao abrir Módulos, o tipo sai dos títulos que a página já mostra. No clique, a lista da API confirma, e o botão muda de nome se precisar. As páginas do outro tipo ficam de fora, com aviso.
- **Tópicos:** as páginas "UNIDADE N - Tema N - …" (podem passar de 6). A "Síntese e referências" fica de fora.
- **Lugar do quiz:** não há a faixa; é o parágrafo logo abaixo da imagem `banner-atividades-fixacao`. Se ali não houver H5P nem parágrafo vazio (por exemplo, vem o "Voltar ao topo"), entra um parágrafo novo, centralizado, logo depois do banner.
- **Produção:** com "Salvar na pasta da equipe" ligado, a pasta vai para *PRODUÇÕES › GRADUAÇÃO EAD* (`/content/1293047321834512708`, `TEAMS.micro` em `h5p-folder.js`), e não para a da UDA. As conferências e o formulário do "New Folder" são os mesmos (gravação de 20/11/2026). As pastas de lá se chamam "Microfundamento: <disciplina>". O aviso de nome parecido reconhece esse prefixo. Desligado, vai para o *My Content*, como na comum.
- O lugar vem sempre da própria página: se ela tiver a faixa, vale a faixa, e a prévia avisa quando o lugar é o do outro tipo. Vale também para o botão H5P do editor e o Redimensionar H5P (`quizBox` em `h5p-width.js`).
- **`.h5p` do Extrator:** do relatório da FIC, o Extrator gera "Questão 1.h5p", "Questão 2.h5p"… (título "Questão N"), numeradas pela página da sessão (a sessão retirada não conta). No Pasta H5P MF, a "Questão N" vai para a **N-ª página marcada na confirmação, na ordem dos módulos** (`h5p-package.js`, `kind 'micro'`; página sem questão na FIC é desmarcada e as seguintes andam uma casa), e a lista da confirmação mostra o par com o começo da pergunta, para conferir antes de criar. Conferido em 20/11/2026 com o zip real do "Inovação na Concepção de Negócios": as 11 questões caíram nas 11 páginas certas. Fica de fora: sem "Questão N", número além das páginas e duas para a mesma página.

Nada é duplicado nem apagado. O H5P.com não tem API: o `background.js` usa a sessão aberta no Chrome e os mesmos formulários da tela (`h5p-folder.js`; o formulário de criação de quiz é lido no documento offscreen, `offscreen.js`). A regra da caixa é a do botão H5P do editor (`h5p-width.js`), e a inserção em `h5p-insert.js`. Regressão: `.claude/skills/h5p-quiz/scripts/test-h5p-folder.js`.

> **Manifest:** o Chrome injeta cada arquivo uma vez só por página, mesmo que ele esteja em duas entradas de `content_scripts` (de mundos diferentes). Por isso o `h5p-width.js` vai no mundo isolado só fora de `/pages/*` (Pasta H5P) e no MAIN só em `/pages/*` (botão H5P do editor). Na v3.15–3.19 as duas entradas valiam para as mesmas páginas, e o botão parava em "reading 'quizBox'". Não repita um arquivo em duas entradas que possam valer para a mesma página. Regressão (carrega a extensão de verdade): `.claude/skills/h5p-quiz/scripts/test-manifest.js`.

### Selo H5P nos Módulos

Na página de Módulos, cada página que já tem o quiz H5P da Atividade de Fixação ganha o selo azul **H5P**, logo antes do ícone de publicado; com o mouse em cima, ele mostra o título e o número do quiz no H5P.com. Conta só o H5P que está no lugar do quiz (`quizBox` em `h5p-width.js`, a mesma regra do botão do editor e da Pasta H5P): a caixa abaixo da faixa na disciplina comum, o parágrafo abaixo do banner no Microfundamento. Os outros H5P da página não contam. Página que não deu para ler ganha o selo cinza **H5P ?**; se nem os módulos puderem ser lidos, aparece um aviso para recarregar.

Só lê, pela API do Canvas, um pedido por vez e no ritmo do `X-Rate-Limit-Remaining` (403/429 esperam e repetem): `/modules?include[]=items` (e `/modules/:id/items` do módulo grande), para ligar cada `#context_module_item_<id>` à sua página, e `/pages?include[]=body&per_page=100`. Se o Canvas não mandar o corpo na lista, lê só as páginas dos módulos, uma por uma. A leitura é feita ao abrir Módulos e leva alguns segundos (o Canvas demora a montar a lista com os corpos); a Pasta H5P pede outra depois de inserir os quizzes (`window.__svcH5pMarks.refresh()`). Os selos da última leitura de cada curso ficam guardados (`h5pMarksCache`, os 30 cursos mais recentes, só os azuis) e aparecem na hora na abertura seguinte, até a leitura nova corrigir; sem eles, um aviso discreto diz que está lendo. A pausa do limite de requisições vem antes do pedido seguinte, nunca depois do último. Chave **Selo "H5P" nas páginas dos Módulos** (`h5pMarksEnabled`, padrão **ligado**; vale na hora). Código em `canvas-h5p-marks.js`; regressão em `test-h5p-folder.js` (parte "selo H5P").

> Para descobrir como um site faz uma ação (sem API), use o **Gravador de Ações** em `C:\Users\Casa\ferramentas\gravador-acoes\` — extensão separada, fora desta pasta para não ir junto com o Service Timer; veja o README de lá.

---

## Caminho CSC

Tela **🎫** do painel (botão no topo, ao lado do 🎓) que acha o **link direto** do formulário de cada serviço do CSC (`https://csc.pucminas.br`), para abrir com um clique sem passar pela árvore. Veio da extensão **Caminho CSC** (`C:\Users\Casa\csc-links-extensao`, [raylanbf/caminho_CSC](https://github.com/raylanbf/caminho_CSC), v1.4.0), que continua separada; o README de lá explica como o link foi descoberto com o Gravador de Ações.

O link é o mesmo que o CSC monta no duplo clique da árvore (`AbreTela`): `/Chamados/viewIncidenteDireto.aspx?id=<ID do serviço>&origem=<Incidente|ChamadosGrupo>&width=1632&height=756&incidenteid=0&Userid=0` (`Incidente` = solicitante, `ChamadosGrupo` = atendente; `width`/`height` não mudam o serviço).

Só lê a tela: nenhum script do CSC faz requisição ao servidor, abre pasta da árvore, preenche ou envia formulário.

| Arquivo | Onde roda | O que faz |
|---|---|---|
| `csc-comum.js` | isolado, todos os frames, e o painel | `__svcCsc`: chave liga/desliga, `normalizar`, montagem do link, cópia, lista padrão do Acervo |
| `csc-arvore-main.js` | MAIN, `IncidenteV2.aspx` | lê os serviços já carregados no RadTreeView (`$find('ctl00_MainContent_rdTreeView')`, valor `ID;S;...`) e o botão direito num serviço |
| `csc-arvore.js` | isolado, `IncidenteV2.aspx` | junta no catálogo e mostra o menu Copiar/Abrir |
| `csc-content.js` | isolado, todos os frames, `viewIncidenteDireto.aspx` e `AberturaChamado.aspx` | salva o serviço e mostra a barrinha "Copiar link direto" |
| `csc-chamado.js` | isolado, todos os frames, `viewHistoricoChamado.aspx` | lê `hidCatalogoServicosId`, `hidDesc` e a coluna Grupo do histórico (só as linhas do serviço atual) |
| `csc-acervo.js` | isolado, todos os frames, `viewHistoricoChamado.aspx` | lembrete "📦 Enviar para o acervo": aba depois de "Atividades" quando o `hidDesc` está na lista do Acervo |
| `csc-panel.js` | painel (`view-csc`) | busca, salvos e listas de chamados |

**Lembrete do Acervo.** Chamados de alguns serviços precisam ser reencaminhados ao Acervo depois do atendimento (ex.: gravar videoaula numa atualização de disciplina). Na tela do chamado, se o caminho do serviço (`hidDesc`) contém um dos caminhos de `cscAcervoCaminhos` (comparados pelo `normalizar` do `csc-comum.js`: sem acento, maiúsculas e separadores), o `csc-acervo.js` põe a aba **📦 Enviar para o acervo** depois de "Atividades" no RadTabStrip (`#RadTabStrip .rtsUL > li.rtsLI`; a página já tem `.rtsUL { display: flex }`). A aba copia o estilo da "Atividades" e segura os próprios eventos (o Telerik trata os cliques no elemento das abas e não a conhece); clicar abre o lembrete embaixo dela. Sem as abas na página, o lembrete abre no canto. Um `MutationObserver` devolve a aba se um postback parcial redesenhar as abas. Só lembra: não encaminha nada. Padrão da lista: `CAMINHOS_ACERVO_PADRAO` (Gravar videoaula da Pós Lato Sensu); seletores conferidos no HTML real da gravação de 17/11/2026.

Dados em `chrome.storage.local`: `cscServicos` (salvos, chave `ID|origem`), `cscCatalogo` (`{ Incidente | ChamadosGrupo: { itens: { [id]: { id, nome, caminho, tipo, fonte?, grupos? } } } }`), `cscSemeado` e `cscAcervoCaminhos` (lista do Acervo; ausente = padrão, `[]` = nenhum lembrete). Os nomes são diferentes dos da extensão Caminho CSC (`servicos`, `catalogo`), e as mensagens entre os mundos usam `stCsc: 'main' | 'isolado'`, para as duas não se misturarem. Mesmo assim, com as duas ligadas, a barrinha e o menu aparecem em dobro.

O `csc-arvore-main.js` é quem bloqueia o menu do Chrome no botão direito. Por isso ele fica parado até o `csc-arvore.js` dizer `pronto` (chave ligada), e `desligado` o para de novo. A ordem de carga não importa: o MAIN manda `ola` ao carregar, e o isolado responde `pronto` se a chave estiver ligada. Chave **Caminho CSC** em ⚙ Configurações › CSC (`cscEnabled`, padrão **desligado**; vale na hora, inclusive nas abas do CSC já abertas). Regressão (carrega a extensão de verdade num CSC falso): `.claude/skills/h5p-quiz/scripts/test-csc.js`.

---

## Teste de Clipboard

Acessível em **Configurações → 🧪 Teste de Clipboard**, abre uma página com dois painéis lado a lado:

- **Esquerda** — área de colagem com fundo branco e texto `#333333`, simulando exatamente como o conteúdo aparecerá num editor real
- **Direita** — exibe em tempo real o HTML bruto que chegou no clipboard, para verificar se está limpo

Útil para validar o resultado da **Copia Inteligente** antes de colar no Canvas ou outro editor.

---

## Configurações

Acessível pelo botão **⚙** no topo do painel.

### Integrações

| Campo | Descrição |
|---|---|
| Nome do usuário | Identificação salva em cada registro |
| URL do Web App | Endpoint do Google Apps Script para envio ao Sheets |
| Chave API OpenRouter / OpenAI | Usada na conversão de fórmulas para LaTeX |

### Preferências

| Campo | Descrição |
|---|---|
| Dimensões dos vídeos | Largura × altura para o redimensionador (padrão: 700×442) |

### Canvas LMS

| Campo | Descrição |
|---|---|
| Páginas sem recuo | Lista de nomes parciais (um por linha) das páginas que não devem receber indentação ao aplicar o recuo nos módulos |

### CSC

| Campo | Descrição |
|---|---|
| Caminho CSC (link direto dos serviços) | Mostra o botão 🎫 no topo do painel e liga, no `csc.pucminas.br`, o aprendizado dos serviços, o menu do botão direito na árvore, a barrinha do formulário e o lembrete do Acervo (padrão: desligado; vale na hora) |
| Serviços que vão para o Acervo | Caminhos (um por linha, pode ser só o fim) cujo chamado ganha a aba "📦 Enviar para o acervo" (padrão: Gravar videoaula da Pós Lato Sensu; grava ao sair da caixa; vazia = nenhum lembrete) |

### Ferramentas

| Botão | Ação |
|---|---|
| 🔗 Links salvos | Gerenciar favoritos e starters |
| 📄 Ver script do Apps Script | Exibe e copia o código para configurar o Google Sheets |
| 🧪 Teste de Clipboard | Abre a página de teste em nova aba |

---

## Instalação

1. Clone ou baixe este repositório
2. Abra o Chrome e acesse `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto
5. Clique no ícone da extensão → **Abrir painel lateral**

---

## Estrutura do projeto

```
servicetime-v2/
├── manifest.json        # Manifest V3 — permissões e configuração
├── background.js        # Service Worker — ícone dinâmico, menu de contexto e uploads
├── popup.html           # Interface do painel lateral
├── popup.js             # Lógica principal
├── popup.css            # Estilos (tema escuro)
├── test-clipboard.html  # Página de teste de clipboard
├── test-clipboard.js    # Script da página de teste
└── icons/               # Ícones 16 · 32 · 48 · 128 px
```
