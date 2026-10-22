// Barra de cima no computador: avatar com menu do usuário e abas do gestor no menu "Gestão".
const { test, expect, criarConta, entrar, aba } = require('./ajuda');

test.use({ viewport: { width: 1280, height: 900 } });

test('menu do usuário guarda nome, tema e Sair; fecha clicando fora e com Esc', async ({ page }) => {
  await entrar(page, await criarConta('Gestora Ana Souza', 'g@teste.com', 'gestor'));
  // Na barra ficam só a conexão e o avatar com as iniciais.
  await expect(page.locator('#netStatus')).toHaveText('Online');
  await expect(page.locator('#avatar')).toHaveText('GS');
  for (const s of ['#quem', '#btnTema', '.top-r .btnSair']) await expect(page.locator(s)).toBeHidden();

  await page.click('#btnUsuario');
  await expect(page.locator('#btnUsuario')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#quem')).toContainText('Gestora Ana Souza');
  await expect(page.locator('#quem')).toContainText('Gestor');
  await expect(page.locator('#btnTema')).toBeVisible();
  await page.click('main', { position: { x: 300, y: 400 } });
  await expect(page.locator('#menuUsuario')).toBeHidden();
  await expect(page.locator('#btnUsuario')).toHaveAttribute('aria-expanded', 'false');

  await page.click('#btnUsuario');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menuUsuario')).toBeHidden();

  await page.click('#btnUsuario');
  await page.click('.top-r .btnSair');
  await expect(page.locator('#telaLogin')).toBeVisible();
});

test('menu Gestão: abas do gestor, número de pendências e destaque da aba aberta', async ({ page }) => {
  await criarConta('Novato', 'novo@teste.com', 'operador', false);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  for (const v of ['fin', 'rel', 'cad', 'usr']) await expect(page.locator(`.tab[data-view="${v}"]`)).toBeHidden();
  // O usuário esperando aprovação aparece no próprio botão "Gestão".
  await expect(page.locator('#gestaoBadge')).toHaveText('1');

  await page.click('#btnGestao');
  await expect(page.locator('#listaGestao .tab:visible')).toHaveCount(4);
  await expect(page.locator('#usrBadge')).toHaveText('1');
  // Abrir o outro menu fecha este.
  await page.click('#btnUsuario');
  await expect(page.locator('#listaGestao')).toBeHidden();
  await expect(page.locator('#menuUsuario')).toBeVisible();

  await page.click('#btnGestao');
  await expect(page.locator('#menuUsuario')).toBeHidden();
  await page.click('.tab[data-view="rel"]');
  await expect(page.locator('#v-rel')).toBeVisible();
  await expect(page.locator('#listaGestao')).toBeHidden();
  await expect(page.locator('#btnGestao')).toHaveClass(/ativo/);

  await aba(page, 'eq');
  await expect(page.locator('#btnGestao')).not.toHaveClass(/ativo/);
});

test('em tela média as abas cabem sem rolar para o lado', async ({ page, novaJanela }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  const t = await novaJanela();
  await t.setViewportSize({ width: 800, height: 900 });
  await entrar(t, await criarConta('Téc', 'tec@teste.com', 'tecnico'));
  for (const p of [page, t]) {
    await expect(p.locator('#btnMenu')).toBeHidden();
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
    const nav = await p.locator('#tabs').evaluate(n => [n.scrollWidth, n.clientWidth]);
    expect(nav[0]).toBeLessThanOrEqual(nav[1]);
  }
});
