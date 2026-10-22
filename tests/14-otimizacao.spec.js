// Otimizações de consulta ao banco: o que só uma aba usa é baixado quando ela abre, e os relatórios
// buscam só o período (sem baixar todos os requerimentos de uma vez).
const { test, expect, criarConta, equipamento, gravarVarios, entrar, aba, diasAtras, hojeISO } = require('./ajuda');

/** Guarda o que o app pede ao banco (consultas novas), já decodificado. */
function espiarConsultas(page) {
  const lista = [];
  page.on('request', r => {
    const d = r.postData();
    // Um envio pode levar várias consultas juntas: separa uma por item.
    if (d && /firestore/i.test(r.url()) && d.includes('addTarget')) lista.push(...decodeURIComponent(d.replace(/\+/g, ' ')).split('addTarget').slice(1));
  });
  return lista;
}

test('finalizados só são baixados quando o gestor abre a aba', async ({ page }) => {
  const consultas = espiarConsultas(page);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'req');
  await page.waitForTimeout(1500);
  const finalizados = () => consultas.filter(c => c.includes('"fechadoEm"') && c.includes('"limit":1000'));
  expect(finalizados()).toHaveLength(0);
  await aba(page, 'fin');
  await expect.poll(() => finalizados().length).toBe(1);
  // Voltar à aba não abre outra consulta.
  await aba(page, 'req');
  await aba(page, 'fin');
  await page.waitForTimeout(500);
  expect(finalizados()).toHaveLength(1);
});

test('relatório busca só o período, inclui OS antigas ainda abertas e reaproveita a busca', async ({ page }) => {
  await equipamento('AAA1111', 'Caminhão', { tipoMedidor: 'KM', medidorAtual: 1000 });
  const quando = n => new Date(Date.now() - n * 864e5);
  const req = (id, n, extra) => ['requerimentos/' + id, {
    codigo: 'REQ-' + id, placa: 'AAA1111', equipamento: 'x', itemNumero: 23, itemNome: 'FREIOS', classificacao: 'MU - Manutenção urgente', prioridade: 'ALTA',
    status: 'Aberto', ocorrencias: 1, criadoEm: quando(n), criadoEmLocal: quando(n).getTime(), fechadoEm: null, responsavel: '', numeroOS: '', ...extra,
  }];
  await gravarVarios([
    ['inspecoes/AAA1111_' + hojeISO(), { codigo: 'CHK-1', placaId: 'AAA1111', placa: 'AAA1111', equipamento: 'x', dataInspecao: hojeISO(), avaliador: 'Op', liberado: 'SIM', kmHrValor: 1000, contagem: { OK: 50, MU: 0, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: Date.now() }],
    // Aberta há 200 dias e ainda em aberto: entra em "OS em aberto".
    req('VELHA', 200, { status: 'OS aberta', numeroOS: 'OS-VELHA' }),
    // Aberta e fechada há 200 dias, com custo: fora do período, não entra nos custos.
    req('FORA', 200, { status: 'Concluído', numeroOS: 'OS-FORA', fechadoEm: quando(190), custoPecas: 999 }),
    // Aberta antes do período e fechada dentro dele: entra nos custos.
    req('DENTRO', 60, { status: 'Concluído', numeroOS: 'OS-DENTRO', fechadoEm: quando(5), custoPecas: 300 }),
  ]);
  const consultas = espiarConsultas(page);
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await page.evaluate(() => { window.print = () => {}; });
  await aba(page, 'rel');
  await page.selectOption('#rlRapido', '30');
  const folha = page.locator('#printRoot');

  await page.click('[data-rel="abertas"]');
  await expect(folha.locator('.pr-tab')).toContainText('OS-VELHA');
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await page.click('[data-rel="custos"]');
  await expect(folha.locator('.pr-rel')).toHaveAttribute('data-rel', 'custos');
  await expect(folha).toContainText('OS-DENTRO');
  await expect(folha).not.toContainText('OS-FORA');
  await expect(folha.locator('.pr-kpis')).toContainText('PeçasR$ 300,00');

  // Nenhuma consulta pede a coleção inteira de requerimentos sem filtro.
  const doRelatorio = consultas.filter(c => c.includes('"collectionId":"requerimentos"') && !c.includes('"limit"'));
  expect(doRelatorio.every(c => c.includes('"where"') || c.includes('"fieldFilter"') || c.includes('"compositeFilter"'))).toBe(true);
  // Os dois relatórios do mesmo período usaram a mesma busca (3 consultas de requerimentos, não 6).
  expect(consultas.filter(c => c.includes('"collectionId":"requerimentos"') && c.includes('GREATER_THAN_OR_EQUAL')).length).toBe(2);
});
