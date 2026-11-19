# Regras e armadilhas do Canvas

## Sumário
1. Como usar esta lista
2. Páginas
3. HTML: sanitização, entidades e templates
4. Módulos e itens
5. Tarefas e grupos de tarefas
6. Arquivos
7. Importação de conteúdo (content migration) e cópia de curso
8. Blueprint
9. Embeds LTI (Studio, H5P e outros)
10. Equações
11. Notas, matrículas e dados de alunos

---

## 1. Como usar esta lista

Cada regra aqui veio de um caso real, do código do Canvas (código aberto, `canvas-lms`) ou da documentação da API. Quando a regra depende da instância ou não foi conferida num Canvas real, o texto diz isso. **Antes de confiar numa regra para gravar em escala, confira na sua instância com um item só**: o Canvas muda, e cada instituição liga recursos diferentes.

O protocolo de escrita (prévia, confirmação, releitura, conferência) está em `escrita-segura.md`. Aqui ficam o **porquê** de cada cuidado e os detalhes de cada tipo de conteúdo.

---

## 2. Páginas

- **O identificador é o `url` (o slug), não o título.** `topico-1-introducao` vai na rota com `encodeURIComponent`. O título do **item do módulo** pode ser diferente do título da **página**: compare com o que a tarefa pede (o que a pessoa vê na lista de módulos ou no editor).
- **Grave só o corpo:** `PUT /pages/:url` com `{ wiki_page: { body } }`. Não mande:
  - `title`: trocar o título faz o Canvas gerar um endereço (slug) novo para a página. Versões recentes redirecionam o endereço antigo, mas não conte com isso para links colados em outras páginas;
  - `published`: muda na hora o que o aluno vê;
  - `front_page`, `editing_roles`, `notify_of_update`: configurações que ninguém pediu.
- **Não há trava de edição.** Se alguém está com a página aberta no editor e salva depois da extensão, a versão dessa pessoa (sem a mudança) vence. Por isso existe o aviso de edição recente (`updated_at` + `last_edited_by`, menos de 30 minutos).
- **O histórico é a rede de segurança.** `GET /pages/:url/revisions` lista as versões salvas; `POST /pages/:url/revisions/:id` restaura uma. Na interface: "Histórico da página". Diga isso à equipe quando entregar uma ferramenta que grava páginas.
- **A mesma página pode estar em dois módulos.** Numa operação em lote, ela entra uma vez só (deduplique por `url`).
- **Página bloqueada ou despublicada** continua editável por quem tem permissão; isso não é motivo para pular, mas a prévia pode mostrar o estado.

---

## 3. HTML: sanitização, entidades e templates

**O Canvas sanitiza o HTML ao salvar.** Tira `<script>`, atributos de evento (`onclick`…) e atributos ou propriedades de estilo fora da lista que ele aceita. O `PUT` responde 200 mesmo quando descarta parte do que foi enviado. Por isso a conferência depois de gravar roda a regra de novo sobre o corpo devolvido (`escrita-segura.md` §3.9).

**Entidades.** O corpo vem gravado com entidades: `Fixa&ccedil;&atilde;o`, `&nbsp;`, `&#39;`, `&amp;`. Duas consequências:

1. Para **entender** o texto, decodifique antes de comparar (ou use o `textContent` do `DOMParser`).
2. Para **localizar** no texto bruto, a busca precisa casar as duas formas:

   ```js
   const MARCADOR = /\[\s*iframe\s*-\s*atividade\s+de\s+fixa(?:ç|c|&ccedil;)(?:ã|a|&atilde;)o\s+h5p\s*\]/gi;
   ```

Dentro de atributos, o `&` vira `&amp;`: o `src` de um embed gravado tem `display=borderless&amp;url=…`.

**Templates institucionais** (páginas montadas a partir de um modelo da equipe):

