// Ocorrências separadas em MU e PR: quantas vezes o item foi marcado urgente e quantas para programar.
const { test, expect, criarConta, equipamento, gravar, gravarVarios, listar, como, entrar, aba, preencherChecklist, diasAtras, hojeISO } = require('./ajuda');

test('divergência repetida conta MU e PR separados e mostra no requerimento e na OS', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await preencherChecklist(page, { placa: 'ABC1D23', data: diasAtras(2), divergencias: [[6, 'PR', 'Vazamento pequeno']] });
  await expect.poll(async () => (await listar('requerimentos'))[0]).toMatchObject({ ocorrencias: 1, ocorrMU: 0, ocorrPR: 1 });
  await preencherChecklist(page, { placa: 'ABC1D23', data: diasAtras(1), divergencias: [[6, 'PR', 'Continua']] });
  await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[6, 'MU', 'Vazamento aumentou']] });
  await expect.poll(async () => (await listar('requerimentos'))[0]).toMatchObject({ ocorrencias: 3, ocorrMU: 1, ocorrPR: 2 });
  expect(await listar('requerimentos')).toHaveLength(1);

  await aba(page, 'req');
  const linha = page.locator('#reqTbody tr[data-id]');
  await expect(linha.locator('.ocorr')).toHaveText('MU 1 · PR 2');
  await linha.click();
  await expect(page.locator('#modalRoot .kv')).toContainText('Ocorrências3 (MU 1 · PR 2)');
});

test('requerimento antigo (sem a separação) continua a conta pelo que já tinha', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão');
  const agora = Date.now();
  await gravar('requerimentos/VELHO', {
    codigo: 'REQ-VELHO', criadoEm: new Date(agora - 5 * 864e5), criadoEmLocal: agora - 5 * 864e5, criadoPor: 'x', inspecaoId: 'x', inspecoes: [],
    placa: 'ABC1D23', equipamento: 'Caminhão', itemNumero: 6, itemNome: 'VAZAMENTO DAS MANGUEIRAS', classificacao: 'PR - Programar revisão',
    prioridade: 'NORMAL', descricao: 'antigo', responsavel: '', status: 'Aberto', numeroOS: '', fechadoEm: null, ocorrencias: 2, ultimaOcorrencia: agora - 864e5,
  });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[6, 'MU', 'Piorou']] });
  await expect.poll(async () => (await listar('requerimentos')).find(r => r.codigo === 'REQ-VELHO')).toMatchObject({ ocorrencias: 3, ocorrMU: 1, ocorrPR: 2 });
});

test('relatório do equipamento e resumo mostram MU e PR por item', async ({ page }) => {
  await equipamento('REL01', 'Caminhão basculante', { tipoMedidor: 'KM', medidorAtual: 1000 });
  const quando = n => new Date(Date.now() - n * 864e5);
  const req = (id, extra) => ['requerimentos/' + id, {
    codigo: 'REQ-' + id, placa: 'REL01', equipamento: 'x', itemNumero: 23, itemNome: 'FREIOS', classificacao: 'MU - Manutenção urgente', prioridade: 'ALTA',
    status: 'Concluído', criadoEm: quando(6), criadoEmLocal: quando(6).getTime(), fechadoEm: quando(4), responsavel: '', numeroOS: '', ...extra,
  }];
  await gravarVarios([
    ['inspecoes/REL01_' + hojeISO(), { codigo: 'CHK-1', placaId: 'REL01', placa: 'REL01', equipamento: 'x', dataInspecao: hojeISO(), avaliador: 'Op', liberado: 'SIM', kmHrValor: 1000, contagem: { OK: 50, MU: 0, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: Date.now() }],
    // O mesmo item em duas OS: uma já fechada (2 MU, 1 PR) e uma aberta (1 PR).
    req('A', { ocorrencias: 3, ocorrMU: 2, ocorrPR: 1 }),
    req('B', { ocorrencias: 1, ocorrMU: 0, ocorrPR: 1, status: 'Aberto', fechadoEm: null, criadoEm: quando(2), criadoEmLocal: quando(2).getTime(), classificacao: 'PR - Programar revisão' }),
  ]);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await page.locator('#eqGrid [data-eq="REL01"]').click();
  const barra = page.locator('#relDados .hbar').first();
  await expect(barra).toContainText('23 · FREIOS');
  await expect(barra.locator('.v')).toHaveText('4 MU 2 · PR 2');

  await page.keyboard.press('Escape');
  await expect(page.locator('#relDados')).toBeHidden();
  await page.evaluate(() => { window.print = () => {}; });
  await aba(page, 'rel');
  await page.selectOption('#rlRapido', '30');
  await page.click('[data-rel="resumo"]');
  const tr = page.locator('#printRoot .pr-2col tr', { hasText: '23 · FREIOS' });
  await expect(tr.locator('td')).toHaveText(['23 · FREIOS', '2', '2', '4']);
});

test('regras: a conta de MU / PR só sobe de 1 em 1 junto com a ocorrência', async () => {
  await equipamento('ABC1D23', 'Caminhão');
  const op = await criarConta('Op', 'op@teste.com');
  const base = { status: 'Aberto', ocorrencias: 1, ocorrMU: 1, ocorrPR: 0, itemNumero: 23, descricao: 'x', numeroOS: '' };
  await gravar('requerimentos/R1', base);
  const tentar = (dia, mudanca) => {
    const id = 'ABC1D23_' + dia;
    return como(op).lote([
      { caminho: 'inspecoes/' + id, novo: true, horaServidor: ['criadoEm'], dados: { criadoPor: op.uid, placaId: 'ABC1D23', dataInspecao: dia, respostas: [] } },
      { caminho: 'requerimentos/R1', dados: { ...base, ocorrencias: 2, ultimaInspecao: id, ...mudanca } },
    ]);
  };
  expect(await tentar(diasAtras(3), { ocorrMU: 3 })).toBe(403);
  expect(await tentar(diasAtras(3), { ocorrMU: 0, ocorrPR: 2 })).toBe(403);
  expect(await tentar(diasAtras(3), { ocorrPR: 1 })).toBe(200);
});
