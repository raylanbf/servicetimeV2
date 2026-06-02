# Amostras de HTML do Canvas (PUC Minas) — base para o "mapa de elementos" (Camada 2)

Cole aqui o HTML de páginas reais (editor → botão `</>` → copiar tudo), **um arquivo por página**:

```
samples/01-home-disciplina.html
samples/02-apresentacao-professor.html
samples/03-plano-de-ensino.html
samples/04-conteudo-unidade.html
samples/05-enade-cards.html
...
```

Regra: **variedade importa mais que quantidade** — mande uma página de cada layout diferente.
(Não precisam ir para o git; podem ficar só locais.)

---

## Catálogo de blocos identificado (a partir dos primeiros exemplos)

### Dois "dialetos" de template
- **A — Cards** (ex: página ENADE): `#videogeral` › `#mod1/#mod2/#mod3` › `div.card` (`.card-body`, `.card-title`, `.card-text`) + botão "acessar".
- **B — Content-box / grid** (maioria): `div.content-box` › (`div.grid-row`) › `#geral` / `div.col-xs-… col-lg-N`, com `id`s semânticos.

### Blocos → como reconhecer → rótulo
| Bloco | Sinal no HTML | Rótulo |
|---|---|---|
| Banner (imagem) | `#banner` ou `img` com `min-width:100%` / `height≈272` | 🖼 Banner |
| Faixa de título | `#faixa` (verde `#2ba588`) ou `div` com bg-color + texto branco centralizado | 🏷 Faixa |
| Banner de texto | `div` com `font-size:3em`, fundo escuro, texto centralizado (ENADE) | 🏷 Banner de texto |
| Texto introdutório | `#texto-introdutorio` | 📝 Texto introdutório |
| Caixa do professor | `#box-curriculum` / `#caixa-nome` | 👤 Caixa do professor |
| Foto (redonda) | `img` com `border-radius:50%` | 🖼 Foto redonda |
| Card | `div.card` (img + título + botão) | 🃏 Card |
| Grade de cards | `#videogeral` com `#mod*` | ▦ Grade de cards |
| Linha / Coluna do grid | `div.grid-row` / `div[class*="col-lg-"]` | ▦ Linha / Coluna |
| Box de dados | `#box-principal` / box `#dfece7` | 📋 Box de dados |
| Seção do plano | `h4#box-objetivos` `#box-metodos` `#box-ementa` `#box-pontos` `#conteudo` | 📑 Seção |
| Box de unidade | `div` com `border:1px solid #4d4961` + header `#4d4961` "UNIDADE" | 📚 Box de unidade |
| Menu lateral | `#menu-lateral` | 📂 Menu lateral |
| Item de menu | `#sessao` / `#box-imagem-texto` | 🔗 Item de menu |
| Botão "acessar" | `a > img[alt^="button_acessar"]` | 🔘 Botão |
| Link interno | `a[data-api-returntype="Page"]` | 🔗 Link de página |
| Voltar ao topo | `a[href="#topo"]` | ⬆ Voltar ao topo |
| Separador | `hr` (border `#2ba588`) | — Separador |

### Cores institucionais (sinal secundário, quando não há id)
- `#2ba588` verde — faixa/bordas (template B)
- `#4d4961` roxo — header de box de unidade
- `#ff7f50` laranja — faixa "CONTEÚDO DA DISCIPLINA"
- `#084b8a` azul — banner de texto (ENADE)
- `#dfece7` verde-claro — box de dados do plano
- `#a2cde7` azul-claro — header do menu lateral

### Observações técnicas importantes
- **IDs duplicados**: `#sessao`, `#texto`, `#banner`, `#faixa`, `#geral` se repetem (HTML inválido mas tolerado).
  - Ao **duplicar** (Camada 1): remover `id` do clone — já é feito.
  - Ao **mapear** (Camada 2): usar `querySelectorAll('[id="x"]')`, nunca `getElementById`.
- **Blocos claramente repetíveis** (principais alvos de duplicação): `div.card`/`#mod*`, box de unidade (`#4d4961`), `#sessao` (item de menu), `div.col-*` (coluna), `#faixa`.
