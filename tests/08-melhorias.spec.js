// Correção do KM pelo gestor, preventivas por KM / horímetro, foto do serviço pronto,
// impressão em PDF do checklist e da OS, e avisos no aparelho.
const { test, expect, criarConta, equipamento, gravar, buscar, listar, como, entrar, aba, preencherChecklist, responderPrompt, imagemTeste, diasAtras } = require('./ajuda');

const quadrado = (page, id) => page.locator(`#eqGrid [data-eq="${id}"]`);

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

test('KM corrigido para menos pelo gestor vale na tela e no próximo checklist', async ({ page, novaJanela }) => {
  await equipamento('KMM1A11', 'Caminhão', { tipoMedidor: 'KM', medidorAtual: 500 });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  expect((await preencherChecklist(page, { placa: 'KMM1A11', km: 800, data: diasAtras(1) })).ok).toBe(true);
  await expect.poll(async () => (await buscar('equipamentos/KMM1A11')).medidorAtual).toBe(800);

  const g = await novaJanela();
  await entrar(g, await criarConta('G', 'g@teste.com', 'gestor'));
  await aba(g, 'eq');
  await expect(quadrado(g, 'KMM1A11')).toContainText('800 km');
  await g.click('[data-edit-eq="KMM1A11"]');
  await g.fill('#eqMedidor', '100');
  await g.click('#eqBtn');
  // Antes valia a maior leitura (800, do checklist); agora vale a correção, que é a mais recente.
  await expect(quadrado(g, 'KMM1A11')).toContainText('100 km');
  await aba(g, 'dia');
  await expect(g.locator('#diaTbody')).toContainText('100 km');
  await aba(g, 'eq');
  await g.click('[data-edit-eq="KMM1A11"]');
  await expect(g.locator('#eqMedidor')).toHaveValue('100');

  await page.reload();
  await page.locator('#telaApp').waitFor();
  const r = await preencherChecklist(page, { placa: 'KMM1A11', km: 300 });
  expect(r.ok).toBe(true);
  expect(r.texto).toContain('Rodou 200 km');
  await expect.poll(async () => (await buscar('equipamentos/KMM1A11')).medidorAtual).toBe(300);
});

test('preventiva por KM: gestor cadastra, avisa perto e vencida, técnico marca como feita', async ({ page, novaJanela }) => {
  await equipamento('PRV01', 'Caminhão basculante', { tipoMedidor: 'KM', medidorAtual: 9500 });
  const tec = await criarConta('Carlos Técnico', 'tec@teste.com', 'tecnico');
  const op = await criarConta('Op', 'op@teste.com');
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await aba(page, 'eq');
  await expect(page.locator('#eqPrev')).toBeHidden();
  await quadrado(page, 'PRV01').click();
  await expect(page.locator('#relPrev')).toContainText('Nenhuma preventiva cadastrada');
  await page.click('#prevNova');
  await expect(page.locator('#pvUlt')).toHaveValue('9500');
  await page.click('#pvSalvar');
  await expect(page.locator('#pvErro')).toHaveText('Informe o serviço.');
  await page.fill('#pvNome', 'Troca de óleo');
  await page.fill('#pvInt', '10.000');
  await page.fill('#pvUlt', '0');
  await page.click('#pvSalvar');

  await expect.poll(() => listar('preventivas')).toHaveLength(1);
  const [p] = await listar('preventivas');
  expect(p).toMatchObject({ placaId: 'PRV01', placa: 'PRV01', nome: 'Troca de óleo', intervalo: 10000, ultimaFeita: 0 });
  // Faltam 500 km de 10.000: dentro dos 10% finais, então avisa.
  await expect(page.locator('#relPrev li')).toContainText('Em 500 km');
  await expect(page.locator('#relPrev li')).toHaveClass(/st-pr/);
  await page.click('#mCancelar');
  await expect(quadrado(page, 'PRV01').locator('.eq-prev')).toContainText('Troca de óleo em 500 km');
  await expect(page.locator('#eqPrev')).toContainText('1 chegando perto');
  await aba(page, 'dia');
  await expect(page.locator('#diaKpis')).toContainText('Preventivas vencidas0');

  // O operador passa do limite no checklist e já recebe o aviso.
  const o = await novaJanela();
  await entrar(o, op);
  const r = await preencherChecklist(o, { placa: 'PRV01', km: '10.200' });
  expect(r.ok).toBe(true);
  expect(r.texto).toContain('Preventiva Troca de óleo vencida há 200 km');
  await expect(page.locator('#diaKpis')).toContainText('Preventivas vencidas1');
  await aba(page, 'eq');
  await expect(quadrado(page, 'PRV01').locator('.eq-prev')).toHaveClass(/st-mu/);
  await expect(page.locator('#eqPrev')).toContainText('1 vencida');
  // Operador só vê: sem botões.
  await aba(o, 'eq');
  await quadrado(o, 'PRV01').click();
  await expect(o.locator('#relPrev li')).toContainText('Vencida há 200 km');
  await expect(o.locator('#relPrev button')).toHaveCount(0);

  // Técnico marca como feita na leitura atual.
  const t = await novaJanela();
  await entrar(t, tec);
  await aba(t, 'eq');
  await quadrado(t, 'PRV01').click();
  await expect(t.locator('#prevNova')).toHaveCount(0);
  await expect(t.locator('[data-prev-del]')).toHaveCount(0);
  responderPrompt(t, '10.200');
  await t.click('[data-prev-feita]');
  await expect.poll(async () => (await listar('preventivas'))[0].ultimaFeita).toBe(10200);
  expect((await listar('preventivas'))[0]).toMatchObject({ feitaPor: 'Carlos Técnico', feitaUid: tec.uid });
  await expect(t.locator('#relPrev li')).toContainText('Em dia · faltam 10.000 km');
  await expect(page.locator('#eqPrev')).toBeHidden();

  // Regras: operador não cria nem altera; técnico não muda o intervalo.
  expect(await como(op).criar('preventivas/X', { placaId: 'PRV01', nome: 'X', intervalo: 1, ultimaFeita: 0 })).toBe(403);
  expect(await como(op).alterar('preventivas/' + p.id, { ultimaFeita: 1 })).toBe(403);
  expect(await como(tec).alterar('preventivas/' + p.id, { intervalo: 1 })).toBe(403);
  expect(await como(tec).apagar('preventivas/' + p.id)).toBe(403);

  // Gestor remove.
  await quadrado(page, 'PRV01').click();
  await page.click('[data-prev-del]');
  await expect.poll(() => listar('preventivas')).toHaveLength(0);
});