- **Repetem ids.** O mesmo `id="faixa"` aparece duas vezes na mesma página. Use `querySelectorAll('[id="faixa"]')` e decida pela contagem; `getElementById` devolve só o primeiro, sem avisar.
- **Ache pelo texto, confirme pelo id.** O lugar do quiz numa página de tópico é "a caixa logo depois da faixa *Atividade de Fixação*". A regra que funcionou: a `div` **mais interna** cujo texto normalizado começa com `atividade de fixacao`, que tem de ser **exatamente uma**; a caixa é a próxima `div` irmã. Os ids (`questao-fixacao-banner`) só confirmam, porque páginas de outra origem têm a mesma faixa sem id.
- **Marcadores entre colchetes.** Espaços reservados como `[videoaula]` ou `[iframe - Atividade de Fixação H5P]` são parágrafos cujo texto **inteiro** está entre colchetes. Ignore o que estiver dentro de comentários HTML (`<!-- … -->`).
- **O que vem antes do alvo varia** de página para página (às vezes falta a seção de Referências). Não conte posições a partir do topo.

**Normalização para comparar nomes** (título de página, nome de quiz, nome de pasta):

```js
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')   // sem acento
  .replace(/[‐-―]/g, '-')                                             // ‐ ‑ ‒ – — ― → -
  .replace(/\s+/g, ' ').trim().toLowerCase();
```

Para **nomes de vídeo**, tire também a extensão (`.mp4`, `.mov`…) e **não use "contém"**: "Vídeo 1" não pode casar com "Vídeo 10". Nome repetido ou ausente nunca é resolvido pela extensão: ela mostra os candidatos e a pessoa escolhe.

**Links para arquivos do curso** (`/courses/:id/files/:fid/…`) apontam para o curso de origem. Copiar o HTML de uma página ou de uma descrição de tarefa para outro curso mantém o link na origem, e os alunos do destino podem não conseguir abrir. Avise quando o conteúdo copiado tiver esses links.

---

## 4. Módulos e itens

| Regra | Consequência | O que fazer |
|---|---|---|
| `?include[]=items` pode vir **sem** `items` em módulos grandes | a lista de itens parece vazia | se `items` não for lista, busque `/modules/:id/items?per_page=100` |
| `POST /modules` cria o módulo **despublicado** e ignora `published` | — | publicar é um passo separado, só se pedido |
| `PUT /modules/:id` com `published: true` publica **todos os itens** do módulo | itens que estavam escondidos aparecem para os alunos | nunca faça `PUT` em módulo existente; publique um módulo novo só se ele tiver apenas o que a extensão criou (confira a lista antes) |
| Item novo sem `position` entra **no fim** | os itens existentes não mudam de lugar | prefira sem `position`; com `position`, os de baixo descem |
| Requisito de conclusão novo num módulo **existente** | quem já tinha concluído o módulo deixa de estar concluído | requisito só em módulo novo; em módulo existente, o item entra sem requisito |
| Módulo despublicado | o aluno não vê o item por ele | avise na prévia ("esse módulo está despublicado neste curso") |
| Pré-requisitos e "concluir em ordem" | mudam o acesso do aluno | não mexa |

**Recuo (indent):** `PUT /modules/:mid/items/:iid` com `module_item[indent]`. Grave **só os itens que precisam mudar** (no caso real, 34 de 60) e mostre "✅ 34 item(s) ajustado(s) em 5 módulo(s) · 60 total".

**Item de arquivo:** `{ type: 'File', content_id, completion_requirement: { type: 'must_view' } }`.

**Item de tarefa existente no módulo:** antes de criar, confira se já há um item `type === 'Assignment'` com o mesmo `content_id` (idempotência).

---

## 5. Tarefas e grupos de tarefas

