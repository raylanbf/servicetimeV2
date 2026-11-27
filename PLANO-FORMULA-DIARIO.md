# Plano — Fórmula de fechamento do diário (SGA)

> **Status:** Fases 1 e 2 implementadas (25/11/2026, botão "🧮 Fórmula do diário" no 🩺 Analisar disciplina). Leitura da Sincronização SGA conferida no Canvas real em 26/11/2026 (curso 294073). MAX combinado para fechar a sobra em 26/11/2026. Conferência "pronta para o professor" em 26/11/2026.
> **Fontes:** manual oficial da função `reav` do SGA e orientações da equipe, em `C:\Users\Casa\Downloads\reav` (ver seção 2).

## Andamento

- [x] Fase 1 — fórmula a partir do Canvas: P numerado pela ordem das tarefas (editável), sugestão de reavaliação e MAX, conta igual ao "Executar" do SGA, cadastro da reavaliação, levantamento de sobra/falta com quem perderia nota. `popup.js` (`fd*`), teste `test-formula.js`.
- [x] Junto: "Verificar tarefas" deixou de acusar tarefa **não publicada** sem SIS (ela não vai para o SGA); vai para o grupo "Não publicadas".
- [ ] Teste real — rodar num curso que já tem o diário fechado e comparar com a fórmula da Sincronização SGA (bons candidatos: os exemplos da seção 3).
  - 25/11/2026, curso 251328 (1445101 Prática Baseada em Evidências): o atendente usou `reav(P17;(P1+…+P16+P18))`; a extensão deu `Reav(P17;P1+P3+…+P16+P18+P19)`. Mesmo formato (reavaliação de 100 cobre tudo), mas **numeração errada**: a extensão tem 19 tarefas publicadas com SIS, uma delas de 0 pts em 2º lugar (o P2 dela), e põe depois da reavaliação uma tarefa que o SGA numerou antes. Colada no SGA, deixaria de fora o P2 do SGA e citaria um P19 que ele não tem. Confirma que a ordem do Canvas não basta → Fase 2.
  - 25/11/2026, curso 251332: 10 tarefas com SIS (200 pts) e a "Reavaliação - 13-12-2025" vem **primeiro** na ordem do Canvas — a extensão a chamaria de P1, quando ela foi a última criada e sincronizada. Mais um sinal de que o P segue a ordem de sincronização (perto da ordem de criação), não a da tela. Também apareceu uma cópia publicada sem SIS ("Exercício de Aprendizagem - Módulo V", mesmo nome, valor e prazo de uma com SIS).
- [x] Fase 2 (parte 1, 25/11/2026) — leitura por trás da Sincronização SGA (`sgaLoad`: aba do curso → página da ferramenta → POST do formulário assinado → index; `sgaParse` lê os dados embutidos; nunca chama `/sync`). Mostra diário aberto/fechado, última sincronização e a **fórmula atual**, comparada com a sugerida (`fdCanon`: ignora ordem, parênteses e maiúsculas). Numera pelas siglas quando `avaliacoes` vem (`sgaApplySiglas`: nome — o SGA corta — e valor; vagos/pendentes listados). Critério do sincronizador no "Verificar tarefas" e nas tarefas que viram P. Simulação em `test-formula.js`; parser conferido com a página real do 251332.
- [x] Fase 2 (parte 2) — conferido no Canvas real: o POST por trás funciona na extensão e `avaliacoes` preenchida num diário aberto tem os campos esperados.
  - 26/11/2026, curso 294073 (4433101 Tecnologias Digitais Aplicadas ao Ensino de Línguas Estrangeiras - G1/T1 - 2026/2, diário aberto): a tabela "SGA: Atividades" veio **preenchida**, P1–P18, todas "OK", Descrição = nome do Canvas inteiro, Valor `1.00`, Qtd. Lanc. Os P seguem exatamente a ordem das linhas "OK" da tabela "Canvas: Atividades" (as não publicadas ficam de fora sem gastar número). A extensão mostrou "✓ P lidos do SGA para as 18 tarefas".
