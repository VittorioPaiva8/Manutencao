# Notas para quem mexe no código

- App: PWA do Check List de Averiguação (Firebase Hosting + Auth + Firestore). Código em `public/`, regras em `firestore.rules`. Textos para o usuário em português.
- **Testes obrigatórios:** toda mudança vem com teste novo em `tests/` e `npm test` precisa passar inteiro (antigos + novos) antes do push. Veja `TESTES.md`. O deploy da `main` só acontece se a suíte passar no GitHub Actions.
- Rodar local sem internet para o gstatic: os testes servem o SDK do Firebase a partir de `node_modules/firebase`. Se o Chromium estiver em outro caminho, use `PW_CHROMIUM=/caminho/do/chromium npm test`.
- Nunca pular, apagar ou desligar teste para ficar verde.
