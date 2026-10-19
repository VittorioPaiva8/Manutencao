# Check List de Averiguação no Firebase (funciona offline)

App instalável no celular (PWA) com o visual ITAX. Os checklists ficam salvos no aparelho quando não há sinal e sobem sozinhos para o Firestore quando a internet volta. Cada item MU ou PR gera um requerimento de abertura de OS.

## Estrutura

| Arquivo | O que é |
|---|---|
| `public/index.html` | A tela (login, checklist, requerimentos, inspeções, cadastros, usuários) |
| `public/app.js` | Lógica do app e gravação no Firestore com cache offline |
| `public/sw.js` | Service worker: guarda a tela no celular para abrir sem internet |
| `public/manifest.webmanifest`, `public/icons/` | Dados para instalar como app |
| `firestore.rules` | Quem pode ler e gravar o quê |
| `firebase.json` | Configuração de publicação |

## 1. Criar o projeto (uma vez, no navegador)

1. Acesse https://console.firebase.google.com e clique em **Criar projeto**. O Google Analytics pode ficar desligado.
2. No menu **Criação > Authentication > Vamos começar**, abra a aba **Método de login** e ative **E-mail/senha**.
3. No menu **Criação > Firestore Database > Criar banco de dados**, escolha o local **southamerica-east1 (São Paulo)** e o **modo de produção**. O local não pode ser mudado depois.

O plano gratuito (Spark) é suficiente e não pede cartão.

## 2. Publicar (no computador)

1. Instale o Node.js (https://nodejs.org, versão LTS).
2. Abra o terminal na pasta `firebase-checklist` e rode:
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy
   ```
   No `firebase use --add`, escolha o projeto criado e use o apelido `default`.
3. No final, o terminal mostra o endereço do app, algo como `https://SEU-PROJETO.web.app`.

O `firebase deploy` publica a tela e as regras de segurança juntas.

## 3. Primeiro gestor

1. Abra o endereço do app, clique em **Primeiro acesso? Criar conta** e faça seu cadastro.
2. No console do Firebase, abra **Firestore Database > usuarios** e o documento com o seu e-mail. Mude `ativo` para `true` e `papel` para `gestor`.
3. O app libera o acesso sozinho. A partir daí, os outros usuários são aprovados pela aba **Usuários** do próprio app.

## 4. Operários

1. Eles abrem o endereço com internet, criam a conta e esperam a aprovação do gestor.
2. Depois instalam o app no celular:
   - Android (Chrome): menu ⋮ > **Instalar app** (ou Adicionar à tela inicial).
   - iPhone (Safari): botão Compartilhar > **Adicionar à Tela de Início**.
3. A partir daí o app abre e registra checklists sem internet. Até o envio acontecer, o topo mostra **Offline · N a enviar**.

## Regras de negócio

- **MU** gera requerimento com prioridade ALTA. **PR** gera com prioridade NORMAL, ou ALTA se o item estiver marcado como crítico em Cadastros.
- Se já existe requerimento aberto do mesmo item para a mesma placa, o app soma uma ocorrência em vez de duplicar.
- **Um checklist por equipamento por dia.** Só equipamentos cadastrados pelo gestor (aba Cadastros) aceitam checklist, e a data precisa ser de hoje ou dos últimos 30 dias. Para refazer um checklist do dia, o gestor apaga o anterior no console do Firebase.
- **Proteção contra envio em massa:** o botão de registrar fica travado por 5 segundos depois de cada envio, e o banco recusa checklist repetido, placa não cadastrada, data fora da janela e requerimento criado fora de um checklist. Assim ninguém consegue encher o banco, nem pela tela nem mexendo no código do navegador.
- *Liberado para atividades* fica NÃO quando há MU, item crítico com divergência ou o item 50 não está OK.
- Os códigos `CHK-AAMMDD-XXXX` e `REQ-AAMMDD-XXXX` são gerados no aparelho, para funcionar offline sem repetir.
- O operador registra checklists e vê os requerimentos. Só o gestor altera status, Nº da OS e responsável, aprova usuários e mexe nos cadastros. Quem garante essas permissões é o `firestore.rules`, não só a tela.

## Atualizar o app

O app é publicado sozinho pelo GitHub Actions a cada mudança na branch `main` (`.github/workflows/firebase-hosting-merge.yml`). A versão do service worker é trocada automaticamente, e os celulares pegam a tela nova na próxima vez que abrirem o app com internet.

Pull requests ganham uma prévia temporária, com o link comentado no próprio PR.

A automação publica só a tela (Hosting). Quando `firestore.rules` mudar, rode `firebase deploy --only firestore` uma vez no Cloud Shell.

Para configurar a automação pela primeira vez, rode `firebase init hosting:github` dentro da pasta do projeto no Cloud Shell, informe o repositório `VittorioPaiva8/Manutencao` e responda **não** para criar os arquivos de workflow (eles já estão no repositório). Isso cria a credencial `FIREBASE_SERVICE_ACCOUNT_MANUTENCAO_C2F1F` nos secrets do GitHub.

## Limites conhecidos

- O primeiro login de cada aparelho precisa de internet.
- Se dois operários offline registrarem o mesmo equipamento no mesmo dia, só o primeiro a sincronizar é aceito; o segundo recebe um aviso de falha ao enviar.