test('técnico anexa a foto do serviço pronto ao concluir a OS', async ({ page }) => {
  const tec = await criarConta('Carlos Técnico', 'tec@teste.com', 'tecnico');
  const outro = await criarConta('Outro Técnico', 'tec2@teste.com', 'tecnico');
  const op = await criarConta('Op', 'op@teste.com');
  await requerimento('R1', { status: 'OS aberta', numeroOS: '7', responsavel: 'Carlos Técnico', responsavelUid: tec.uid });
  await entrar(page, tec);
  await aba(page, 'minhas');
  await page.click('#minhasTbody tr[data-id="R1"]');
  await expect(page.locator('#mFotoServ')).toContainText('Sem foto');
  await page.setInputFiles('#mFotoServInp', imagemTeste());
  await expect(page.locator('#mFotoServ img')).toBeVisible();
  await page.selectOption('#mStatus', 'Concluído');
  await page.click('#mSalvar');

  await expect.poll(async () => (await buscar('fotos/servico_R1'))?.dados?.slice(0, 23)).toBe('data:image/jpeg;base64,');
  expect(await buscar('fotos/servico_R1')).toMatchObject({ reqId: 'R1', tipo: 'servico', criadoPor: tec.uid });
  await expect.poll(async () => (await buscar('requerimentos/R1')).status).toBe('Concluído');
  expect((await buscar('requerimentos/R1')).historico[0].obs).toBe('Foto do serviço pronto anexada.');

  await page.selectOption('#mnFiltro', 'Concluído');
  await page.click('#minhasTbody tr[data-id="R1"]');
  await expect(page.locator('#mFotoServ img')).toHaveCount(1);
  await expect(page.locator('.hist')).toContainText('Foto do serviço pronto anexada.');

  // Só o gestor ou o técnico responsável grava a foto do serviço.
  const foto = { reqId: 'R1', tipo: 'servico', dados: 'data:image/jpeg;base64,AAAA' };
  expect(await como(op).criar('fotos/servico_R1', { ...foto, criadoPor: op.uid })).toBe(403);
  expect(await como(outro).criar('fotos/servico_R1', { ...foto, criadoPor: outro.uid })).toBe(403);
  expect(await como(tec).criar('fotos/servico_R9', { ...foto, reqId: 'R9', criadoPor: tec.uid })).toBe(403);
});

