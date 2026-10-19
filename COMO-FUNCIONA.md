# Como o sistema funciona

## As peças

```
 Celular / navegador                         Firebase (Google)
 ┌───────────────────────────┐               ┌──────────────────────────────┐
 │ Tela (index.html)         │               │ Hosting: guarda os arquivos  │
 │ Lógica (app.js)           │  ── baixa ──▶ │ da tela e entrega o app      │
 │ Service worker (sw.js)    │               │                              │
 │ Cópia local do banco      │ ◀─ sincroniza▶│ Firestore: o banco de dados  │
 │ (fila do que falta enviar)│               │ Regras (firestore.rules)     │
 │                           │  ── login ──▶ │ Authentication: e-mail/senha │
 └───────────────────────────┘               └──────────────────────────────┘
```

- **Hosting** só serve os arquivos da tela. Não roda nada.
- **A lógica roda no aparelho de cada pessoa:** montar o checklist, contar OK/MU/PR/NA, decidir se o equipamento está liberado e gerar os requerimentos.
- **Firestore** guarda os dados. As **regras** são o porteiro: o Google confere cada gravação no servidor, e o que não estiver de acordo é recusado, mesmo se alguém alterar o código no navegador.
- **Authentication** cuida das contas e senhas.

## O banco (coleções)

| Coleção | O que guarda | Quem grava |
|---|---|---|
| `usuarios` | Nome, e-mail, papel (operador/gestor), ativo | A própria pessoa ao criar a conta (inativa); depois só o gestor |
| `equipamentos` | Placa, equipamento, equipe, cabine | Gestor |
| `config` | Itens críticos (*) e itens desativados | Gestor |
| `inspecoes` | Um checklist: cabeçalho, as 50 respostas, contagem, liberado | Operador ou gestor; ID = `PLACA_AAAA-MM-DD` |
| `requerimentos` | Um pedido de OS por divergência: item, descrição, prioridade, status, Nº OS | Criado junto com o checklist; status só o gestor muda |

## O caminho de um checklist

1. O operador abre o app. O service worker entrega a tela do próprio celular, então o app abre mesmo sem sinal.
2. O operador escolhe a placa (precisa estar cadastrada), preenche e marca os 50 itens.
3. Ao clicar em Registrar, o app confere:
   - se todos os itens foram respondidos e se MU/PR têm descrição;
   - se já existe checklist desse equipamento nesse dia.
4. O app monta **um único pacote de gravação** com:
   - a inspeção;
   - para cada MU/PR, um requerimento novo ou, se já existe um aberto do mesmo item para a mesma placa, uma ocorrência a mais nele.
5. O pacote vai primeiro para a cópia local do banco no celular, e por isso aparece na hora.
   - **Com internet:** sobe para o Firestore em segundos.
   - **Sem internet:** fica na fila. O topo mostra "Offline · N a enviar" e, quando o sinal volta, envia sozinho.
6. No servidor, as regras conferem o pacote inteiro. Ou entra tudo, ou nada.
7. Todo mundo com o app aberto recebe a atualização ao vivo, e o gestor vê o requerimento novo na aba Requerimentos OS.

## O caminho de um requerimento

`Aberto` → `Em análise` → `OS aberta` (com o Nº da OS) → `Concluído` ou `Cancelado`.
Só o gestor muda o status. Ao concluir ou cancelar, a data de fechamento é registrada.

## Regras de prioridade e liberação

- **MU** gera prioridade ALTA. **PR** gera NORMAL, ou ALTA se o item for crítico (*).
- **Liberado para atividades = NÃO** quando há MU, quando um item crítico tem divergência ou quando o item 50 não está OK.

## Proteções

- Um checklist por equipamento por dia, só para placa cadastrada, com data entre os últimos 30 dias e hoje.
- Requerimento só nasce junto com um checklist, no máximo um por item.
- Botão travado por 5 segundos após cada envio.
- Operador não muda status, não aprova ninguém e não mexe em cadastros.
