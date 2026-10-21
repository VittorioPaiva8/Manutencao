// Registro do checklist: validações, liberação, requerimentos, KM / horímetro e fotos.
const { test, expect, criarConta, equipamento, gravar, entrar, aba, preencherChecklist, listar, buscar, hojeISO, diasAtras, imagemTeste } = require('./ajuda');

test.beforeEach(async ({ page }) => {
  await equipamento('ABC1D23', 'Caminhão basculante');
  await entrar(page, await criarConta('Operador João', 'joao@teste.com'));
});

test('checklist sem divergência fica liberado e não gera requerimento', async ({ page }) => {
  const r = await preencherChecklist(page, { placa: 'abc1d23' });
  expect(r.ok).toBe(true);
  expect(r.texto).toContain('Liberado para atividades: SIM');
  expect(r.texto).toContain('Nenhuma divergência');
  await expect.poll(() => listar('inspecoes')).toHaveLength(1);
  const [i] = await listar('inspecoes');
  expect(i.id).toBe('ABC1D23_' + hojeISO());
  expect(i).toMatchObject({ liberado: 'SIM', placa: 'ABC1D23', avaliador: 'Operador João', contagem: { OK: 50, MU: 0, PR: 0, NA: 0 } });
  expect(i.respostas).toHaveLength(50);
  expect(await listar('requerimentos')).toHaveLength(0);
  // O formulário volta limpo para o próximo.
  await expect(page.locator('#placa')).toHaveValue('');
});

test('MU gera requerimento de prioridade alta e bloqueia a liberação; PR não bloqueia', async ({ page }) => {
  await equipamento('XYZ9K88', 'Retroescavadeira');
  let r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Pastilha gasta']], na: [33] });
  expect(r.texto).toContain('Liberado para atividades: NÃO');
  expect(r.texto).toContain('1 requerimento(s) de OS');
  r = await preencherChecklist(page, { placa: 'XYZ9K88', divergencias: [[20, 'PR', 'Riscos na lataria']] });
  expect(r.texto).toContain('Liberado para atividades: SIM');

  await expect.poll(() => listar('requerimentos')).toHaveLength(2);
  const reqs = await listar('requerimentos');
  const mu = reqs.find(q => q.itemNumero === 23), pr = reqs.find(q => q.itemNumero === 20);
  expect(mu).toMatchObject({ status: 'Aberto', prioridade: 'ALTA', classificacao: 'MU - Manutenção urgente', descricao: 'Pastilha gasta', placa: 'ABC1D23', ocorrencias: 1 });
  expect(pr).toMatchObject({ prioridade: 'NORMAL', classificacao: 'PR - Programar revisão' });
  const i = await buscar('inspecoes/ABC1D23_' + hojeISO());
  expect(i.contagem).toEqual({ OK: 48, MU: 1, PR: 0, NA: 1 });

  await aba(page, 'req');
  await expect(page.locator('#reqBadge')).toHaveText('2');
  await expect(page.locator('#reqTbody tr[data-id]')).toHaveCount(2);
});

test('item crítico com PR bloqueia a liberação', async ({ page }) => {
  await gravar('config/checklist', { criticos: [27] });
  const r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[27, 'PR', 'Pneu careca']] });
  expect(r.texto).toContain('Liberado para atividades: NÃO');
  await expect.poll(async () => (await listar('requerimentos'))[0]?.prioridade).toBe('ALTA');
});

test('item 50 (liberação para atividades) com divergência bloqueia', async ({ page }) => {
  const r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[50, 'PR', 'Aguardando vistoria']] });
  expect(r.texto).toContain('Liberado para atividades: NÃO');
});

test('não deixa registrar com campos ou divergências faltando', async ({ page }) => {
  await aba(page, 'check');
  await page.click('#btnEnviar');
  await expect(page.locator('#erroEnvio')).toContainText('Preencha: Placa, Equipamento');

  const r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[5, 'MU', '']] });
  expect(r.ok).toBe(false);
  expect(r.texto).toContain('divergências sem descrição');
  await expect(page.locator('#it5')).toHaveClass(/erro/);
});

test('placa não cadastrada é recusada', async ({ page }) => {
  const r = await preencherChecklist(page, { placa: 'NAO0000' });
  expect(r.ok).toBe(false);
  expect(r.texto).toContain('não está cadastrada');
});

test('até dois checklists por equipamento por dia, e data no máximo 30 dias atrás', async ({ page }) => {
  expect((await preencherChecklist(page, { placa: 'ABC1D23' })).ok).toBe(true);
  await expect.poll(() => listar('inspecoes')).toHaveLength(1);
  expect((await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Freio']] })).ok).toBe(true);
  await expect.poll(async () => (await listar('inspecoes')).map(i => i.id).sort()).toEqual(['ABC1D23_' + hojeISO(), 'ABC1D23_' + hojeISO() + '_2']);
  await expect.poll(async () => (await listar('requerimentos')).map(q => q.id)).toEqual(['ABC1D23_' + hojeISO() + '_2_23']);
  const r = await preencherChecklist(page, { placa: 'ABC1D23' });
  expect(r.ok).toBe(false);
  expect(r.texto).toContain('já tem 2 checklists');
  const velho = await preencherChecklist(page, { placa: 'ABC1D23', data: diasAtras(40) });
  expect(velho.texto).toContain('últimos 30 dias');
});

test('divergência repetida soma ocorrência no requerimento que já está aberto', async ({ page }) => {
  await preencherChecklist(page, { placa: 'ABC1D23', data: diasAtras(1), divergencias: [[6, 'PR', 'Vazamento pequeno']] });
  await expect.poll(() => listar('requerimentos')).toHaveLength(1);
  const r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[6, 'MU', 'Vazamento aumentou']] });
  expect(r.texto).toContain('somado a um já aberto');
  await expect.poll(async () => (await listar('requerimentos'))[0].ocorrencias).toBe(2);
  const [q] = await listar('requerimentos');
  expect(q.prioridade).toBe('ALTA');
  expect(q.descricao).toContain('Vazamento pequeno');
  expect(q.descricao).toContain('Vazamento aumentou');
  expect(q.inspecoes).toHaveLength(2);
});

