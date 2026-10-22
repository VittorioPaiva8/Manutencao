// Ferramentas comuns dos testes: limpar o banco, criar contas e equipamentos direto no emulador,
// entrar no app e preencher um checklist pela tela, e gravar "como se fosse" um usuário (para
// conferir as regras do banco).
const fs = require('fs');
const path = require('path');
const base = require('@playwright/test');

const PROJETO = 'demo-checklist';
const FS = 'http://127.0.0.1:8080/v1/projects/' + PROJETO + '/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099';
const DONO = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const SENHA = 'senha123';
const SDK = path.join(__dirname, '..', 'node_modules', 'firebase');

const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const diasAtras = n => { const d = new Date(Date.now() - n * 864e5); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const idPlaca = placa => String(placa).trim().toUpperCase().replace(/[^A-Z0-9]/g, '-');

// ---------- Formato de valores da API REST do Firestore ----------
function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: campos(v) } };
}
const campos = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valor(v)]));
function ler(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(ler);
  if ('mapValue' in v) return lerCampos(v.mapValue.fields || {});
  return v;
}
const lerCampos = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, ler(v)]));
const nomeDoc = p => 'projects/' + PROJETO + '/databases/(default)/documents/' + p;

// ---------- Banco e contas pelo emulador (sem passar pelas regras) ----------
async function limpar() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + PROJETO + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch(AUTH + '/emulator/v1/projects/' + PROJETO + '/accounts', { method: 'DELETE' });
}
async function gravar(caminho, dados) {
  const r = await fetch(FS + '/' + caminho, { method: 'PATCH', headers: DONO, body: JSON.stringify({ fields: campos(dados) }) });
  if (!r.ok) throw new Error('gravar ' + caminho + ': ' + await r.text());
}
/** Grava vários documentos de uma vez: [[caminho, dados], ...]. */
async function gravarVarios(lista) {
  for (let i = 0; i < lista.length; i += 400) {
    const writes = lista.slice(i, i + 400).map(([c, d]) => ({ update: { name: nomeDoc(c), fields: campos(d) } }));
    const r = await fetch(FS + ':commit', { method: 'POST', headers: DONO, body: JSON.stringify({ writes }) });
    if (!r.ok) throw new Error('gravarVarios: ' + await r.text());
  }
}
async function buscar(caminho) {
  const r = await fetch(FS + '/' + caminho, { headers: DONO });
  if (r.status === 404) return null;
  const d = await r.json();
  return { id: d.name.split('/').pop(), ...lerCampos(d.fields || {}) };
}
async function listar(colecao) {
  const r = await fetch(FS + '/' + colecao + '?pageSize=1000', { headers: DONO });
  return ((await r.json()).documents || []).map(d => ({ id: d.name.split('/').pop(), ...lerCampos(d.fields || {}) }));
}

/** Cria a conta no login do emulador e o cadastro em `usuarios`. Devolve { uid, email, nome, token }. */
async function criarConta(nome, email, papel = 'operador', ativo = true) {
  const r = await (await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=teste', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SENHA, displayName: nome, returnSecureToken: true }),
  })).json();
  if (!r.localId) throw new Error('criarConta: ' + JSON.stringify(r));
  await gravar('usuarios/' + r.localId, { nome, email, papel, ativo, criadoEm: new Date() });
  return { uid: r.localId, email, nome, token: r.idToken };
}
async function equipamento(placa, nome, extra = {}) {
  await gravar('equipamentos/' + idPlaca(placa), { placa: placa.toUpperCase(), equipamento: nome, equipe: '', cabine: '', ...extra });
  return idPlaca(placa);
}

/**
 * Acesso "como o usuário", passando pelas regras do banco. Cada função devolve o status HTTP
 * (200 = aceito, 403 = recusado pelas regras).
 */
