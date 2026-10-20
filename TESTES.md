# Testes automáticos

A cada mudança enviada para a branch `main`, o GitHub roda **todos** os testes antes de publicar.
Se qualquer teste falhar, o site **não é publicado** e continua na versão anterior. Em pull requests
os testes também rodam, e o resultado aparece no próprio PR.

Os testes usam o simulador do Firebase: um login e um banco vazios, criados só para o teste.
Nada toca nos dados reais.

## O que é testado

| Arquivo | O que confere |
|---|---|
| `tests/01-acesso.spec.js` | Criar conta, aprovação pelo gestor, senha errada, esqueci a senha, cargos, bloquear e excluir usuário, tema claro/escuro, abas de cada cargo |
| `tests/02-checklist.spec.js` | Registrar checklist, liberação (MU, item crítico, item 50), requerimentos, campos obrigatórios, placa não cadastrada, um por dia, ocorrência repetida, KM e horímetro, foto, legenda do item crítico |
| `tests/03-os.spec.js` | Tratamento da OS pelo gestor, próximo número da OS, técnico em Minhas OS, histórico, operador só lê, filtros, Finalizados e CSV |
| `tests/04-gestao.spec.js` | Equipamentos, itens do checklist (novo, renomear, desativar, crítico, excluir, restaurar), painel do dia, checklist completo, paginação, backup em Excel, correção do KM |
| `tests/05-regras.spec.js` | Regras de segurança do banco: anti-spam, ninguém vira gestor sozinho, operador e técnico não passam dos limites |
| `tests/06-celular.spec.js` | Tela de celular: menu que abre e fecha, aviso somado no botão, tema e Sair pelo menu, tabelas em cartões, nada passando da largura da tela, campos com 16px (sem zoom no iPhone) |

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
