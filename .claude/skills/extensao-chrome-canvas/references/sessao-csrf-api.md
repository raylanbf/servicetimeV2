# Sessão, CSRF e a API do Canvas

## Sumário
1. Por que a sessão (e não token, OAuth ou chave)
2. Onde fazer as chamadas
3. CSRF
4. Formato das respostas, paginação e IDs
5. Erros e como explicá-los
6. Upload de arquivos (3 etapas)
7. Endpoints usados nos projetos
8. GraphQL

---

## 1. Por que a sessão (e não token, OAuth ou chave)

| Caminho | Problema |
|---|---|
| Token de acesso gerado pela pessoa | É um segredo: precisa ser guardado, pode vazar, não expira se ninguém lembrar de apagar |
| OAuth2 com Developer Key | Exige que o administrador da instituição cadastre e aprove a chave |
| **Sessão do navegador** ✔ | Nenhum segredo guardado; a extensão pode exatamente o que a pessoa logada pode |

A extensão chama as mesmas rotas `/api/v1/...` que a própria interface do Canvas usa, e o navegador anexa os cookies de sessão. Para isso a pessoa precisa estar logada no Canvas naquele Chrome. Se a sessão vencer, as chamadas voltam 401: peça para recarregar a aba e entrar de novo.

**Limite honesto:** agir com a própria conta é o uso normal do sistema, mas automação em massa continua sujeita às regras da instituição. Ritmo humano e o protocolo de escrita segura não são só técnica: mostram que a ferramenta respeita o ambiente.

---

## 2. Onde fazer as chamadas

| Opção | Como | Quando |
|---|---|---|
| **A. Na aba do Canvas** (recomendado) | `executeScript` com uma função que faz `fetch` de mesma origem | quase sempre |
| B. Content script na página | `fetch` direto do script do botão injetado | botão que age na própria página (ex.: módulos) |
| C. Service worker / painel | `fetch` com `host_permissions` + `chrome.cookies` para o CSRF | só se precisar agir sem aba do Canvas aberta |

Em A e B o pedido é idêntico ao da interface (mesma origem, cookies, CSRF da página). Em C ele sai com `Origin: chrome-extension://…` e precisa da permissão `cookies`.

---

## 3. CSRF

O Canvas exige o token CSRF em toda escrita (POST, PUT, DELETE). Só o cookie de sessão não basta.

1. Leia o cookie `_csrf_token`. Ele não é HttpOnly, então `document.cookie` o enxerga.
2. Aplique `decodeURIComponent` (o valor vem codificado: `%2B` → `+`, `%3D` → `=`).
3. Envie no cabeçalho `X-CSRF-Token`.

Plano B: `<meta name="csrf-token" content="…">`, presente em algumas telas.

```js
function csrfToken() {
  const raw = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
  const val = raw ? raw.slice('_csrf_token='.length)
    : (document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
  try { return decodeURIComponent(val); } catch { return val; }
}
```

Leia o token **a cada escrita**, não uma vez no início: ele pode ser renovado durante a sessão. Sem token, ou com o token errado, o Canvas recusa, em geral com 422 e uma mensagem como "Can't verify CSRF token authenticity". Leitura (GET) não precisa de CSRF.

---

## 4. Formato das respostas, paginação e IDs

- **Peça JSON:** `Accept: application/json`.
- **Prefixo `while(1);`:** respostas JSON a pedidos autenticados por sessão podem vir com esse prefixo (proteção contra sequestro de JSON). Leia como texto e tire o prefixo antes do `JSON.parse`. `res.json()` direto às vezes funciona, às vezes quebra.
- **Paginação pelo cabeçalho `Link`:** `<https://…?page=2&per_page=100>; rel="next"`. Siga o `next` até ele sumir. Use `per_page=100` (o máximo comum). Ponha um teto (ex.: 50 páginas) e, se passar dele, **pare com erro**: decidir sobre uma lista cortada é pior do que não decidir.
- **`include[]=items` nos módulos:** em módulos grandes o Canvas omite `items`. Se `items` não vier como lista, busque `/modules/:id/items?per_page=100`.
- **IDs como texto.** Números com mais de 15 ou 16 dígitos perdem precisão no JavaScript (os do H5P.com têm 19). Compare sempre `String(a) === String(b)`.
- **Slug de página:** `page_url` (ex.: `topico-1-introducao`) vai na URL com `encodeURIComponent`.
- **Datas** chegam em ISO 8601 UTC (`updated_at`). Para "editada há X minutos": `(Date.now() - new Date(updated_at)) / 60000`.

---

## 5. Erros e como explicá-los