function como(conta) {
  const h = { Authorization: 'Bearer ' + conta.token, 'Content-Type': 'application/json' };
  return {
    async criar(caminho, dados) {
      const i = caminho.lastIndexOf('/');
      return (await fetch(FS + '/' + caminho.slice(0, i) + '?documentId=' + caminho.slice(i + 1), { method: 'POST', headers: h, body: JSON.stringify({ fields: campos(dados) }) })).status;
    },
    async alterar(caminho, dados) {
      const mask = Object.keys(dados).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
      return (await fetch(FS + '/' + caminho + '?' + mask + '&currentDocument.exists=true', { method: 'PATCH', headers: h, body: JSON.stringify({ fields: campos(dados) }) })).status;
    },
    async apagar(caminho) { return (await fetch(FS + '/' + caminho, { method: 'DELETE', headers: h })).status; },
    async ler(caminho) { return (await fetch(FS + '/' + caminho, { headers: h })).status; },
    /** Lote atômico: [{ caminho, dados, horaServidor: ['criadoEm'], novo: true }]. */
    async lote(itens) {
      const writes = itens.map(w => ({
        update: { name: nomeDoc(w.caminho), fields: campos(w.dados) },
        ...(w.horaServidor ? { updateTransforms: w.horaServidor.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
        ...(w.novo ? { currentDocument: { exists: false } } : {}),
      }));
      return (await fetch(FS + ':commit', { method: 'POST', headers: h, body: JSON.stringify({ writes }) })).status;
    },
  };
}

// ---------- Tela ----------
/** Abre uma página que usa o SDK do Firebase do node_modules (funciona sem internet). */
async function prepararPagina(page, erros) {
  await page.route(/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, route => {
    const arq = route.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    route.fulfill({ path: path.join(SDK, arq), contentType: 'text/javascript' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  page.on('pageerror', e => erros.push(e.message));
  // confirm() é aceito sozinho; para prompt(), defina antes a resposta com responderPrompt().
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page._resposta ?? '') : undefined).catch(() => {}));
}

const responderPrompt = (page, texto) => { page._resposta = texto; };

async function entrar(page, conta) {
  await page.goto('/');
  await page.locator('#telaLogin').waitFor();
  await page.fill('#lEmail', conta.email);
  await page.fill('#lSenha', SENHA);
  await page.click('#btnLogin');
  await page.locator('#telaApp').waitFor();
}
async function aba(page, nome) {
  // No celular as abas ficam dentro do menu.
  if (await page.locator('#btnMenu').isVisible() && !(await page.locator('.tab[data-view="' + nome + '"]').isVisible())) await page.click('#btnMenu');
  // No computador as abas do gestor ficam no menu "Gestão".
  if (await page.locator('#btnGestao').isVisible() && !(await page.locator('.tab[data-view="' + nome + '"]').isVisible())) await page.click('#btnGestao');
  await page.click('.tab[data-view="' + nome + '"]');
  await page.locator('#v-' + nome).waitFor();
}

/**
 * Preenche e registra um checklist. `divergencias`: [[item, 'MU' | 'PR', 'descrição']].
 * Devolve { ok, texto } com a mensagem verde ou o erro mostrado.
 */
async function preencherChecklist(page, { placa, km, data, divergencias = [], na = [], fotos = {} }) {
  await aba(page, 'check');
  await page.locator('#btnEnviar:not([disabled])').waitFor({ timeout: 15_000 });
  await page.fill('#placa', placa);
  await page.dispatchEvent('#placa', 'change');
  if (!(await page.inputValue('#equipamento'))) await page.fill('#equipamento', 'Equipamento de teste');
  if (data) await page.fill('#dataInspecao', data);
  if (km !== undefined) await page.fill('#kmHr', String(km));
  for (const [n, s, obs] of divergencias) {
    await page.click(`[data-n="${n}"][data-s="${s}"]`);
    if (obs) await page.fill(`[data-obs="${n}"]`, obs);
  }
  for (const n of na) await page.click(`[data-n="${n}"][data-s="NA"]`);
  for (const [n, arquivo] of Object.entries(fotos)) {
    await page.setInputFiles(`[data-foto="${n}"]`, arquivo);
    await page.locator(`#fb${n} img`).waitFor();
  }
  await page.click('#btnRestantesOk');
  await page.evaluate(() => { document.getElementById('okMsg').hidden = true; document.getElementById('erroEnvio').hidden = true; });
  await page.click('#btnEnviar');
  await page.locator('#okMsg:not([hidden]), #erroEnvio:not([hidden])').first().waitFor();
  const ok = await page.isVisible('#okMsg');
  return { ok, texto: (await page.textContent(ok ? '#okMsg' : '#erroEnvio')).trim() };
}

/** Uma imagem de teste (o ícone do app) para o campo de foto. */
const imagemTeste = () => path.join(__dirname, '..', 'public', 'icons', 'icon-512.png');

// ---------- Fixture ----------
// Cada teste começa com banco e contas vazios, e falha se a tela der erro de JavaScript.
const test = base.test.extend({
  limpo: [async ({}, use) => { await limpar(); await use(); }, { auto: true }],
  erros: async ({}, use) => {
    const erros = [];
    await use(erros);
    base.expect(erros, 'erros de JavaScript na tela').toEqual([]);
  },
  page: async ({ page, erros }, use) => {
    await prepararPagina(page, erros);
    await use(page);
  },
  /** Abre outra janela (outra pessoa logada ao mesmo tempo). */
  novaJanela: async ({ browser, erros }, use) => {
    const ctxs = [];
    await use(async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      ctxs.push(ctx);
      const p = await ctx.newPage();
      await prepararPagina(p, erros);
      return p;
    });
    for (const c of ctxs) await c.close();
  },
});

module.exports = {
  test, expect: base.expect, SENHA, hojeISO, diasAtras, idPlaca,
  limpar, gravar, gravarVarios, buscar, listar, criarConta, equipamento, como,
  entrar, aba, preencherChecklist, imagemTeste, responderPrompt,
};