- [x] MAX combinado (26/11/2026) — no 294073 a soma sem a reavaliação dá 132 e a versão anterior não fazia MAX nenhum (sobra 32 não é múltipla de 25). Agora: a substitutiva sempre vira MAX do grupo dela (`Max(2;P16;P17;P18)`, sobram 7) e o resto fecha com MAX em outros grupos de mesmo valor (uma de 5 pts + duas de 1 pt). Fórmula sugerida: `Reav(P14;P2+P5+P7+Max(2;P1;P3;P12;P13)+Max(6;P4;P6;P8;P9;P10;P11;P15)+Max(2;P16;P17;P18))`. Um `Max` por grupo de mesmo valor, cada um com o seu "pega as N maiores" na tela. O SGA aceita vários `Max` na mesma fórmula (confirmado pela equipe em 26/11/2026).
- [x] Fórmula para o professor (26/11/2026) — "a fórmula será usada pelo professor para fechar o diário": tem que sair completa e correta.
  - "✓ Fecha em 100 — fórmula pronta para o professor" só quando fecha, sem aviso e conferida com o SGA. Fechando com pendência: "⚠ Fecha em 100, mas confira antes de passar ao professor" com a lista (`fdReview`): P pela ordem do Canvas (sem siglas), P sem sigla (criada/renomeada depois da sincronização), P mudado à mão contra a sigla, sigla do SGA que não casou com nenhuma tarefa, valor do Canvas ≠ valor do SGA (o "Executar" usa o do SGA).
  - Fórmula que não fecha não pode ser copiada; total 100 com a reavaliação errada mostra "Ainda não fecha".
  - Duas reavaliações: a outra fica "Fora da fórmula", com aviso (antes entrava num MAX com as provas e saía `Reav(P4;)`).
  - `fdCanon` reconhece o reav em qualquer posição, parênteses só em parte da soma e vários MAX.
  - Falta com reavaliação de 100: a tarefa nova entra dentro do Reav.
- [ ] `sgaLoad`: guardar o status/endereço da resposta do POST, para dizer onde falhou quando não ler a Sincronização SGA.

---

## 1. Objetivo

No fim do semestre, a equipe monta a fórmula que fecha o diário no SGA e confere se ela fecha em 100. Quando não fecha, o professor distribuiu pontos a mais ou a menos, e a equipe precisa dizer o que ele deve fazer sem prejudicar alunos. A ferramenta faz isso com a disciplina aberta no Canvas, só lendo (nada é gravado).

A equipe **não tem acesso ao SGA**, só ao Canvas — inclusive à página "Sincronização SGA" do menu do curso, que mostra a situação do diário, a fórmula atual e as tabelas "Canvas: Atividades" e "SGA: Atividades" (esta com a sigla P de cada uma).

## 2. Regras

### Função `reav` (manual oficial do SGA, "Fechamento por Módulo 4.doc")
- `reav(Arg1;Arg2)`: Arg1 é **uma** avaliação do tipo Reavaliação; Arg2 é o que ela cobre (uma ou mais avaliações, com `+ - * /`, `Max`, `Med`, `Sbt`). Os dois devem valer o mesmo.
- **Pesos diferentes de zero** (Peso Reavaliação e Peso Nota Parcial): média ponderada entre Arg1 e Arg2 para quem fez a reavaliação.
- **Pesos 0 e 0:** a reavaliação **substitui** o Arg2.
- **"Não substituir reavaliação se o total for menor"** marcado: a reavaliação nunca rebaixa — na prática fica a maior nota.
- `reav(Arg1;Arg2;Arg3)` é a reavaliação por módulo (substitui o módulo de menor nota, sem pesos). Raro; a ferramenta não monta.
- `Max(n;Pa;Pb;…)`: as n maiores notas. No fechamento (nota máxima) vale a soma dos n maiores valores.
- O editor de fórmulas do SGA tem "Executar", que mostra a conta com os valores (ex.: `80+20+40-40 = 100`).