| Status | Significado comum | Mensagem para quem usa |
|---|---|---|
| 401 | sessão vencida ou sem permissão | "A sessão do Canvas pode ter expirado: recarregue a aba e entre de novo." |
| 403 + corpo "Rate Limit Exceeded" | balde vazio (ver `rate-limit.md`) | espere e repita; não é falta de permissão |
| 403 (outro corpo) | sem permissão naquele curso ou item | "Sem permissão para isso neste curso." |
| 404 | não existe (ou não é visível para essa pessoa) | "Não encontrado." Diga o quê. |
| 422 | dado recusado (validação) ou CSRF | mostre `errors` do corpo |
| 5xx | falha do servidor | leitura: repita uma ou duas vezes; escrita: releia antes de repetir |

O corpo de erro do Canvas varia: `{ errors: [{ message }] }`, `{ errors: { campo: [{ message }] } }` ou `{ message }`. O `errorText()` do modelo cobre os três. Corte a mensagem (~200 caracteres) e diga sempre **o que estava sendo feito** ("HTTP 404 ao ler a página 'topico-2'").

---

## 6. Upload de arquivos (3 etapas)

1. **Pedir a URL de envio, na aba (sessão + CSRF):** `POST /api/v1/courses/:id/files` com `name`, `size`, `content_type`, `parent_folder_id` ou `parent_folder_path` e, se for o caso, `on_duplicate` (`overwrite` ou `rename`). A resposta traz `upload_url` e `upload_params`.
2. **Enviar o binário, do painel** (o `File` não passa por `executeScript`): `POST upload_url` com `multipart/form-data`, primeiro todos os `upload_params` e **por último** o campo `file`. A `upload_url` é de outro domínio (o armazenamento do Canvas) e não leva CSRF.
3. **Confirmar:** a resposta traz o arquivo criado ou um redirecionamento de confirmação, que precisa ser seguido com a sessão. Confira se o arquivo existe antes de dizer que deu certo.

**Truque do `overwrite`:** subir um arquivo com o **mesmo nome**, na **mesma pasta**, com `on_duplicate: 'overwrite'` faz o Canvas redirecionar o id antigo para o novo. As páginas que usavam o arquivo passam a mostrar o novo **sem edição**. Foi assim que a troca de banner de dezenas de cursos ficou sem nenhuma edição de página. É uma troca em massa e silenciosa: trate como escrita de nível 3 (prévia por curso, confirmação).

---

## 7. Endpoints usados nos projetos

Todos relativos a `/api/v1`. Escrita = exige CSRF e passa pelo protocolo.

| Para quê | Método e rota | Observação |
|---|---|---|
| Curso (nome, etc.) | `GET /courses/:id` | |
| Usuário logado | `GET /users/self` | |
| Módulos com itens | `GET /courses/:id/modules?include[]=items&per_page=100` | itens podem faltar (ver §4) |
| Itens de um módulo | `GET /courses/:id/modules/:mid/items?per_page=100` | |
| Recuo / posição de item | `PUT /courses/:id/modules/:mid/items/:iid` (`module_item[indent]`, `[position]`) | escrita |
| Criar módulo | `POST /courses/:id/modules` | nasce despublicado |
| Item no módulo | `POST /courses/:id/modules/:mid/items` | entra no fim por padrão |
| Página | `GET /courses/:id/pages/:url` | traz `body`, `updated_at`, `last_edited_by` |
| Gravar página | `PUT /courses/:id/pages/:url` com `{ wiki_page: { body } }` | escrita; devolve o corpo salvo |
| Criar página | `POST /courses/:id/pages` com `wiki_page[title]`, `[body]` | escrita |
| Histórico de uma página | `GET /courses/:id/pages/:url/revisions` | restaurar versão antiga |
| Tarefas | `GET /courses/:id/assignments` | |
| Criar tarefa | `POST /courses/:id/assignments` | `post_to_sis` em PUT separado |
| Grupos de tarefas | `GET /courses/:id/assignment_groups` | pesos e regras |
| Pastas e arquivos | `GET /courses/:id/folders`, `GET /folders/:id/files` | |
| Upload | `POST /courses/:id/files` | 3 etapas (§6) |
| Importações do curso | `GET /courses/:id/content_migrations` | mais novas primeiro; `settings.source_course_name` |
| Ferramentas LTI | `GET /courses/:id/external_tools` | descobrir o id do Studio/H5P naquela conta |
| Boletim, notas | `GET /courses/:id/students/submissions`, `…/assignments/:aid/submissions` | só leitura, salvo pedido explícito |

O histórico de revisões (`/revisions`) é a rede de segurança das páginas: o Canvas guarda cada versão salva. Em caso de estrago, a versão anterior pode ser restaurada pelo histórico da página, na interface, ou pela API.

---

## 8. GraphQL

`POST /api/graphql` (com CSRF) busca dados ligados numa consulta só, o que economiza pedidos em painéis de leitura. Os projetos de referência não precisaram dele. Use se a REST exigir dezenas de chamadas para montar uma tela, mantendo o mesmo ritmo e o mesmo tratamento de erro.
