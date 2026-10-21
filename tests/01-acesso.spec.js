// Login, cadastro, aprovação pelo gestor, esqueci a senha, exclusão de usuário e tema.
const { test, expect, SENHA, criarConta, buscar, entrar, aba, listar } = require('./ajuda');

test('conta nova fica aguardando até o gestor aprovar pela aba Usuários', async ({ page, novaJanela }) => {
  const gestor = await criarConta('Gestora Ana', 'ana@teste.com', 'gestor');
  await page.goto('/');
  await page.click('#lnkCadastro');
  await page.fill('#lNome', 'Operador Beto');
  await page.fill('#lEmail', 'beto@teste.com');
  await page.fill('#lSenha', SENHA);
  await page.click('#btnLogin');
  await expect(page.locator('#telaAguardando')).toBeVisible();

  let novo;
  await expect.poll(async () => (novo = (await listar('usuarios')).find(u => u.email === 'beto@teste.com'))).toBeTruthy();
  expect(novo).toMatchObject({ papel: 'operador', ativo: false, nome: 'Operador Beto' });

  const g = await novaJanela();
  await entrar(g, gestor);
  await expect(g.locator('#usrBadge')).toHaveText('1');
  await aba(g, 'usr');
  await g.click(`[data-ativar="${novo.id}"]`);

  // A tela de quem estava esperando abre sozinha.
  await expect(page.locator('#telaApp')).toBeVisible();
  await expect(page.locator('#quem')).toContainText('Operador Beto');
  await expect(page.locator('.tab[data-view="usr"]')).toBeHidden();
});

test('senha errada mostra mensagem em português', async ({ page }) => {
  await criarConta('Op', 'op@teste.com');
  await page.goto('/');
  await page.fill('#lEmail', 'op@teste.com');
  await page.fill('#lSenha', 'errada1');
  await page.click('#btnLogin');
  await expect(page.locator('#loginErr')).toHaveText('E-mail ou senha incorretos.');
});

test('esqueci minha senha envia o e-mail de redefinição', async ({ page }) => {
  await criarConta('Op', 'op@teste.com');
  await page.goto('/');
  await page.click('#lnkSenha');
  await expect(page.locator('#loginErr')).toContainText('Digite seu e-mail');
  await page.fill('#lEmail', 'op@teste.com');
  await page.click('#lnkSenha');
  await expect(page.locator('#loginOk')).toContainText('enviamos um link');
  const r = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-checklist/oobCodes')).json();
  expect(r.oobCodes.filter(c => c.requestType === 'PASSWORD_RESET' && c.email === 'op@teste.com')).toHaveLength(1);
});

test('gestor muda o cargo, bloqueia e exclui usuários; excluído pode pedir acesso de novo', async ({ page, novaJanela }) => {
  const gestor = await criarConta('Gestora', 'g@teste.com', 'gestor');
  const op = await criarConta('Carlos', 'carlos@teste.com');
  await entrar(page, gestor);
  await aba(page, 'usr');

  await page.selectOption(`[data-papel="${op.uid}"]`, 'tecnico');
  await expect.poll(async () => (await buscar('usuarios/' + op.uid)).papel).toBe('tecnico');

  await page.click(`[data-ativar="${op.uid}"]`);
  await expect.poll(async () => (await buscar('usuarios/' + op.uid)).ativo).toBe(false);

  await page.click(`[data-excluir="${op.uid}"]`);
  await expect.poll(() => buscar('usuarios/' + op.uid)).toBeNull();

  const o = await novaJanela();
  await o.goto('/');
  await o.fill('#lEmail', op.email);
  await o.fill('#lSenha', SENHA);
  await o.click('#btnLogin');
  await expect(o.locator('#txtAguarda')).toContainText('não tem mais acesso');
  await o.click('#btnSolicitar');
  await expect.poll(async () => (await buscar('usuarios/' + op.uid) || {}).ativo).toBe(false);
  await expect(page.locator('#usrBadge')).toHaveText('1');
});

test('botão de tema alterna claro e escuro e lembra a escolha', async ({ page }) => {
  const op = await criarConta('Op', 'op@teste.com');
  await entrar(page, op);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await page.click('#btnTema');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#btnTema')).toHaveText('Modo claro');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#btnTema');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
});

test('cada cargo vê só as abas dele', async ({ page, novaJanela }) => {
  const visiveis = async p => (await p.locator('.tab:visible').allTextContents()).map(t => t.replace(/\s*\d+$/, '').trim());
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  expect(await visiveis(page)).toEqual(['Novo checklist', 'Equipamentos', 'Requerimentos OS', 'Inspeções']);
  const t = await novaJanela();
  await entrar(t, await criarConta('Téc', 'tec@teste.com', 'tecnico'));
  expect(await visiveis(t)).toEqual(['Novo checklist', 'Painel do dia', 'Equipamentos', 'Minhas OS', 'Requerimentos OS', 'Inspeções']);
  const g = await novaJanela();
  await entrar(g, await criarConta('Ges', 'ges@teste.com', 'gestor'));
  expect(await visiveis(g)).toEqual(['Novo checklist', 'Painel do dia', 'Equipamentos', 'Requerimentos OS', 'Inspeções', 'Finalizados', 'Relatórios', 'Cadastros', 'Usuários']);
});