- **Grupos de tarefas têm peso (`group_weight`) e regras (`rules`: descartar a menor nota etc.).** Num curso com `apply_assignment_group_weights`, mudar um grupo muda a nota final de todos os alunos. Use sempre um grupo **que já existe** no destino (o de mesmo nome da origem ou um escolhido pela pessoa); nunca crie nem altere grupo sem pedido.
- **Para copiar uma tarefa, crie-a campo a campo** (`POST /assignments`), e não pela importação (ver §7). Campos que a Copiar Tarefas leva: `name`, `description`, `points_possible`, `grading_type`, `submission_types`, `allowed_extensions`, `allowed_attempts`, `omit_from_final_grade`, `peer_reviews`, `due_at`/`unlock_at`/`lock_at` (ou nenhuma data), `published` e `assignment_group_id`.
- **`post_to_sis` vai num `PUT` separado, depois de criar.** O Canvas pode recusar (por exemplo, exigindo data de entrega). Assim a tarefa fica criada e o relatório mostra o motivo do SIS.
- **Não se copiam campo a campo** (avise e deixe de fora): testes (`online_quiz`), fóruns avaliados (`discussion_topic`), ferramentas externas (`external_tool`, que inclui os Novos Testes), trabalhos em grupo, rubrica, datas por turma ou por aluno (overrides), avaliação moderada ou anônima.
- **Já existe tarefa com o mesmo nome no destino:** o curso vem desmarcado na conferência; a pessoa pode marcar e criar mesmo assim.
- **Datas** vão e voltam em ISO 8601 UTC. Mostre no fuso da pessoa e não "corrija" fuso sozinho.

---

## 6. Arquivos

- **Upload em 3 etapas** (`sessao-csrf-api.md` §6): a aba pede a URL de envio; o painel envia o binário; confira o arquivo criado.
- **`parent_folder_path` cria as pastas que faltarem.** Uma `/` no nome vira subpasta: troque por `-` antes (`"Unidade 1 / Introdução"` → `"Unidade 1 - Introdução"`).
- **Reaproveite a pasta que já existe** em vez de criar outra só porque o nome não bate com o do módulo. Casando por número de unidade, não confunda Unidade 1 com Unidade 10: `new RegExp(\`^unidade\\s*0*${n}(?!\\d)\`, 'i')`.
- **`on_duplicate: 'overwrite'`, com o mesmo nome e na mesma pasta, redireciona o id antigo para o novo.** Todas as páginas que usavam o arquivo passam a mostrar o novo **sem edição**. É uma troca em massa e silenciosa (nível 3): prévia por curso, lista dos arquivos que serão substituídos e confirmação.
- **`on_duplicate: 'rename'`** cria "arquivo-1.png" ao lado do antigo: as páginas continuam com o antigo.

---

## 7. Importação de conteúdo (content migration) e cópia de curso

A "Importação de conteúdo" do Canvas (cópia de curso, Commons, pacote) **casa o que chega com o que já existe** pelo `migration_id` e, em alguns casos, pelo nome, e **sobrescreve**. Visto no código do `canvas-lms`:

- **Grupos de tarefas:** o importador procura o grupo do destino pelo `migration_id` ou pelo **nome** e sobrescreve `group_weight` e `rules`, ou cria um grupo novo com o peso da origem. Nos dois casos, o cálculo das notas do destino muda.
- **Tarefas:** uma tarefa já copiada antes (mesmo `migration_id`) é **atualizada**, não duplicada; o que foi ajustado no destino se perde.
- **Seleção parcial:** `select[modules]` traz o módulo **inteiro**; `select[module_items]` traz só o conteúdo, sem o módulo.

Por isso, em curso com alunos, **não use a importação para copiar um item**: crie-o pela API, campo a campo. Importação só com pedido explícito, em curso sem alunos ou sabendo exatamente o que será sobrescrito.

Para diagnóstico, `GET /content_migrations` (mais novas primeiro) diz de qual curso veio o conteúdo (`settings.source_course_name`).

---

## 8. Blueprint

Num curso **associado** a um Blueprint (o curso-mestre):

