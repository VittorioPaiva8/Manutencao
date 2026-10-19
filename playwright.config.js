// Testes automáticos do app. Rodam com `npm test`, que liga os emuladores do Firebase
// (login, banco e hosting, tudo local e vazio) e executa cada arquivo de tests/.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // O banco do emulador é um só: os testes rodam um de cada vez e cada um começa com ele vazio.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5000/',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    // Sem service worker nos testes: ele guardaria versões antigas da tela entre um teste e outro.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Num ambiente com o Chromium já instalado em outro lugar, aponte PW_CHROMIUM para ele.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
});
