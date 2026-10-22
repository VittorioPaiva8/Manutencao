// Tratamento dos requerimentos: gestor, técnico (Minhas OS), histórico, número da OS e Finalizados.
const fs = require('fs');
const { test, expect, criarConta, gravar, buscar, entrar, aba } = require('./ajuda');

/** Um requerimento aberto, como se tivesse vindo de um checklist. */
async function requerimento(id, extra = {}) {
  const agora = Date.now();
  await gravar('requerimentos/' + id, {
    codigo: 'REQ-' + id, criadoEm: new Date(agora), criadoEmLocal: agora, criadoPor: 'x',
    inspecaoId: 'ABC1D23_2026-01-01', inspecaoCodigo: 'CHK-TESTE', inspecoes: ['ABC1D23_2026-01-01'], ultimaInspecao: 'ABC1D23_2026-01-01',
    equipamento: 'Caminhão basculante', placa: 'ABC1D23', kmHr: '', itemNumero: 23, itemNome: 'FREIOS',
    classificacao: 'MU - Manutenção urgente', prioridade: 'ALTA', descricao: 'Pastilha gasta', avaliador: 'Operador João',
    responsavel: '', status: 'Aberto', numeroOS: '', fechadoEm: null, ocorrencias: 1, ultimaOcorrencia: agora, ...extra,
  });
}
const linhaDoReq = (page, id) => page.locator(`tr[data-id="${id}"]`);

test('gestor encaminha a OS: sugere o próximo número, escolhe o técnico e registra no histórico', async ({ page }) => {
  const gestor = await criarConta('Gestora Ana', 'ana@teste.com', 'gestor');
  const tec = await criarConta('Carlos Técnico', 'carlos@teste.com', 'tecnico');
  await requerimento('R1', { numeroOS: 'OS-0041', status: 'Concluído', fechadoEm: new Date() });
  await requerimento('R2');
  await entrar(page, gestor);
  await aba(page, 'req');
  await linhaDoReq(page, 'R2').click();

  await page.selectOption('#mStatus', 'OS aberta');
  await expect(page.locator('#mOS')).toHaveValue('OS-0042');
  await expect(page.locator('#mResp option')).toHaveText(['Selecione', 'Carlos Técnico']);
  await page.selectOption('#mResp', tec.uid);
  await page.fill('#mObs', 'Peça pedida ao fornecedor');
  await page.click('#mSalvar');

  await expect.poll(async () => (await buscar('requerimentos/R2')).status).toBe('OS aberta');
  const r = await buscar('requerimentos/R2');
  expect(r).toMatchObject({ numeroOS: 'OS-0042', responsavel: 'Carlos Técnico', responsavelUid: tec.uid, fechadoEm: null });
  expect(r.historico).toHaveLength(1);
  expect(r.historico[0]).toMatchObject({ de: 'Aberto', status: 'OS aberta', os: 'OS-0042', resp: 'Carlos Técnico', obs: 'Peça pedida ao fornecedor', por: 'Gestora Ana', uid: gestor.uid });

  await linhaDoReq(page, 'R2').click();
  await expect(page.locator('.hist li')).toHaveCount(2);
  await expect(page.locator('.hist li').nth(1)).toContainText('Status: Aberto → OS aberta');
  await expect(page.locator('.hist li').nth(1)).toContainText('Peça pedida ao fornecedor');
  // Salvar sem mudar nada não cria linha nova no histórico.
  await page.click('#mSalvar');
  await page.waitForTimeout(500);
  expect((await buscar('requerimentos/R2')).historico).toHaveLength(1);
});

test('número da OS mantém o formato: "5/2026" vira "6/2026"; sem nenhuma OS começa em 1', async ({ page }) => {
  await requerimento('R1');
  await entrar(page, await criarConta('G', 'g@teste.com', 'gestor'));
  await aba(page, 'req');
  await linhaDoReq(page, 'R1').click();
  await page.selectOption('#mStatus', 'OS aberta');
  await expect(page.locator('#mOS')).toHaveValue('1');
  await page.click('#mCancelar');
  await gravar('requerimentos/R0', { codigo: 'REQ-R0', status: 'Concluído', numeroOS: '5/2026', criadoEmLocal: 1, fechadoEm: new Date() });
  await page.reload();
  await page.locator('#telaApp').waitFor();
  await aba(page, 'req');
  await linhaDoReq(page, 'R1').click();
  await page.selectOption('#mStatus', 'OS aberta');
  await expect(page.locator('#mOS')).toHaveValue('6/2026');
});

