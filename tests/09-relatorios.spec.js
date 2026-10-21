// Aba Relatórios: período, e cada relatório vira uma folha para imprimir / salvar em PDF.
const { test, expect, criarConta, equipamento, gravarVarios, entrar, aba, diasAtras, hojeISO } = require('./ajuda');

async function dados() {
  await equipamento('AAA1111', 'Caminhão basculante', { tipoMedidor: 'KM', medidorAtual: 9000, equipe: 'Terra' });
  await equipamento('BBB2222', 'Retroescavadeira', { tipoMedidor: 'HR', medidorAtual: 500 });
  const quando = n => new Date(Date.now() - n * 864e5);
  const insp = (placa, n, lib, km, mu = 0) => ['inspecoes/' + placa + '_' + diasAtras(n), {
    codigo: 'CHK-' + placa + n, placaId: placa, placa, equipamento: 'x', dataInspecao: n ? diasAtras(n) : hojeISO(), avaliador: 'Op',
    liberado: lib, kmHrValor: km, contagem: { OK: 50 - mu, MU: mu, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: quando(n).getTime(),
  }];
  const req = (id, placa, n, extra) => ['requerimentos/' + id, {
    codigo: 'REQ-' + id, placa, equipamento: 'x', itemNumero: 23, itemNome: 'FREIOS', classificacao: 'MU - Manutenção urgente', prioridade: 'ALTA',
    status: 'Aberto', ocorrencias: 1, criadoEm: quando(n), criadoEmLocal: quando(n).getTime(), fechadoEm: null, responsavel: '', numeroOS: '', ...extra,
  }];
  await gravarVarios([
    // AAA: liberado, parado 2 dias, liberado. BBB: só um checklist, não liberado (parado agora).
    insp('AAA1111', 4, 'SIM', 9000), insp('AAA1111', 3, 'NÃO', 9100, 1), insp('AAA1111', 1, 'SIM', 9300), insp('AAA1111', 0, 'SIM', 9400),
    insp('BBB2222', 2, 'NÃO', 480, 1),
    req('R1', 'AAA1111', 3, { status: 'Concluído', numeroOS: 'OS-1', fechadoEm: quando(1), custoPecas: 800, custoMaoObra: 200, responsavel: 'Carlos' }),
    req('R2', 'BBB2222', 2, { status: 'OS aberta', numeroOS: 'OS-2', responsavel: 'Carlos', itemNumero: 6, itemNome: 'VAZAMENTO DAS MANGUEIRAS' }),
    ['preventivas/P1', { placaId: 'AAA1111', placa: 'AAA1111', nome: 'Troca de óleo', intervalo: 10000, ultimaFeita: 0, ultimaEm: quando(30) }],
  ]);
}

test('relatórios: gestor escolhe o período e gera cada um em PDF', async ({ page }) => {
  await dados();
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await page.evaluate(() => { window.__impressoes = 0; window.print = () => { window.__impressoes++; }; });
  await aba(page, 'rel');
  await expect(page.locator('#rlLista [data-rel]')).toHaveCount(6);
  await page.selectOption('#rlRapido', '30');
  await expect(page.locator('#rlDe')).toHaveValue(diasAtras(29));
  await expect(page.locator('#rlAte')).toHaveValue(hojeISO());
  await page.fill('#rlDe', diasAtras(4));
  await expect(page.locator('#rlRapido')).toHaveValue('');

  const folha = page.locator('#printRoot');
  const gerar = async (id, vezes) => {
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    await page.click(`[data-rel="${id}"]`);
    await expect.poll(() => page.evaluate(() => window.__impressoes)).toBe(vezes);
    await expect(folha.locator('.pr-rel')).toHaveAttribute('data-rel', id);
  };

  await gerar('resumo', 1);
  await expect(folha).toContainText('RESUMO DO PERÍODO');
  await expect(folha.locator('.pr-kpis')).toContainText('Checklists feitos5');
  await expect(folha.locator('.pr-kpis')).toContainText('Disponibilidade da frota60%');
  await expect(folha.locator('.pr-kpis')).toContainText('Custo de manutençãoR$ 1.000,00');
  await expect(folha.locator('.pr-kpis')).toContainText('Parados agora1');
  await expect(folha.locator('.pr-kpis')).toContainText('Preventivas vencidas0');
  await expect(folha).toContainText('23 · FREIOS');
  // O pior equipamento vem primeiro.
  await expect(folha.locator('.pr-tab tbody tr').first()).toContainText('BBB2222');
  expect(await page.title()).toBe('Resumo do período ' + [diasAtras(4), hojeISO()].map(d => d.split('-').reverse().join('-')).join(' a '));

  await gerar('ranking', 2);
  const linhaA = folha.locator('tr', { hasText: 'AAA1111' });
  await expect(linhaA).toContainText('4/5');
  await expect(linhaA).toContainText('75%');
  await expect(linhaA).toContainText('400 km');
  await expect(linhaA).toContainText('R$ 1.000,00');

  await gerar('custos', 3);
  await expect(folha.locator('.pr-kpis')).toContainText('PeçasR$ 800,00');
  await expect(folha.locator('.pr-kpis')).toContainText('Mão de obraR$ 200,00');
  await expect(folha).toContainText('OS-1');

  await gerar('falta', 4);
  await expect(folha.locator('.pr-kpis')).toContainText('Checklists esperados10');
  await expect(folha.locator('.pr-kpis')).toContainText('Dias sem checklist5');
  await expect(folha.locator('tr', { hasText: 'BBB2222' })).toContainText(diasAtras(4).split('-').reverse().join('/').slice(0, 5));

  await gerar('abertas', 5);
  await expect(folha).toContainText('Situação em');
  await expect(folha.locator('.pr-tab tbody tr')).toHaveCount(1);
  await expect(folha.locator('.pr-tab')).toContainText('OS-2');

  await gerar('preventivas', 6);
  await expect(folha.locator('tr', { hasText: 'Troca de óleo' })).toContainText('Chegando');
  await expect(folha.locator('tr', { hasText: 'Troca de óleo' })).toContainText('600 km');

  // Período invertido não gera.
  await page.fill('#rlDe', hojeISO());
  await page.fill('#rlAte', diasAtras(3));
  await page.click('[data-rel="resumo"]');
  await expect(page.locator('#toastRoot')).toContainText('período válido');
  expect(await page.evaluate(() => window.__impressoes)).toBe(6);
});

test('relatórios: só o gestor vê a aba', async ({ page }) => {
  await entrar(page, await criarConta('Téc', 'tec@teste.com', 'tecnico'));
  await expect(page.locator('.tab[data-view="rel"]')).toBeHidden();
});