- **Itens bloqueados** no Blueprint (conteúdo, pontos, datas, conforme a configuração) não podem ser editados no associado, nem pela interface nem pela API: a escrita é recusada.
- **Editar no associado um item desbloqueado** faz esse item deixar de receber as atualizações do Blueprint (o Canvas preserva a alteração local). A mudança "funciona", mas o curso se desliga do modelo naquele ponto.
- **O lugar certo para mudar conteúdo que vem do Blueprint é o próprio Blueprint**, seguido de uma sincronização, decidida por quem cuida dele.

Para detectar: `GET /courses/:id/blueprint_subscriptions` lista o Blueprint de um curso associado, e o JSON do curso-mestre traz `blueprint: true`. As respostas de itens num curso associado podem trazer campos como `is_master_course_child_content` e `restricted_by_master_course`. **Confira os nomes numa resposta real da sua instância** antes de depender deles, e, se o curso for associado, mostre isso na prévia.

---

## 9. Embeds LTI (Studio, H5P e outros)

**Formato que o editor grava:**

```html
<iframe class="lti-embed" title="…"
  src="/courses/<curso>/external_tools/retrieve?display=borderless&amp;url=<endereço de lançamento, codificado>"
  …></iframe>
```

- **Não há token no HTML.** O `external_tools/retrieve` faz o lançamento LTI na hora em que a página abre, assinado pelo Canvas, e casa a ferramenta pelo **domínio** da URL de lançamento. Por isso o HTML pode ser montado como texto e gravado pela API, e não é preciso saber o `external_tool_id`.
- **O curso no `src` é o da página.** Ao levar um embed de um curso para outro, troque o `/courses/<id>/`.
- **Embeds de LTI 1.3 criados pelo editor podem trazer `resource_link_lookup_uuid`.** O do H5P.com gravado sem ele funcionou no Canvas real (o quiz abre para o aluno). Para outra ferramenta, teste uma página antes do lote.
- **Reconheça o tipo pelo `src`, não por `allowfullscreen`:** Genially, H5P, apresentações e formulários também têm tela cheia. Vídeo é YouTube, Vimeo, `instructuremedia.com` (Studio), `/media_attachments_iframe` ou `/media_objects_iframe` (mídia do Canvas) e similares. **Áudio enviado ao Canvas usa o mesmo player da mídia**, marcado por `data-media-type="audio"` ou `type=audio` no `src`: não trate como vídeo.
- **No editor visual**, o TinyMCE embrulha cada iframe num `span.mce-preview-object` (ver `editor-rce.md` §6).
- `GET /courses/:id/external_tools` lista as ferramentas instaladas, se você precisar descobrir qual está disponível naquela conta.

Detalhes do Studio em `studio.md`; do H5P em `h5p.md`.

---

## 10. Equações

A equação do editor do Canvas é uma imagem gerada a partir do LaTeX:

```html
<img class="equation_image" title="\Large x^2"
  src="/equation_images/<LaTeX codificado DUAS vezes>?scale=1"
  alt="LaTeX: x^2" data-equation-content="\Large x^2" data-ignore-a11y-check="" />
```

- O `src` leva `encodeURIComponent(encodeURIComponent(latex))`. Com uma codificação só, a imagem quebra.
- Escape `& < > "` nos atributos.
- Para abrir o editor de equação no RCE, ver `editor-rce.md` §8.

---

## 11. Notas, matrículas e dados de alunos

- Leitura de entregas e notas (`/students/submissions`, `/assignments/:id/submissions`) serve para relatórios de conferência (notas faltando, zeros suspeitos, nota acima do máximo). Filtre pelos alunos **ativos** (matrículas atuais), senão quem saiu do curso entra na conta.
- **Gravar nota** (`submission[posted_grade]`), mexer em matrícula, data de entrega ou configuração do curso: só com pedido explícito, com o protocolo completo, e a confirmação diz o que não tem volta.
- Os dados de alunos não saem da máquina (ver `seguranca.md` §5).