test('técnico vê as OS dele em Minhas OS, conclui e não consegue mexer no resto', async ({ page }) => {
  const tec = await criarConta('Carlos Técnico', 'carlos@teste.com', 'tecnico');
  await requerimento('R1', { status: 'OS aberta', numeroOS: '7', responsavel: 'Carlos Técnico', responsavelUid: tec.uid });
  await requerimento('R2', { status: 'OS aberta', numeroOS: '8', responsavel: 'Outro', responsavelUid: 'outro-uid' });
  await entrar(page, tec);
  await expect(page.locator('#minhasBadge')).toHaveText('1');
  await aba(page, 'minhas');
  await expect(page.locator('#minhasTbody tr[data-id]')).toHaveCount(1);
  await linhaDoReq(page.locator('#minhasTbody'), 'R1').click();

  // Tratamento (status, nº da OS, responsável, custos) não aparece para o técnico: só a situação em texto.
  await expect(page.locator('#mTratamento, #mStatus, #mOS, #mResp, #mCustoPecas, #mCustoMO')).toHaveCount(0);
  await expect(page.locator('#modalRoot .kv')).toContainText('StatusOS aberta');
  await expect(page.locator('#modalRoot .kv')).toContainText('Nº da OS7');
  await page.fill('#mObs', 'Troquei as pastilhas');
  await page.click('#mPronto');
  await expect.poll(async () => (await buscar('requerimentos/R1')).status).toBe('Concluído');
  const r = await buscar('requerimentos/R1');
  expect(r.fechadoEm).toBeInstanceOf(Date);
  expect(r.historico[0]).toMatchObject({ de: 'OS aberta', status: 'Concluído', obs: 'Troquei as pastilhas', uid: tec.uid });
  await expect(page.locator('#minhasBadge')).toBeHidden();
  await page.selectOption('#mnFiltro', 'Concluído');
  await expect(page.locator('#minhasTbody tr[data-id]')).toHaveCount(1);

  // OS de outro técnico abre só para leitura.
  await aba(page, 'req');
  await page.selectOption('#rStatus', '');
  await linhaDoReq(page, 'R2').click();
  await expect(page.locator('#mSalvar')).toHaveCount(0);
});

test('operador só consulta os requerimentos', async ({ page }) => {
  await requerimento('R1');
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'req');
  await linhaDoReq(page, 'R1').click();
  await expect(page.locator('#mTratamento, #mStatus, #mObs, #mPronto')).toHaveCount(0);
  await expect(page.locator('#mSalvar')).toHaveCount(0);
  await expect(page.locator('.hist li')).toHaveCount(1);
});

test('filtros da lista de requerimentos', async ({ page }) => {
  await requerimento('R1', { prioridade: 'ALTA', placa: 'AAA1111' });
  await requerimento('R2', { prioridade: 'NORMAL', placa: 'BBB2222' });
  await requerimento('R3', { status: 'Cancelado', fechadoEm: new Date() });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'req');
  await expect(page.locator('#reqTbody tr[data-id]')).toHaveCount(2);
  await page.selectOption('#rPrio', 'NORMAL');
  await expect(page.locator('#reqTbody tr[data-id]')).toHaveCount(1);
  await page.selectOption('#rPrio', '');
  await page.fill('#rBusca', 'aaa1');
  await expect(page.locator('#reqTbody tr[data-id]')).toHaveCount(1);
  await page.fill('#rBusca', '');
  await page.selectOption('#rStatus', '');
  await expect(page.locator('#reqTbody tr[data-id]')).toHaveCount(3);
});

test('concluído vai para Finalizados com KPIs, gráficos e exportação CSV', async ({ page }) => {
  const g = await criarConta('Gestora', 'g@teste.com', 'gestor');
  const dias = n => new Date(Date.now() - n * 864e5);
  await requerimento('R1', { status: 'Concluído', criadoEm: dias(4), fechadoEm: dias(0), numeroOS: '10', responsavel: 'Carlos' });
  await requerimento('R2', { status: 'Cancelado', criadoEm: dias(2), fechadoEm: dias(0) });
  await requerimento('R3');
  await entrar(page, g);
  await aba(page, 'fin');
  await expect(page.locator('#finTbody tr[data-id]')).toHaveCount(2);
  await expect(page.locator('#finKpis')).toContainText('Finalizados2');
  await expect(page.locator('#finKpis')).toContainText('Concluídos1');
  await expect(page.locator('#finKpis')).toContainText('4 d');
  await expect(page.locator('#finCharts .block')).toHaveCount(3);
  await page.selectOption('#fStatus', 'Concluído');
  await expect(page.locator('#finTbody tr[data-id]')).toHaveCount(1);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnFinCsv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  expect(csv).toContain('"Requerimento";"Abertura"');
  expect(csv).toContain('"REQ-R1"');
  expect(csv).not.toContain('"REQ-R2"');

  // Reabrir tira de Finalizados.
  await linhaDoReq(page, 'R1').click();
  await page.selectOption('#mStatus', 'OS aberta');
  await page.click('#mSalvar');
  await expect.poll(async () => (await buscar('requerimentos/R1')).fechadoEm).toBeNull();
  await expect(page.locator('#finTbody tr[data-id]')).toHaveCount(0);
});
