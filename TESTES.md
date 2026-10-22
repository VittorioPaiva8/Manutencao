# Testes automáticos

A cada mudança enviada para a branch `main`, o GitHub roda **todos** os testes antes de publicar.
Se qualquer teste falhar, o site **não é publicado** e continua na versão anterior. Em pull requests
os testes também rodam, e o resultado aparece no próprio PR.

Os testes usam o simulador do Firebase: um login e um banco vazios, criados só para o teste.
Nada toca nos dados reais.

## O que é testado

| Arquivo | O que confere |
|---|---|
| `tests/01-acesso.spec.js` | Criar conta, aprovação pelo gestor, senha errada, esqueci a senha, cargos, bloquear e excluir usuário, tema claro/escuro, abas de cada cargo (incluindo Relatórios do gestor) |
| `tests/02-checklist.spec.js` | Registrar checklist, liberação (MU, item crítico, item 50), requerimentos, campos obrigatórios, placa não cadastrada, até dois por dia, ocorrência repetida, KM e horímetro, foto, legenda do item crítico |
| `tests/03-os.spec.js` | Tratamento da OS pelo gestor, próximo número da OS, técnico em Minhas OS, histórico, operador só lê, filtros, Finalizados e CSV |
| `tests/04-gestao.spec.js` | Itens do checklist (novo, renomear, desativar, crítico, excluir, restaurar), painel do dia, checklist completo, paginação, backup em Excel, correção do KM |
| `tests/05-regras.spec.js` | Regras de segurança do banco: anti-spam, ninguém vira gestor sozinho, operador e técnico não passam dos limites |
| `tests/06-celular.spec.js` | Tela de celular: menu que abre e fecha, aviso somado no botão, tema e Sair pelo menu, tabelas em cartões, nada passando da largura da tela, campos com 16px (sem zoom no iPhone) |
| `tests/07-equipamentos.spec.js` | Aba Equipamentos: cadastrar, editar e remover pelo modal, placa repetida, cor de cada quadrado pelo checklist do dia (verde, vermelho, amarelo, cinza), filtro por cor e busca, operador só vê; relatório ao tocar no quadrado (disponibilidade, tempo médio parado, uso médio, OS, últimos 30 dias) e aviso de parado agora |
| `tests/08-melhorias.spec.js` | KM corrigido para menos pelo gestor vale na tela e no próximo checklist; preventivas por KM (cadastro, aviso perto e vencido, aviso no checklist, técnico marca feita, regras); foto do serviço pronto (e quem pode gravar); imprimir / PDF do checklist e da OS; avisos no aparelho para técnico e gestor; filtro por data de abertura nos Requerimentos; etiquetas QR e link que abre o checklist com a placa; custo da OS (peças e mão de obra) no relatório, Finalizados, CSV e regras |
| `tests/09-relatorios.spec.js` | Aba Relatórios: período rápido e personalizado, resumo do período, ranking da frota, custos, checklists em falta, OS em aberto e preventivas em PDF; período inválido; só o gestor vê |
| `tests/10-topo.spec.js` | Barra de cima no computador: avatar com menu do usuário (nome, tema, Sair; fecha clicando fora e com Esc), menu Gestão com as abas do gestor, número de pendências e destaque da aba aberta, abas cabendo em tela média |
| `tests/11-publicacao.spec.js` | Publicação: o deploy no GitHub usa uma versão fixa do Firebase CLI |
| `tests/12-ocorrencias.spec.js` | Ocorrências separadas em MU e PR: conta a cada checklist repetido, requerimento antigo continua a conta, aparece na lista, na OS, no relatório do equipamento e no Resumo; regras só deixam subir de 1 em 1 |
| `tests/13-rapidez.spec.js` | Relatório do equipamento abre na hora com os dados que o app já tem, mesmo com o servidor lento; sem checklist mostra o aviso certo |

## Regra para toda mudança nova

1. Toda função nova ganha pelo menos um teste no arquivo do assunto (ou num arquivo novo `tests/NN-assunto.spec.js`).
2. Toda correção de erro ganha um teste que falharia antes da correção.
3. Antes de enviar, rode `npm test` e confira que **todos** passam, os antigos e os novos.
4. Teste não se apaga nem se desliga para "passar": se um teste antigo quebrou, ou a mudança tem um erro, ou o comportamento mudou de propósito e o teste é atualizado junto, explicando por quê.

## Rodar no computador

Precisa de Node 22 e Java 17 ou mais novo.

```
npm install
npx playwright install chromium
npm test
```

Para ver um teste só: `npx firebase emulators:exec --project demo-checklist --only auth,firestore,hosting "npx playwright test tests/03-os.spec.js"`.

Quando um teste falha no GitHub, o relatório fica em **Actions › execução › Artifacts › relatorio-dos-testes**, com a tela do momento do erro.
