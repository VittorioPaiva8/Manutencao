// Cadastros (itens do checklist), painel do dia, inspeções, paginação e backup.
const fs = require('fs');
const { test, expect, criarConta, equipamento, gravar, gravarVarios, buscar, listar, entrar, aba, preencherChecklist, responderPrompt, hojeISO, diasAtras } = require('./ajuda');

test.describe('gestor', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor')); });

  test('itens do checklist: adiciona, renomeia, desativa, marca crítico, exclui e restaura', async ({ page }) => {
    await aba(page, 'cad');
    await page.fill('#novoItemNome', 'giroflex');
    await page.click('#btnNovoItem');
    await expect.poll(async () => (await buscar('config/checklist'))?.extras).toEqual([{ numero: 51, nome: 'GIROFLEX' }]);
    await aba(page, 'check');
    // Itens novos entram antes do item 50 (liberação).
    const ordem = await page.locator('#itens .item .n').allTextContents();
    expect(ordem.slice(-2)).toEqual(['51', '50']);

    await aba(page, 'cad');
    responderPrompt(page, 'Nível do óleo do motor');
    await page.click('[data-edit-item="1"]');
    await expect.poll(async () => (await buscar('config/checklist')).nomes).toEqual({ 1: 'NÍVEL DO ÓLEO DO MOTOR' });

    await page.uncheck('[data-ativo="2"]');
    await expect.poll(async () => (await buscar('config/checklist')).inativos).toEqual([2]);
    await page.check('[data-crit="3"]');
    await expect.poll(async () => (await buscar('config/checklist')).criticos).toEqual([3]);

    await page.click('[data-del-item="4"]');
    await expect.poll(async () => (await buscar('config/checklist')).removidos).toEqual([4]);
    await aba(page, 'check');
    await expect(page.locator('#it1 .nome')).toHaveText('NÍVEL DO ÓLEO DO MOTOR');
    await expect(page.locator('#it2')).toHaveCount(0);
    await expect(page.locator('#it3 .crit')).toBeVisible();
    await expect(page.locator('#it4')).toHaveCount(0);
    await expect(page.locator('#cFalta')).toHaveText('49');

    await aba(page, 'cad');
    await page.click('#restaurarItens');
    await expect.poll(async () => (await buscar('config/checklist')).removidos).toEqual([]);
  });

  test('painel do dia mostra quem fez checklist hoje e quem está sem liberação', async ({ page }) => {
    await equipamento('AAA1111', 'Caminhão');
    await equipamento('BBB2222', 'Retro');
    await equipamento('CCC3333', 'Pá carregadeira');
    expect((await preencherChecklist(page, { placa: 'AAA1111', divergencias: [[23, 'MU', 'Freio']] })).ok).toBe(true);
    expect((await preencherChecklist(page, { placa: 'BBB2222' })).ok).toBe(true);
    await aba(page, 'dia');
    await expect(page.locator('#diaKpis')).toContainText('Checklist hoje2de 3');
    await expect(page.locator('#diaKpis')).toContainText('Sem checklist1');
    await expect(page.locator('#diaKpis')).toContainText('Não liberados1');
    await expect(page.locator('#diaBadge')).toHaveText('1');
    const linhas = page.locator('#diaTbody tr');
    // Não liberados primeiro, depois os que faltam, depois os feitos.
    await expect(linhas.nth(0)).toContainText('AAA1111');
    await expect(linhas.nth(0)).toContainText('NÃO');
    await expect(linhas.nth(1)).toContainText('CCC3333');
    await expect(linhas.nth(1)).toContainText('Falta');
    await page.selectOption('#dFiltro', 'falta');
    await expect(linhas).toHaveCount(1);
    await page.selectOption('#dFiltro', 'os');
    await expect(linhas).toHaveCount(1);
    await page.selectOption('#dFiltro', '');
    await linhas.nth(0).click();
    await expect(page.locator('#mItens')).toContainText('FREIOS');
  });

  test('inspeções: abre o checklist completo com filtro "Só divergências"', async ({ page }) => {
    await equipamento('AAA1111', 'Caminhão');
    await preencherChecklist(page, { placa: 'AAA1111', divergencias: [[23, 'MU', 'Freio fraco'], [6, 'PR', 'Vaza']] });
    await aba(page, 'insp');
    await page.click('#inspTbody tr[data-id]');
    await expect(page.locator('#mSoDiv')).toBeChecked();
    await expect(page.locator('#mItens tr')).toHaveCount(2);
    await expect(page.locator('#mItens')).toContainText('Freio fraco');
    await page.uncheck('#mSoDiv');
    await expect(page.locator('#mItens tr')).toHaveCount(50);
  });

  test('listas com mais de 50 linhas são paginadas', async ({ page }) => {
    await equipamento('AAA1111', 'Caminhão');
    const agora = Date.now();
    await gravarVarios(Array.from({ length: 60 }, (_, i) => ['inspecoes/AAA1111_' + i, {
      codigo: 'CHK-' + String(i).padStart(3, '0'), dataInspecao: hojeISO(), placa: 'AAA1111', placaId: 'AAA1111', equipamento: 'Caminhão',
      avaliador: 'Op', liberado: 'SIM', contagem: { OK: 50, MU: 0, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: agora - i * 1000, criadoPor: 'x',
    }]));
    await aba(page, 'insp');
    await expect(page.locator('#inspTbody tr[data-id]')).toHaveCount(50);
    await expect(page.locator('#pg-insp')).toContainText('1–50 de 60');
    await page.click('#pg-insp [data-pg="1"]');
    await expect(page.locator('#inspTbody tr[data-id]')).toHaveCount(10);
    await expect(page.locator('#pg-insp')).toContainText('Página 2 de 2');
  });

  test('backup baixa uma planilha Excel com todas as abas', async ({ page }) => {
    await equipamento('AAA1111', 'Caminhão');
    await preencherChecklist(page, { placa: 'AAA1111', divergencias: [[23, 'MU', 'Freio']] });
    await expect.poll(() => listar('requerimentos')).toHaveLength(1);
    await aba(page, 'cad');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackup')]);
    expect(dl.suggestedFilename()).toBe('backup-checklist-' + hojeISO() + '.xlsx');
    // O arquivo é um zip sem compressão: dá para conferir o conteúdo como texto.
    const xlsx = fs.readFileSync(await dl.path()).toString('utf8');
    expect(xlsx.startsWith('PK')).toBe(true);
    for (const t of ['Inspeções', 'Itens das inspeções', 'Requerimentos', 'Histórico das OS', 'Equipamentos', 'Itens do checklist', 'Usuários']) {
      expect(xlsx).toContain('<sheet name="' + t + '"');
    }
    expect(xlsx).toContain('AAA1111');
    expect(xlsx).toContain('Freio');
    await expect(page.locator('#backupInfo')).toContainText('1 inspeções e 1 requerimentos');
  });
});

test('KM do cadastro: operador só aumenta pela leitura do checklist; gestor corrige para qualquer valor', async ({ page, novaJanela }) => {
  await equipamento('KMM1A11', 'Caminhão', { tipoMedidor: 'KM', medidorAtual: 500 });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  expect((await preencherChecklist(page, { placa: 'KMM1A11', km: 800, data: diasAtras(1) })).ok).toBe(true);
  await expect.poll(async () => (await buscar('equipamentos/KMM1A11')).medidorAtual).toBe(800);
  const g = await novaJanela();
  await entrar(g, await criarConta('G', 'g@teste.com', 'gestor'));
  await aba(g, 'eq');
  await g.click('[data-edit-eq="KMM1A11"]');
  await g.fill('#eqMedidor', '100');
  await g.click('#eqBtn');
  await expect.poll(async () => (await buscar('equipamentos/KMM1A11')).medidorAtual).toBe(100);
});
