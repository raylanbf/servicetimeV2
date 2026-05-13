# Service Timer

Extensão Chrome para controle de tempo de atendimento por tipo de serviço, com integração ao Google Sheets.

## Funcionalidades

- **Cronômetro por serviço** — inicia, pausa e finaliza o tempo de cada atendimento
- **Tipos de serviço configuráveis** — lista editável com reordenação e remoção
- **Captura de URL automática** — registra a página ativa ao iniciar o serviço
- **Links adicionais** — adicione múltiplas URLs ao registro durante o atendimento
- **Comentário opcional** — campo para descrever o serviço ao finalizar
- **Ícone dinâmico** — verde (rodando), laranja (pausado) e vermelho (inativo)
- **Integração com Google Sheets** — envia os registros para uma planilha existente via Google Apps Script

## Como funciona a integração com o Google Sheets

O plugin identifica a tarefa pela URL da aba ativa. Ele extrai o parâmetro `task=XXXXX` da URL (ex: `?task=61101`) e busca esse ID na coluna **"Id da tarefa"** da planilha.

Ao enviar, o script:
1. Localiza a linha correspondente à tarefa na primeira aba da planilha
2. Cria as colunas abaixo no final da planilha (se ainda não existirem)
3. Preenche os dados na linha encontrada

| Coluna | Descrição |
|--------|-----------|
| Data (AP) | Data do atendimento |
| Início (AP) | Horário de início |
| Fim (AP) | Horário de término |
| Duração (AP) | Tempo total cronometrado |
| Pausas (AP) | Pausas com horário de entrada e retorno |
| URLs (AP) | URL da aba ativa + links adicionados |
| Comentário (AP) | Comentário inserido ao finalizar |

## Instalação da extensão

1. Clone ou baixe este repositório
2. Abra o Chrome e acesse `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto

## Configuração do Google Sheets

1. Abra a planilha desejada no Google Sheets
2. Clique em **Extensões › Apps Script**
3. Apague o código existente e cole o script disponível na tela **"Configurar Google Sheets"** do plugin
4. Salve e clique em **Implantar › Nova implantação**
5. Tipo: **App da Web** | Acesso: **Qualquer pessoa**
6. Copie a URL gerada e cole em **⚙ Configurações** do plugin

> A planilha deve ter uma coluna chamada **"Id da tarefa"** na primeira aba. O script sempre opera sobre a primeira aba da planilha.

## Estrutura do projeto

```
servicetime-v2/
├── manifest.json      # Manifest V3
├── background.js      # Service Worker — controla o ícone
├── popup.html         # Interface da extensão (5 telas)
├── popup.js           # Toda a lógica da extensão
├── popup.css          # Estilos (tema escuro)
└── icons/             # Ícones da extensão
```
