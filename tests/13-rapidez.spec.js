// Relatório do equipamento abre na hora com o que o app já tem, sem esperar o histórico do servidor.
const { test, expect, criarConta, equipamento, gravarVarios, entrar, aba, diasAtras, hojeISO } = require('./ajuda');

test('relatório do equipamento abre antes da resposta do servidor', async ({ page }) => {
  await equipamento('RAP01', 'Caminhão', { tipoMedidor: 'KM', medidorAtual: 1000 });
  const insp = (n, lib) => ['inspecoes/RAP01_' + (n ? diasAtras(n) : hojeISO()), {
    codigo: 'CHK-' + n, placaId: 'RAP01', placa: 'RAP01', equipamento: 'Caminhão', dataInspecao: n ? diasAtras(n) : hojeISO(), avaliador: 'Op',
    liberado: lib, kmHrValor: 1000 + 100 * (5 - n), contagem: { OK: 50, MU: 0, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: Date.now() - n * 864e5,
  }];
  await gravarVarios([insp(2, 'SIM'), insp(1, 'NÃO'), insp(0, 'SIM')]);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await expect(page.locator('#eqGrid [data-eq="RAP01"]')).toBeVisible();

  // Servidor lento: toda conversa nova com o banco demora 6 segundos.
  let lento = true;
  await page.route(/google\.firestore\.v1\.Firestore/, async r => {
    if (lento) await new Promise(res => setTimeout(res, 6000));
    r.continue().catch(() => {});
  });
  const t0 = Date.now();
  await page.locator('#eqGrid [data-eq="RAP01"]').click();
  await expect(page.locator('#relDados .rel-kpis')).toContainText('2 de 3 checklists liberados', { timeout: 2500 });
  expect(Date.now() - t0).toBeLessThan(2500);
  lento = false;
});

test('equipamento sem checklist: depois de consultar o servidor mostra "Ainda sem checklist"', async ({ page }) => {
  await equipamento('RAP02', 'Caminhão');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await page.locator('#eqGrid [data-eq="RAP02"]').click();
  await expect(page.locator('#relDados')).toContainText('Ainda sem checklist');
});