### Regras da equipe (confirmadas em 25/11/2026)
- **P** é a sigla que o SGA dá na sincronização, na ordem em que o Canvas lista as tarefas. Só tarefa **publicada com SIS** vira P. O P **nunca some**: tarefa apagada deixa o número vago (P1, P2 e P11 faltam no 2244102), então os números podem ter buracos.
- Sem reavaliação: soma simples, fecha em **100**.
- Reavaliação de **100** cobre tudo: `Reav(Preav;todas as outras)`, total 200, **pesos 1 e 1**.
- Reavaliação menor (30, 40, 50) cobre uma avaliação ou grupo de **mesmo valor**: `Reav(Preav;Palvo)+resto`, **pesos 0 e 0**.
- Total esperado = **100 + valor da reavaliação**.
- A **substitutiva** é trocada por uma atividade de mesmo valor: `Max(k−1;grupo)` com ela e as de mesmo valor (ela nunca soma).
- O que ainda sobra também fecha com MAX em grupos de mesmo valor (confirmado em 26/11/2026, curso 294073: "um max que retornaria 2 pontos de 4 atividades de 1 ponto").
- Só quando nenhum MAX fecha é erro do professor: criar uma tarefa e dar o ponto que falta a todos, ou tirar pontos de uma atividade — mostrando quem perderia nota.
- O **formato não importa, só tem que fechar**. A ferramenta usa o padrão: cada MAX só com um grupo de mesmo valor (nunca dá menos ao aluno), nunca um MAX que mistura valores.
- Cadastro da reavaliação no SGA: tipo "Reavaliação" (não "Trabalho"), os pesos acima, "Não substituir…" marcado, "Reavaliação por módulo" desmarcado.
- A nota da reavaliação **não impacta quem não faz** (confirmado em 26/11/2026). A substitutiva, no MAX, também não. Por isso o "Verificar boletim" não cobra nota delas: ficam fora das notas vazias e dos zeros suspeitos. Nas outras tarefas que vão ao SGA, todo aluno precisa de nota (pode ser 0).

## 3. Exemplos reais

| Diário | Fórmula | Caso |
|---|---|---|
| 4539100 Mecânica Básica | `P1+P2+P3+P4+P5+P6+P7+P8` | sem reavaliação, soma 100 |
| PDF 2º/2022 (modelo) | `Reav(p11;p10)+p1+…+p9` | reav 30 cobre a Etapa 3 de 30; pesos 0 |
| PDF 2º/2022 ICEG eixo 4 | `Reav(P8;(P1+P2+P3))+P4+P5+P6+P7+P9+P10` | reav 50 cobre 20+10+20 |
| 4467101 Aplicações Web | `reav(P2;P1)+P3+P4` | reav cobre uma avaliação |
| 2244102 Aplicações Web | `Reav(P13;P3+…+P10+P12)` | reav 100 cobre tudo; P vagos |
| 1493101 Comunicação Digital | `REAV(P5;+P3+P4+P6+P7)` | reav 100, pesos 1 e 1 |
| 17101 Contabilidade Gerencial | `reav(P15;P13+P14+P7+…+P12+max(5;P1;…;P6))` | soma sem reav 105 → MAX descarta 1 |
| 540101 Redes de Computadores | `reav(P19;max(6;P1;P2;P4;P5;P7;P16;P18)+…)` | MAX com valores misturados (fecha, mas fora do padrão) |
| 698103 Cultura Religiosa | `reav(P16;P9+P19+max(12;…13 P)+P4+P8+P12+P14)` | MAX de 13, pesos 1 e 1 |
| 4433101 Tecnologias Digitais (2026/2, sugerida pela extensão) | `Reav(P14;P2+P5+P7+Max(2;P1;P3;P12;P13)+Max(6;P4;…;P15)+Max(2;P16;P17;P18))` | soma sem reav 132: substitutiva + 7 em MAX de 5 e de 1 pt |

## 4. Como a Fase 1 decide (sugestão; tudo editável na tela)

1. Lê os grupos de tarefas e as tarefas; numera as publicadas com SIS na ordem grupo → posição.
2. Reavaliação: pelo nome ("reavaliação", sem "substitutiva"); com mais de uma, a de maior valor.
3. Soma o resto. A substitutiva com outras de mesmo valor vira `Max(k−1;grupo)` sempre (se isso tirar mais do que sobrava, falta ponto). O que ainda sobra fecha com `Max` em grupos de mesmo valor, na combinação que descarta menos notas e, empatando, usa menos grupos (`fdMaxPlan`, uma mochila). Sem combinação exata, a sobra fica para o levantamento.
4. Reavaliação de 100 (ou do mesmo valor do resto) cobre tudo, com o MAX dentro; a menor cobre a avaliação de mesmo valor (prova/avaliação, a última). Sem candidata (ex.: ICEG), pede para marcar.
5. Mostra a fórmula, a conta (como o "Executar"), o cadastro da reavaliação e avisos (P repetido, reavaliação e alvo com valores diferentes, MAX estranho).
6. Não fecha: falta → criar tarefa com o ponto que falta e lançar para todos; sobra → para cada atividade, quantos alunos têm nota acima do novo máximo (sem prejuízo primeiro), lendo o boletim só nesse caso.

## 5. Fase 2 — P de verdade pela Sincronização SGA

