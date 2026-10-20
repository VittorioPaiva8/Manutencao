// Aba Equipamentos: cadastro pelo modal e quadrados coloridos pelo checklist do dia
// (verde aprovado, vermelho MU, amarelo PR, cinza sem checklist hoje).
const { test, expect, criarConta, equipamento, buscar, gravarVarios, entrar, aba, preencherChecklist, diasAtras, hojeISO } = require('./ajuda');

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

  // Tocar num quadrado abre o relatório; dali dá para ver o checklist do dia.
  await quadrado(page, 'MU01').click();
  await page.click('#relHoje');
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
  await expect(page.locator('#relDados')).toContainText('Ainda sem checklist');
  await expect(page.locator('#relHoje')).toHaveCount(0);
  await expect(page.locator('#relEditar')).toHaveCount(0);
  await page.click('#mCancelar');
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

test('relatório do equipamento: disponibilidade, tempo parado, uso médio, OS e últimos 30 dias', async ({ page }) => {
  await equipamento('REL01', 'Caminhão basculante', { tipoMedidor: 'KM', medidorAtual: 1000 });
  // Histórico: liberado, parado 3 dias (MU), liberado, parado 2 dias, liberado.
  const hist = [[10, 'SIM', 1000], [8, 'NÃO', 1100, 1], [6, 'NÃO', 1150, 1], [5, 'SIM', 1300], [3, 'NÃO', 1400, 0, 1], [1, 'SIM', 1500], [0, 'SIM', 1600]];
  const dia = n => n ? diasAtras(n) : hojeISO();
  const quando = n => new Date(Date.now() - n * 864e5);
  await gravarVarios([
    ...hist.map(([n, lib, km, mu = 0, pr = 0], k) => ['inspecoes/REL01_' + dia(n), {
      codigo: 'CHK-' + k, placaId: 'REL01', placa: 'REL01', equipamento: 'Caminhão basculante', dataInspecao: dia(n), avaliador: 'Op',
      liberado: lib, kmHrValor: km, kmHrTipo: 'KM', kmHr: km + ' km', contagem: { OK: 50 - mu - pr, MU: mu, PR: pr, NA: 0 }, respostas: [], criadoEmLocal: quando(n).getTime(),
    }]),
    ['requerimentos/R1', { codigo: 'REQ-1', placa: 'REL01', itemNumero: 23, itemNome: 'FREIOS', classificacao: 'MU - Manutenção urgente', status: 'Concluído', ocorrencias: 2, criadoEm: quando(8), criadoEmLocal: quando(8).getTime(), fechadoEm: quando(5) }],
    ['requerimentos/R2', { codigo: 'REQ-2', placa: 'REL01', itemNumero: 6, itemNome: 'VAZAMENTO DAS MANGUEIRAS', classificacao: 'PR - Programar revisão', status: 'OS aberta', ocorrencias: 1, criadoEm: quando(3), criadoEmLocal: quando(3).getTime(), fechadoEm: null, responsavel: 'Carlos' }],
    ['requerimentos/OUTRO', { codigo: 'REQ-X', placa: 'OUTRA', itemNumero: 1, itemNome: 'X', classificacao: 'MU - Manutenção urgente', status: 'Aberto', ocorrencias: 1, criadoEm: quando(1), criadoEmLocal: quando(1).getTime() }],
  ]);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await quadrado(page, 'REL01').click();
  const kpis = page.locator('#relDados .rel-kpis');
  await expect(kpis).toContainText('Disponibilidade57%4 de 7 checklists liberados');
  await expect(kpis).toContainText('Tempo médio parado2,5 dias2 paradas · 5 dias no total');
  await expect(kpis).toContainText('Uso médio60 km/dia600 km no período · 100 km por checklist');
  await expect(kpis).toContainText('Checklists feitos7 de 30');
  await expect(kpis).toContainText('OS no período2MU 1 · PR 1 · 1 em aberto agora');
  await expect(kpis).toContainText('Tempo médio da OS3 dias1 concluída(s)');
  await expect(page.locator('#relDados')).not.toContainText('Parado há');

  // Faixa dos últimos 30 dias: uma cor por dia.
  await expect(page.locator('.rel-faixa span')).toHaveCount(30);
  await expect(page.locator('.rel-faixa span.tem')).toHaveCount(7);
  await expect(page.locator('.rel-faixa span').last()).toHaveClass(/st-ok/);
  await expect(page.locator(`.rel-faixa [data-dia="${diasAtras(8)}"]`)).toHaveClass(/st-mu/);
  await expect(page.locator(`.rel-faixa [data-dia="${diasAtras(3)}"]`)).toHaveClass(/st-pr/);
  await expect(page.locator('.rel-graf')).toBeVisible();

  await expect(page.locator('#relDados .hbar').first()).toContainText('23 · FREIOS');
  await expect(page.locator('#relDados .rel-os li')).toHaveCount(1);
  await page.locator('#relDados .rel-os li').click();
  await expect(page.locator('#mStatus')).toHaveValue('OS aberta');
});

test('relatório avisa quando o equipamento está parado agora', async ({ page }) => {
  await equipamento('PAR01', 'Retro');
  await gravarVarios([
    ['inspecoes/PAR01_a', { codigo: 'C1', placaId: 'PAR01', dataInspecao: diasAtras(4), liberado: 'SIM', contagem: { OK: 50 }, respostas: [], criadoEmLocal: 1 }],
    ['inspecoes/PAR01_b', { codigo: 'C2', placaId: 'PAR01', dataInspecao: diasAtras(2), liberado: 'NÃO', contagem: { OK: 49, MU: 1 }, respostas: [], criadoEmLocal: 2 }],
  ]);
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'eq');
  await quadrado(page, 'PAR01').click();
  await expect(page.locator('#relDados .callout')).toContainText('Parado há 2 dias');
  await expect(page.locator('#relDados .rel-kpis')).toContainText('Disponibilidade50%');
  await page.selectOption('#relPer', '0');
  await expect(page.locator('#relDados .rel-kpis')).toContainText('Checklists feitos2 de 5');
});
