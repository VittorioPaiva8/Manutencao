// Tela de celular: menu que abre e fecha no lugar das abas, topo numa linha e tabelas em cartões.
const { test, expect, criarConta, equipamento, entrar, aba, preencherChecklist } = require('./ajuda');

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('abas ficam num menu que abre e fecha pelo botão', async ({ page }) => {
  await entrar(page, await criarConta('Gestora Ana', 'g@teste.com', 'gestor'));
  await expect(page.locator('#btnMenu')).toBeVisible();
  await expect(page.locator('.tab[data-view="req"]')).toBeHidden();
  await expect(page.locator('#secAtual')).toHaveText('Novo checklist');
  // Nome, tema e Sair saem do topo e vão para dentro do menu.
  await expect(page.locator('#quem')).toBeHidden();
  await expect(page.locator('#btnTema')).toBeHidden();

  await page.click('#btnMenu');
  await expect(page.locator('#btnMenu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#menuCel .tab:visible')).toHaveCount(9);
  await expect(page.locator('#quemMenu')).toContainText('Gestora Ana');

  // Escolher uma aba fecha o menu e mostra o nome dela no topo.
  await page.click('.tab[data-view="insp"]');
  await expect(page.locator('#v-insp')).toBeVisible();
  await expect(page.locator('.tab[data-view="insp"]')).toBeHidden();
  await expect(page.locator('#btnMenu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#secAtual')).toHaveText('Inspeções');

  // Fecha tocando fora e com Esc.
  await page.click('#btnMenu');
  await page.locator('#menuFundo').click({ position: { x: 200, y: 800 } });
  await expect(page.locator('#menuCel')).toBeHidden();
  await page.click('#btnMenu');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menuCel')).toBeHidden();
});

test('tema e Sair funcionam pelo menu', async ({ page }) => {
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await page.click('#btnMenu');
  const tema = page.locator('#menuCel [data-tema-btn]');
  await expect(tema).toHaveText('Modo escuro');
  await tema.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(tema).toHaveText('Modo claro');
  await page.locator('#menuCel .btnSair').click();
  await expect(page.locator('#telaLogin')).toBeVisible();
});

test('botão do menu mostra a soma dos avisos das abas', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await expect(page.locator('#menuBadge')).toBeHidden();
  await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Freio']] });
  // 1 requerimento aberto + 1 equipamento não liberado no painel do dia.
  await expect(page.locator('#menuBadge')).toHaveText('2');
});

test('nenhuma tela passa da largura do celular e as tabelas viram cartões', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão basculante');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Freio']] });
  for (const v of ['check', 'dia', 'eq', 'req', 'insp', 'fin', 'cad', 'usr']) {
    await aba(page, v);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'largura da aba ' + v).toBeLessThanOrEqual(390);
  }
  await aba(page, 'req');
  await expect(page.locator('#v-req thead')).toBeHidden();
  await expect(page.locator('#reqTbody td[data-l="Placa"]')).toHaveText('ABC1D23');
  await page.locator('#reqTbody tr[data-id]').click();
  await expect(page.locator('#mStatus')).toBeVisible();
});

test.describe('computador', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test('mostra as abas normais, sem o botão de menu', async ({ page }) => {
    await entrar(page, await criarConta('Op', 'op@teste.com'));
    await expect(page.locator('#btnMenu')).toBeHidden();
    await expect(page.locator('.tab[data-view="req"]')).toBeVisible();
    await expect(page.locator('#quem')).toBeVisible();
    await expect(page.locator('#v-req thead')).toBeHidden(); // aba fechada
    await aba(page, 'req');
    await expect(page.locator('#v-req thead')).toBeVisible();
  });
});

test('campos com letra de 16px ou mais, para o iPhone não dar zoom ao tocar', async ({ page }) => {
  const menores = () => page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter(e => e.offsetParent && e.type !== 'checkbox' && e.type !== 'file' && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map(e => (e.id || e.className) + ' ' + getComputedStyle(e).fontSize));
  await page.goto('/');
  await page.locator('#telaLogin').waitFor();
  await page.click('#lnkCadastro');
  expect(await menores(), 'tela de login').toEqual([]);
  await equipamento('ABC1D23', 'Caminhão');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Freio']] });
  await page.click('[data-n="5"][data-s="MU"]');
  for (const v of ['check', 'dia', 'eq', 'req', 'insp', 'fin', 'cad', 'usr']) {
    await aba(page, v);
    expect(await menores(), 'aba ' + v).toEqual([]);
  }
  await aba(page, 'req');
  await page.locator('#reqTbody tr[data-id]').click();
  expect(await menores(), 'janela do requerimento').toEqual([]);
});

test('no computador o topo não mostra o nome da aba (só no celular)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await expect(page.locator('#secAtual')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#secAtual')).toBeVisible();
});