test('imprimir / PDF do checklist e da OS monta a folha no padrão do formulário', async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão basculante', { tipoMedidor: 'KM', medidorAtual: 1000 });
  await entrar(page, await criarConta('Gestora', 'g@teste.com', 'gestor'));
  await page.evaluate(() => { window.__impressoes = 0; window.print = () => { window.__impressoes++; }; });
  expect((await preencherChecklist(page, { placa: 'ABC1D23', km: 1200, divergencias: [[23, 'MU', 'Pastilha gasta']] })).ok).toBe(true);

  await aba(page, 'insp');
  await page.click('#inspTbody tr[data-id]');
  await page.click('#mImprimir');
  await expect.poll(() => page.evaluate(() => window.__impressoes)).toBe(1);
  const folha = page.locator('#printRoot');
  await expect(folha).toContainText('CHECK-LIST AVERIGUAÇÃO P1');
  await expect(folha.locator('.pr-dados')).toContainText('ABC1D23');
  await expect(folha.locator('.pr-tab tbody tr')).toHaveCount(50);
  await expect(folha.locator('tr.pr-mu')).toHaveCount(1);
  await expect(folha.locator('tr.pr-mu')).toContainText('Pastilha gasta');
  await expect(folha.locator('tr.pr-mu td.x').nth(1)).toHaveText('X');
  await expect(folha).toContainText('Responsável pela manutenção');
  expect(await page.title()).toMatch(/^Checklist ABC1D23 /);
  // Na impressão só a folha aparece.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#telaApp')).toBeHidden();
  await expect(folha).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(folha).toBeEmpty();
  await page.click('#mCancelar');

  await aba(page, 'req');
  await page.click('#reqTbody tr[data-id]');
  await page.click('#mImprimir');
  await expect.poll(() => page.evaluate(() => window.__impressoes)).toBe(2);
  await expect(folha).toContainText('REQUERIMENTO DE ABERTURA DE OS');
  await expect(folha).toContainText('Pastilha gasta');
  await expect(folha).toContainText('Antes (divergência)');
  await expect(folha).toContainText('Depois (serviço pronto)');
  await expect(folha).toContainText('Gestor da manutenção');
});

test('avisos no aparelho: técnico recebe OS nova e gestor recebe requerimento urgente', async ({ page, novaJanela }) => {
  const simular = p => p.addInitScript(() => {
    window.__avisos = [];
    window.Notification = class { constructor(t, o) { window.__avisos.push({ t, ...o }); } };
    window.Notification.permission = 'default';
    window.Notification.requestPermission = async () => (window.Notification.permission = 'granted');
  });
  const avisos = p => p.evaluate(() => window.__avisos.map(a => a.t));
  const tec = await criarConta('Carlos Técnico', 'tec@teste.com', 'tecnico');
  const gestor = await criarConta('Gestora', 'g@teste.com', 'gestor');
  await requerimento('R1', { status: 'OS aberta', responsavel: 'Carlos Técnico', responsavelUid: tec.uid });
  await requerimento('R2');

  await simular(page);
  await entrar(page, tec);
  await page.click('.top-r [data-avisos-btn]');
  await expect(page.locator('.top-r [data-avisos-btn]')).toBeHidden();
  await expect(page.locator('#minhasBadge')).toHaveText('1');
  const g = await novaJanela();
  await simular(g);
  await entrar(g, gestor);
  await g.click('.top-r [data-avisos-btn]');

  // O que já existia não avisa; a OS que chega depois, sim.
  expect(await avisos(page)).toEqual([]);
  expect(await como(gestor).alterar('requerimentos/R2', { responsavel: 'Carlos Técnico', responsavelUid: tec.uid, status: 'OS aberta' })).toBe(200);
  await expect.poll(() => avisos(page)).toEqual(['Nova OS para você: ABC1D23']);

  await requerimento('R3', { placa: 'XYZ9K88', itemNumero: 6, itemNome: 'VAZAMENTO' });
  await requerimento('R4', { placa: 'XYZ9K88', prioridade: 'NORMAL', classificacao: 'PR - Programar revisão' });
  await expect.poll(() => avisos(g)).toEqual(['Requerimento urgente: XYZ9K88']);

  // Operador não tem o botão.
  const o = await novaJanela();
  await simular(o);
  await entrar(o, await criarConta('Op', 'op@teste.com'));
  await expect(o.locator('[data-avisos-btn]')).toHaveCount(2);
  await expect(o.locator('.top-r [data-avisos-btn]')).toBeHidden();
});

test('requerimentos: filtro pela data de abertura', async ({ page }) => {
  const dias = n => new Date(Date.now() - n * 864e5);
  await requerimento('HOJE');
  await requerimento('SEMANA', { criadoEm: dias(5), criadoEmLocal: dias(5).getTime() });
  await requerimento('VELHO', { criadoEm: dias(60), criadoEmLocal: dias(60).getTime() });
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'req');
  const linhas = page.locator('#reqTbody tr[data-id]');
  await expect(linhas).toHaveCount(3);
  await page.selectOption('#rPeriodo', 'hoje');
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toHaveAttribute('data-id', 'HOJE');
  await page.selectOption('#rPeriodo', '7');
  await expect(linhas).toHaveCount(2);
  await page.selectOption('#rPeriodo', '90');
  await expect(linhas).toHaveCount(3);
  await expect(page.locator('#reqCont')).toHaveText('3 requerimento(s)');
  await page.selectOption('#rPeriodo', '30');
  await expect(page.locator('#reqCont')).toHaveText('2 requerimento(s)');
});
