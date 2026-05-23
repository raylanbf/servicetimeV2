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
| ⭕ Baixar imagem redonda | Baixa a imagem recortada em círculo com 200×200 px |

### Sobre a página

| Opção | Descrição |
|---|---|
| 📐 Redimensionar vídeos da página | Ajusta iframes de vídeo às dimensões configuradas (padrão 620×398) |
| 🔍 Localizar e substituir | Abre painel flutuante para busca e substituição em campos de texto da página |

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
| Dimensões dos vídeos | Largura × altura para o redimensionador (padrão: 620×398) |

### Canvas LMS

| Campo | Descrição |
|---|---|
| Páginas sem recuo | Lista de nomes parciais (um por linha) das páginas que não devem receber indentação ao aplicar o recuo nos módulos |

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
├── content.js           # Script de conteúdo — operações de clipboard
├── popup.html           # Interface do painel lateral
├── popup.js             # Lógica principal
├── popup.css            # Estilos (tema escuro)
├── test-clipboard.html  # Página de teste de clipboard
├── test-clipboard.js    # Script da página de teste
└── icons/               # Ícones 16 · 32 · 48 · 128 px
```
