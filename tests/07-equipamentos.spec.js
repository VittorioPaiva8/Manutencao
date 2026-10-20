// Aba Equipamentos: cadastro pelo modal e quadrados coloridos pelo checklist do dia
// (verde aprovado, vermelho MU, amarelo PR, cinza sem checklist hoje).
const { test, expect, criarConta, equipamento, buscar, entrar, aba, preencherChecklist, diasAtras } = require('./ajuda');

const quadrado = (page, id) => page.locator(`#eqGrid [data-eq="${id}"]`);

test('gestor cadastra pelo modal, edita e remove', async ({ page }) => {
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await expect(page.locator('#eqGrid')).toContainText('Nenhum equipamento cadastrado');

  await page.click('#btnNovoEq');
  await page.click('#eqBtn');
  await expect(page.locator('#eqErro')).toHaveText('Informe a placa ou prefixo.');
  await page.fill('#eqPlaca', 'abc-1d23');
  await page.click('#eqBtn');
  await expect(page.locator('#eqErro')).toHaveText('Informe o nome do equipamento.');
  await page.fill('#eqNome', 'Caminhão basculante');
  await page.fill('#eqEquipe', 'Equipe A');
  await page.selectOption('#eqTipo', 'KM');
  await page.fill('#eqMedidor', '12.000');
  await page.click('#eqBtn');
  await expect(page.locator('#formEq')).toHaveCount(0);
  await expect.poll(() => buscar('equipamentos/ABC-1D23')).toMatchObject({ placa: 'ABC-1D23', equipamento: 'Caminhão basculante', equipe: 'Equipe A', tipoMedidor: 'KM', medidorAtual: 12000 });

  const q = quadrado(page, 'ABC-1D23');
  await expect(q).toContainText('Caminhão basculante');
  await expect(q).toContainText('ABC-1D23');
  await expect(q).toContainText('12.000 km');
  await expect(q).toHaveClass(/st-nada/);

  // Placa repetida é recusada.
  await page.click('#btnNovoEq');
  await page.fill('#eqPlaca', 'ABC-1D23');
  await page.fill('#eqNome', 'Outro');
  await page.click('#eqBtn');
  await expect(page.locator('#eqErro')).toContainText('Já existe');
  await page.click('#mCancelar');

  await q.locator('[data-edit-eq]').click();
  await expect(page.locator('#eqPlaca')).toHaveAttribute('readonly', '');
  await page.fill('#eqNome', 'Caminhão pipa');
  await page.click('#eqBtn');
  await expect.poll(async () => (await buscar('equipamentos/ABC-1D23')).equipamento).toBe('Caminhão pipa');
  await expect(q).toContainText('Caminhão pipa');

  await q.locator('[data-edit-eq]').click();
  await page.click('#eqRemover');
  await expect.poll(() => buscar('equipamentos/ABC-1D23')).toBeNull();
  await expect(q).toHaveCount(0);
});

test('cor de cada quadrado segue o checklist de hoje, e as cores filtram', async ({ page }) => {
  await equipamento('OK01', 'Caminhão aprovado');
  await equipamento('MU01', 'Retro com MU');
  await equipamento('PR01', 'Pá com PR');
  await equipamento('NADA01', 'Trator sem checklist');
  await equipamento('ONTEM01', 'Fez só ontem');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  expect((await preencherChecklist(page, { placa: 'OK01' })).ok).toBe(true);
  expect((await preencherChecklist(page, { placa: 'MU01', divergencias: [[23, 'MU', 'Freio'], [6, 'PR', 'Vaza']] })).ok).toBe(true);
  expect((await preencherChecklist(page, { placa: 'PR01', divergencias: [[20, 'PR', 'Lataria']] })).ok).toBe(true);
  expect((await preencherChecklist(page, { placa: 'ONTEM01', data: diasAtras(1) })).ok).toBe(true);
  await aba(page, 'eq');

  await expect(quadrado(page, 'OK01')).toHaveClass(/st-ok/);
  await expect(quadrado(page, 'OK01')).toContainText('Aprovado');
  await expect(quadrado(page, 'MU01')).toHaveClass(/st-mu/);
  await expect(quadrado(page, 'PR01')).toHaveClass(/st-pr/);
  await expect(quadrado(page, 'NADA01')).toHaveClass(/st-nada/);
  await expect(quadrado(page, 'ONTEM01')).toHaveClass(/st-nada/);

  // As cores na tela: verde, vermelho, amarelo e cinza.
  const cor = id => quadrado(page, id).locator('.eq-sim').evaluate(e => getComputedStyle(e).backgroundColor);
  expect(await cor('OK01')).toBe('rgb(30, 123, 69)');
  expect(await cor('MU01')).toBe('rgb(228, 10, 24)');
  expect(await cor('PR01')).toBe('rgb(217, 154, 0)');
  expect(await cor('NADA01')).toBe('rgb(154, 154, 154)');

  await expect(page.locator('#eqResumo')).toContainText('Aprovado 1');
  await expect(page.locator('#eqResumo')).toContainText('MU 1');
  await expect(page.locator('#eqResumo')).toContainText('PR 1');
  await expect(page.locator('#eqResumo')).toContainText('Sem checklist hoje 2');
  await page.click('#eqResumo [data-st="nada"]');
  await expect(page.locator('#eqGrid [data-eq]')).toHaveCount(2);
  await page.click('#eqResumo [data-st="nada"]');
  await expect(page.locator('#eqGrid [data-eq]')).toHaveCount(5);
  await page.fill('#eqBusca', 'retro');
  await expect(page.locator('#eqGrid [data-eq]')).toHaveCount(1);
  await page.fill('#eqBusca', '');

  // Tocar num quadrado com checklist abre o checklist do dia.
  await quadrado(page, 'MU01').click();
  await expect(page.locator('#mItens')).toContainText('Freio');
});

test('operador vê os quadrados mas não cadastra nem edita', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão');
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'eq');
  await expect(page.locator('#btnNovoEq')).toBeHidden();
  await expect(quadrado(page, 'ABC1D23')).toBeVisible();
  await expect(page.locator('[data-edit-eq]')).toHaveCount(0);
  await quadrado(page, 'ABC1D23').click();
  await expect(page.locator('#toastRoot')).toContainText('ainda não fez o checklist hoje');
  // Depois do checklist, o quadrado fica verde na hora.
  await preencherChecklist(page, { placa: 'ABC1D23' });
  await aba(page, 'eq');
  await expect(quadrado(page, 'ABC1D23')).toHaveClass(/st-ok/);
});

test('cadastros não tem mais a lista de equipamentos', async ({ page }) => {
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'cad');
  await expect(page.locator('#v-cad')).not.toContainText('Placa / prefixo');
  await expect(page.locator('#cfgItens tr')).toHaveCount(50);
});
