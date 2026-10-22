// Tratamento da OS (status, nº da OS, responsável e custos) é só do gestor; o técnico registra o serviço.
const { test, expect, criarConta, gravar, buscar, entrar, aba } = require('./ajuda');

async function requerimento(id, extra = {}) {
  const agora = Date.now();
  await gravar('requerimentos/' + id, {
    codigo: 'REQ-' + id, criadoEm: new Date(agora), criadoEmLocal: agora, criadoPor: 'x', inspecaoId: 'ABC1D23_2026-01-01', inspecaoCodigo: 'CHK-TESTE',
    inspecoes: ['ABC1D23_2026-01-01'], equipamento: 'Caminhão basculante', placa: 'ABC1D23', kmHr: '', itemNumero: 23, itemNome: 'FREIOS',
    classificacao: 'MU - Manutenção urgente', prioridade: 'ALTA', descricao: 'Pastilha gasta', avaliador: 'Op', responsavel: '', status: 'Aberto',
    numeroOS: '', fechadoEm: null, ocorrencias: 1, ultimaOcorrencia: agora, ...extra,
  });
}

test('técnico salva só a observação sem concluir, e não vê custo na OS, no histórico nem no PDF', async ({ page }) => {
  const tec = await criarConta('Carlos Técnico', 'tec@teste.com', 'tecnico');
  await requerimento('R1', {
    status: 'OS aberta', numeroOS: '8', responsavel: 'Carlos Técnico', responsavelUid: tec.uid, custoPecas: 500, custoMaoObra: 100,
    historico: [{ em: Date.now() - 1000, por: 'Gestora', uid: 'g', de: 'Aberto', status: 'OS aberta', osAntes: '', os: '8', respAntes: '', resp: 'Carlos Técnico', custoAntes: null, custo: 600, obs: '' }],
  });
  await entrar(page, tec);
  await page.evaluate(() => { window.print = () => {}; });
  await aba(page, 'minhas');
  await page.click('#minhasTbody tr[data-id="R1"]');
  await expect(page.locator('#mTratamento')).toHaveCount(0);
  await expect(page.locator('#modalRoot')).not.toContainText('R$');
  await expect(page.locator('#modalRoot')).not.toContainText('Custo');

  await page.click('#mImprimir');
  await expect(page.locator('#printRoot .pr-folha')).toBeAttached();
  await expect(page.locator('#printRoot')).toContainText('FREIOS');
  await expect(page.locator('#printRoot')).not.toContainText('Custo');
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));

  await page.fill('#mObs', 'Aguardando peça');
  await page.click('#mSalvar');
  await expect.poll(async () => ((await buscar('requerimentos/R1')).historico || []).length).toBe(2);
  const r = await buscar('requerimentos/R1');
  expect(r.status).toBe('OS aberta');
  expect(r.historico[1]).toMatchObject({ obs: 'Aguardando peça', uid: tec.uid, status: 'OS aberta' });
});

test('gestor continua vendo e editando o tratamento completo', async ({ page }) => {
  await requerimento('R1', { custoPecas: 500 });
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'req');
  await page.click('tr[data-id="R1"]');
  await expect(page.locator('#mTratamento')).toBeVisible();
  for (const s of ['#mStatus', '#mOS', '#mResp', '#mCustoPecas', '#mCustoMO', '#mObs']) await expect(page.locator(s)).toBeEditable();
  await expect(page.locator('#mPronto')).toHaveCount(0);
  await expect(page.locator('#modalRoot .kv')).toContainText('R$ 500,00');
});