A página "Sincronização SGA" do menu do curso (ferramenta LTI dentro do Canvas) tem duas tabelas:

- **"SGA: Atividades da disciplina"** (Sigla, Descrição, Valor, Qtd. Lanc., Observação). Com o **diário aberto** ela traz os P que vieram do Canvas, com "OK" (curso de Tecnologias Digitais 2026/2, 26/11/2026). A sincronização roda em segundo plano e, uns 20 minutos depois, a página volta com o que foi sincronizado: as notas, a quantidade de lançamentos etc. Nos diários de semestres passados ela vem vazia (251328, 251332) ou só com "Pendente de exclusão" (prints de 17101, 540101 e Mecânica Básica; na Mecânica, com nomes que nem são os das tarefas do Canvas).
- **"Canvas: Atividades da disciplina"** (Sincronização, Observação, Nome, Valor, Correções pendentes): todas as tarefas do Canvas, inclusive as não publicadas e as sem SIS, numa ordem própria. Não mostra a sigla.

### Como a página funciona (gravação + código-fonte do curso 251332, 25/11/2026)

- **Lançamento LTI 1.1:** a página do Canvas `/courses/<id>/external_tools/1187` tem um formulário assinado (`#tool_form_…`, campos `oauth_*`, `custom_canvas_course_id`, `lis_course_offering_sourcedid` = `SGA_<…>_<ano>_<sem>_<turma>` etc.) que faz POST para `https://ead05.virtual.pucminas.br/sga_sync/launch`; o servidor mostra `/sga_sync/index?course_id=<id>&user_id=<id>`.
- **Os dados vêm embutidos no HTML** (Vue 2 com delimitadores `[[ ]]`), não por API:
  - `vue_diario.disciplina` (dict do Python, aspas simples): `seq_turma`, `nom_disciplina`, `dsc_formula` (**a fórmula atual**), `ind_diario_fechado`, `ind_formula_grupo`, `cod_ead`…; `task`: `created_at`, `done_at`, `processed`.
  - `vue_assignment_table.assignments` (JSON): as tarefas do Canvas **na ordem da API** (a mesma do "Verificar tarefas"), com `id`, `points_possible`, `post_to_sis`, `published`, `omit_from_final_grade`, `post_manually`, `grading_type`, `needs_grading_count`, `has_problems`.
  - `vue_sga.avaliacoes`: a tabela do SGA — `sigla_avaliacao`, `dsc_avaliacao`, `val_avaliacao`, `lancamentos`, `consta_formula`, `consta_canvas`. **Vazia no 251332.**
- **Critério do sincronizador** para a tarefa ir ao SGA ("OK"): publicada, com SIS, pontos > 0, conta na nota final, "Exibir nota como" = Pontos. Política de postagem manual = laranja ("Verificar política de postagem de notas").
- **Nunca chamar `/sga_sync/sync`** — é o botão "Sincronizar".

### O que o 251332 mostrou sobre a ordem dos P

Fórmula do SGA: `reav(P10;P1+P2+P3+P4+P5+P6+P8+P9+P11)` → P1–P11, reavaliação = P10, **P7 vago**. Nenhuma ordem que o Canvas expõe reproduz isso: a da tabela/API põe a Reavaliação em 1º; a de criação (id), em 11º; a de prazo acerta o P10 da Reavaliação, mas não explica o P7 vago nem quem é o P11. **O P é dado na ordem de sincronização e depende do histórico** — só a lista `avaliacoes` (sigla) é fonte confiável.

### Plano da Fase 2

1. Ao clicar em "Fórmula do diário", abrir a Sincronização SGA por trás (sem aba): GET da página da ferramenta no Canvas, POST do formulário assinado pela extensão, ler o HTML do `index` e tirar `disciplina`, `assignments` e `avaliacoes`.
2. Mostrar a **fórmula atual do SGA**, diário aberto/fechado e a última sincronização, e comparar com a sugerida.
3. Com `avaliacoes` preenchida: numerar pela sigla (casando nome — o SGA corta em ~50 letras — e valor), marcar vagos e "pendente de exclusão". Vazia: manter a ordem do Canvas com aviso forte.
4. Usar o critério do sincronizador também no "Verificar tarefas" e na escolha das tarefas que viram P.

`avaliacoes` preenchida já foi vista na tela (Tecnologias Digitais 2026/2). Falta rodar a extensão nesse curso: deve mostrar "✓ P lidos do SGA para as 18 tarefas" e a fórmula com P1–P18.