test('KM: obrigatório, não volta para trás, calcula quanto rodou e atualiza o cadastro', async ({ page }) => {
  await equipamento('KMM1A11', 'Caminhão', { tipoMedidor: 'KM', medidorAtual: 10000 });
  await aba(page, 'check');
  await page.fill('#placa', 'KMM1A11');
  await page.dispatchEvent('#placa', 'change');
  await expect(page.locator('#kmHrLbl')).toHaveText('KM atual *');
  await expect(page.locator('#kmHr')).toHaveAttribute('placeholder', /Último: 10\.000 km/);

  let r = await preencherChecklist(page, { placa: 'KMM1A11' });
  expect(r.texto).toContain('Informe o KM atual');
  r = await preencherChecklist(page, { placa: 'KMM1A11', km: '9.500' });
  expect(r.texto).toContain('menor que a última leitura');
  r = await preencherChecklist(page, { placa: 'KMM1A11', km: '10.250' });
  expect(r.ok).toBe(true);
  expect(r.texto).toContain('Rodou 250 km');

  await expect.poll(async () => (await buscar('equipamentos/KMM1A11')).medidorAtual).toBe(10250);
  const i = await buscar('inspecoes/KMM1A11_' + hojeISO());
  expect(i).toMatchObject({ kmHrValor: 10250, kmHrAnterior: 10000, kmHrRodado: 250, kmHrTipo: 'KM' });
});

test('horímetro aceita decimal com vírgula', async ({ page }) => {
  await equipamento('HR01', 'Escavadeira', { tipoMedidor: 'HR', medidorAtual: 1500 });
  const r = await preencherChecklist(page, { placa: 'HR01', km: '1.512,5' });
  expect(r.texto).toContain('Rodou 12,5 h');
  await expect.poll(async () => (await buscar('equipamentos/HR01')).medidorAtual).toBe(1512.5);
});

test('foto da divergência é comprimida, salva e aparece no requerimento e na inspeção', async ({ page }) => {
  await aba(page, 'check');
  await page.fill('#placa', 'ABC1D23');
  await page.click('[data-n="23"][data-s="MU"]');
  await page.setInputFiles('[data-foto="23"]', imagemTeste());
  await expect(page.locator('#fb23 img')).toBeVisible();
  await page.click('[data-tirar-foto="23"]');
  await expect(page.locator('#fb23 img')).toHaveCount(0);

  const r = await preencherChecklist(page, { placa: 'ABC1D23', divergencias: [[23, 'MU', 'Pastilha gasta']], fotos: { 23: imagemTeste() } });
  expect(r.ok).toBe(true);
  await expect.poll(() => listar('fotos')).toHaveLength(1);
  const [f] = await listar('fotos');
  expect(f.id).toBe('ABC1D23_' + hojeISO() + '_23');
  expect(f.dados).toMatch(/^data:image\/jpeg;base64,/);
  expect(f.dados.length).toBeLessThan(500000);

  await aba(page, 'req');
  await page.click('#reqTbody tr[data-id]');
  await expect(page.locator('#mFotos img')).toHaveCount(1);
  await page.click('#mX');

  await aba(page, 'insp');
  await page.click('#inspTbody tr[data-id]');
  await expect(page.locator('#mItens img.foto-mini')).toHaveCount(1);
  await page.locator('#mItens img.foto-mini').click();
  await expect(page.locator('.foto-ov img')).toBeVisible();
});

test('"Marcar restantes como OK" e a contagem', async ({ page }) => {
  await aba(page, 'check');
  await expect(page.locator('#cFalta')).toHaveText('50');
  await page.click('[data-n="3"][data-s="PR"]');
  await page.click('[data-n="4"][data-s="NA"]');
  await page.click('#btnRestantesOk');
  await expect(page.locator('#cOK')).toHaveText('48');
  await expect(page.locator('#cPR')).toHaveText('1');
  await expect(page.locator('#cNA')).toHaveText('1');
  await expect(page.locator('#cFalta')).toHaveText('0');
});

test('legenda do item crítico (*) só aparece quando algum item está marcado como crítico', async ({ page }) => {
  await aba(page, 'check');
  await expect(page.locator('#guiaCrit')).toBeHidden();
  await expect(page.locator('#itens .crit')).toHaveCount(0);
  await gravar('config/checklist', { criticos: [23] });
  await expect(page.locator('#guiaCrit')).toBeVisible();
  await expect(page.locator('#it23 .crit')).toBeVisible();
  await gravar('config/checklist', { criticos: [] });
  await expect(page.locator('#guiaCrit')).toBeHidden();
});
