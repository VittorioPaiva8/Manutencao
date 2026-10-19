// Check List de Averiguação: PWA offline com Firebase (Auth + Firestore).
// As gravações vão primeiro para o cache local do Firestore e são enviadas
// sozinhas quando o aparelho volta a ter internet.

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const { initializeApp } = await import(SDK + 'firebase-app.js');
const {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, connectAuthEmulator,
} = await import(SDK + 'firebase-auth.js');
const {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, increment, arrayUnion, getDocs,
} = await import(SDK + 'firebase-firestore.js');

// ---------------------------------------------------------------------------
// Itens do CHECK LIST DE AVERIGUAÇÃO (Revisão 003 - 03/11/2025)
// ---------------------------------------------------------------------------
const ITENS_PADRAO = [
  'NÍVEL DE ÓLEO', 'NÍVEL DE ÓLEO HIDRÁULICO', 'NÍVEL DE COMBUSTÍVEL', 'NÍVEL DE ÁGUA (DO ARREFECIMENTO)',
  'CONEXÃO DAS MANGUEIRAS (FIXAÇÃO)', 'VAZAMENTO DAS MANGUEIRAS', 'RUÍDOS (MOTOR, TRANSMISSÃO, SUSPENSÃO)',
  'BATERIA (CABOS, TERMINAIS, CONDIÇÃO GERAL DA CAIXA)',
  'PARTE ELÉTRICA (FARÓIS, LANTERNAS, PISCA-ALERTA, LUZ DE FREIO, LUZ INTERNA E LUZ DE PAINEL)',
  'LINHA DE SERVIÇO (OBSTRUÇÃO NA ÁREA DO OPERADOR E AJUDANTE)', 'EXTINTOR DE INCÊNDIO', 'BORRACHAS DE VEDAÇÃO',
  'REGISTROS DE SAÍDA DE AR', 'ESTADO GERAL DAS MANGUEIRAS', 'ABRAÇADEIRAS (FIXAÇÃO)',
  'EMISSÃO DE GASES E VENTILAÇÃO DO AMBIENTE', 'FAIXAS REFLETIVAS (LATERAIS E TRASEIRA)', 'PROTEÇÃO DE RODAS',
  'LIMPEZA INTERNA (MOTOR)', 'LATARIA (CONDIÇÃO GERAL DE PINTURA E FIXAÇÃO DAS PEÇAS)',
  'ACESSÓRIOS (CONES, CALÇOS, MACACO, CHAVE DE RODA, ETC)', 'MATERIAL DE DESGASTE',
  'FREIOS (EFICIÊNCIA, ESPESSURA DAS PASTILHAS E LONAS DE FREIO)', 'BUZINA', 'SIRENE DE RÉ',
  'RODAS (FIXAÇÃO E ESTADO GERAL)', 'ESTADO DOS PNEUS / ESTEIRAS', 'CALIBRAÇÃO DOS PNEUS', 'PNEU ESTEPE',
  'FILTROS (COMBUSTÍVEL, LUBRIFICANTES E DE AR)', 'VIDROS E RETROVISORES (INTERNO E EXTERNO)',
  'CONDIÇÕES DE DIREÇÃO (FOLGAS, VAZAMENTOS)', 'TACÓGRAFO', 'LIMPADORES DO PARA-BRISA', 'ESGUICHO DO PARA-BRISA',
  'QUEBRA-SOL', 'PORTAS, MAÇANETAS E JANELAS', 'ASSOALHO (CARROCERIA, CABINE)', 'FREIO DE ESTACIONAMENTO',
  'ASSENTOS E CINTOS DE SEGURANÇA', 'APOSTILA PLANO DE MANUTENÇÃO', 'RELATÓRIO DE MANUTENÇÃO',
  'LOGOTIPOS DA EMPRESA (LATERAIS)', 'INDICADOR DE CAPACIDADE DE CARGA', 'LAMINADO DO PARA-BRISA',
  'CAÇAMBA / CARROCERIA', 'CLIMATIZAÇÃO DA CABINE', 'CHECK-LIST PRÉ-USO', 'CONDIÇÃO E HIGIENE DA CABINE',
  'LIBERAÇÃO PARA ATIVIDADES',
];
const ITEM_LIBERACAO = 50;
// As regras do Firestore aceitam itens numerados até 60: os 50 da revisão 003 mais 10 extras.
const MAX_ITEM = 60;
const POR_PAGINA = 50;
/** Maior número de item já usado. Itens excluídos que geraram requerimento ficam em `retirados` e não são reaproveitados. */
const ultimoNumero = () => Math.max(ITENS_PADRAO.length, ...(S.cfg.extras || []).map(e => e.numero), ...(S.cfg.retirados || []));
const STATUS_REQ = ['Aberto', 'Em análise', 'OS aberta', 'Concluído', 'Cancelado'];
const STATUS_ABERTOS = ['Aberto', 'Em análise', 'OS aberta'];
const DIAS = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
const CLASSIF = { MU: 'MU - Manutenção urgente', PR: 'PR - Programar revisão' };

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const config = await carregarConfig();
const app = initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (LOCAL) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/** O Firebase Hosting entrega a configuração do projeto em /__/firebase/init.json. */
async function carregarConfig() {
  try {
    const r = await fetch('/__/firebase/init.json');
    if (r.ok) {
      const cfg = await r.json();
      localStorage.setItem('fbConfig', JSON.stringify(cfg));
      return cfg;
    }
  } catch (e) { /* offline: usa a cópia salva */ }
  try {
    const salvo = localStorage.getItem('fbConfig');
    if (salvo) return JSON.parse(salvo);
  } catch (e) { /* sem storage */ }
  throw new Error('Abra o app uma vez com internet para baixar a configuração.');
}

// ---------------------------------------------------------------------------
// Estado e utilitários
// ---------------------------------------------------------------------------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const S = {
  user: null, perfil: null, itens: [], cfg: { criticos: [], inativos: [] },
  equip: [], reqAbertos: [], reqRecentes: [], reqFinalizados: [], insp: [], usuarios: [], pendentes: 0, subs: [],
};
const respostas = {};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmt = v => {
  const d = v && v.toDate ? v.toDate() : (typeof v === 'number' ? new Date(v) : null);
  return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};
const fmtData = iso => iso ? iso.split('-').reverse().join('/') : '';
const gestor = () => S.perfil && S.perfil.papel === 'gestor';
const idPlaca = placa => String(placa).trim().toUpperCase().replace(/[^A-Z0-9]/g, '-');
function codigo(prefixo) {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const sufixo = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  return prefixo + '-' + ymd + '-' + sufixo;
}
function toast(msg, err) {
  const r = $('#toastRoot');
  r.innerHTML = '<div class="toast' + (err ? ' err' : '') + '" role="status">' + esc(msg) + '</div>';
  clearTimeout(toast.t); toast.t = setTimeout(() => { r.innerHTML = ''; }, 3800);
}
/** Mostra uma página de `linhas` (HTML de <tr>) e os botões de página em `#pg-<nome>`. */
const paginas = {};
function paginar(nome, linhas, maisAntigos) {
  const total = linhas.length, nPag = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pag = Math.min(paginas[nome] || 0, nPag - 1); paginas[nome] = pag;
  const el = $('#pg-' + nome);
  const ini = pag * POR_PAGINA, fim = Math.min(total, ini + POR_PAGINA);
  const mostrarMais = maisAntigos && pag === nPag - 1;
  el.hidden = nPag <= 1 && !mostrarMais;
  el.innerHTML = '<span class="dim">' + (total ? (ini + 1) + '–' + fim + ' de ' + total : '') + '</span><div class="actions">' +
    (nPag > 1 ? '<button class="btn sm" data-pg="-1"' + (pag ? '' : ' disabled') + '>Anterior</button><span class="dim">Página ' + (pag + 1) + ' de ' + nPag + '</span>' +
      '<button class="btn sm" data-pg="1"' + (pag < nPag - 1 ? '' : ' disabled') + '>Próxima</button>' : '') +
    (mostrarMais ? '<button class="btn sm dark" data-mais="1">Carregar mais antigos</button>' : '') + '</div>';
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mais) { maisAntigos(); return; }
    paginas[nome] = pag + Number(b.dataset.pg); el.dispatchEvent(new Event('pagina'));
    el.previousElementSibling.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return linhas.slice(ini, fim).join('');
}

function mostrarTela(id) {
  ['#telaLogin', '#telaAguardando', '#telaApp'].forEach(t => { $(t).hidden = t !== id; });
  $('#loading').hidden = true;
}

// ---------------------------------------------------------------------------
// Conexão e pendências
// ---------------------------------------------------------------------------
function atualizarRede() {
  const on = navigator.onLine;
  const el = $('#netStatus');
  el.className = 'net ' + (on ? 'on' : 'off');
  el.textContent = (on ? 'Online' : 'Offline') + (S.pendentes ? ' · ' + S.pendentes + ' a enviar' : '');
  el.title = S.pendentes ? 'Registros salvos no aparelho que ainda não chegaram ao servidor' : '';
}
addEventListener('online', atualizarRede);
addEventListener('offline', atualizarRede);

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
let modoCadastro = false;
$('#lnkCadastro').addEventListener('click', () => {
  modoCadastro = !modoCadastro;
  $('#boxNome').hidden = !modoCadastro;
  $('#btnLogin').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  $('#lnkCadastro').textContent = modoCadastro ? 'Já tenho conta' : 'Primeiro acesso? Criar conta';
});
$('#formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginErr'); err.hidden = true;
  const email = $('#lEmail').value.trim(), senha = $('#lSenha').value, nome = $('#lNome').value.trim();
  const btn = $('#btnLogin'); btn.disabled = true;
  try {
    if (modoCadastro) {
      if (!nome) throw new Error('Informe seu nome.');
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      await updateProfile(cred.user, { displayName: nome });
      await setDoc(doc(db, 'usuarios', cred.user.uid), {
        nome, email, papel: 'operador', ativo: false, criadoEm: serverTimestamp(),
      });
    } else {
      await signInWithEmailAndPassword(auth, email, senha);
    }
  } catch (ex) {
    err.hidden = false;
    err.textContent = traduzErro(ex);
  } finally { btn.disabled = false; }
});
function traduzErro(ex) {
  const c = ex && ex.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'E-mail ou senha incorretos.';
  if (c.includes('email-already-in-use')) return 'Este e-mail já tem conta. Use "Já tenho conta".';
  if (c.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (c.includes('invalid-email')) return 'E-mail inválido.';
  if (c.includes('network-request-failed')) return 'Sem internet. O primeiro acesso precisa de conexão.';
  if (c.includes('permission-denied')) return 'Sem permissão para esta ação.';
  return ex.message || String(ex);
}
$$('.btnSair').forEach(b => b.addEventListener('click', () => signOut(auth)));
$('#btnSolicitar').addEventListener('click', () => {
  const u = auth.currentUser; if (!u) return;
  setDoc(doc(db, 'usuarios', u.uid), {
    nome: u.displayName || u.email, email: u.email, papel: 'operador', ativo: false, criadoEm: serverTimestamp(),
  }).then(() => toast('Pedido de acesso enviado ao gestor')).catch(ex => toast(traduzErro(ex), true));
});

onAuthStateChanged(auth, user => {
  S.subs.forEach(u => u()); S.subs = [];
  S.user = user; S.perfil = null;
  if (!user) { mostrarTela('#telaLogin'); return; }
  // O perfil fica no cache, então o app abre offline depois do primeiro acesso.
  S.subs.push(onSnapshot(doc(db, 'usuarios', user.uid), snap => {
    const antes = S.perfil;
    S.perfil = snap.exists() ? snap.data() : null;
    if (!S.perfil || !S.perfil.ativo) {
      $('#aguardaEmail').textContent = user.email;
      if (!snap.exists() && snap.metadata.fromCache) { $('#loading').hidden = false; return; }
      // Conta excluída pelo gestor: só volta para a fila se a pessoa pedir.
      $('#btnSolicitar').hidden = snap.exists();
      $('#txtAguarda').textContent = snap.exists()
        ? ' foi criada. Peça ao gestor da manutenção para liberar seu acesso. Esta tela atualiza sozinha.'
        : ' não tem mais acesso ao app. Se ainda precisa usar, solicite o acesso de novo.';
      mostrarTela('#telaAguardando');
      return;
    }
    if (!antes || !antes.ativo || antes.papel !== S.perfil.papel) iniciarApp();
  }, () => mostrarTela('#telaAguardando')));
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function iniciarApp() {
  mostrarTela('#telaApp');
  $('#quem').innerHTML = '<b>' + esc(S.perfil.nome) + '</b><span>' + (gestor() ? 'Gestor' : 'Operador') + '</span>';
  $$('.so-gestor').forEach(e => { e.hidden = !gestor(); });
  if (!$('#avaliador').value) $('#avaliador').value = S.perfil.nome || '';
  if (!$('#dataInspecao').value) $('#dataInspecao').value = hojeISO();
  montarItens();
  atualizarRede();

  const ouvir = (q, fn) => S.subs.push(onSnapshot(q, { includeMetadataChanges: true }, fn, e => console.warn(e)));

  ouvir(doc(db, 'config', 'checklist'), snap => {
    S.cfg = Object.assign({ criticos: [], inativos: [], extras: [], removidos: [], nomes: {} }, snap.exists() ? snap.data() : {});
    montarItens(); renderCadastros();
  });
  ouvir(collection(db, 'equipamentos'), snap => {
    S.equip = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.placa).localeCompare(b.placa));
    $('#listaPlaca').innerHTML = S.equip.map(e => '<option value="' + esc(e.placa) + '">' + esc(e.equipamento) + '</option>').join('');
    $('#listaEquip').innerHTML = [...new Set(S.equip.map(e => e.equipamento))].map(v => '<option value="' + esc(v) + '">').join('');
    renderCadastros(); mostrarMedidor();
  });
  ouvir(query(collection(db, 'requerimentos'), where('status', 'in', STATUS_ABERTOS)), snap => {
    S.reqAbertos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReq();
  });
  ouvirReqRecentes(); ouvirInsp();
  if (gestor()) {
    ouvir(collection(db, 'usuarios'), snap => {
      S.usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsuarios();
    });
    // Ordenar só por fechadoEm dispensa índice composto; os abertos (fechadoEm nulo) ficam no fim e são filtrados.
    ouvir(query(collection(db, 'requerimentos'), orderBy('fechadoEm', 'desc'), limit(1000)), snap => {
      S.reqFinalizados = snap.docs.map(d => ({ id: d.id, pend: d.metadata.hasPendingWrites, ...d.data() }))
        .filter(r => r.status === 'Concluído' || r.status === 'Cancelado');
      renderFinalizados();
    });
  }
}

// Listas com limite que cresce no botão "Carregar mais antigos".
const LIM = { req: 500, insp: 300 }, unsubLista = {};
function ouvirLimitado(chave, q, fn) {
  if (unsubLista[chave]) unsubLista[chave]();
  unsubLista[chave] = onSnapshot(q, { includeMetadataChanges: true }, fn, e => console.warn(e));
  S.subs.push(() => { if (unsubLista[chave]) { unsubLista[chave](); unsubLista[chave] = null; } });
}
function ouvirReqRecentes() {
  ouvirLimitado('req', query(collection(db, 'requerimentos'), orderBy('criadoEmLocal', 'desc'), limit(LIM.req)), snap => {
    S.reqRecentes = snap.docs.map(d => ({ id: d.id, pend: d.metadata.hasPendingWrites, ...d.data() }));
    renderReq();
  });
}
function ouvirInsp() {
  ouvirLimitado('insp', query(collection(db, 'inspecoes'), orderBy('criadoEmLocal', 'desc'), limit(LIM.insp)), snap => {
    S.insp = snap.docs.map(d => ({ id: d.id, pend: d.metadata.hasPendingWrites, ...d.data() }));
    S.pendentes = S.insp.filter(i => i.pend && i.criadoPor === S.user.uid).length;
    atualizarRede(); renderInsp(); renderCadastros(); mostrarMedidor();
  });
}

// ---------- Abas ----------
$$('.tab').forEach(t => t.addEventListener('click', () => abrirAba(t.dataset.view)));
function abrirAba(v) {
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  $$('.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  scrollTo({ top: 0 });
}

// ---------- Checklist ----------
/** Itens da revisão 003 mais os extras do gestor; os extras entram antes da liberação (item 50). */
function todosItens() {
  const criticos = new Set(S.cfg.criticos || []), removidos = new Set(S.cfg.removidos || []), nomes = S.cfg.nomes || {};
  // Itens originais podem ter o nome trocado (`nomes`) ou ser excluídos (`removidos`) pelo gestor.
  const padrao = ITENS_PADRAO.map((nome, i) => ({ numero: i + 1, nome: nomes[i + 1] || nome, extra: false }));
  const extras = (S.cfg.extras || []).map(e => ({ numero: e.numero, nome: e.nome, extra: true }));
  const i = padrao.findIndex(it => it.numero === ITEM_LIBERACAO);
  return [...padrao.slice(0, i), ...extras, ...padrao.slice(i)]
    .filter(it => !removidos.has(it.numero))
    .map(it => ({ ...it, critico: criticos.has(it.numero) }));
}
function montarItens() {
  const inativos = new Set(S.cfg.inativos || []);
  S.itens = todosItens().filter(it => !inativos.has(it.numero));
  $('#itens').innerHTML = S.itens.map(it => {
    const r = respostas[it.numero] || {};
    const div = r.status === 'MU' || r.status === 'PR';
    return '<div class="item' + (div ? ' div' : '') + (r.status === 'MU' ? ' mu' : '') + '" id="it' + it.numero + '">' +
      '<span class="n">' + it.numero + '</span>' +
      '<span class="nome">' + esc(it.nome) + (it.critico ? '<span class="crit">(*)</span>' : '') + '</span>' +
      '<div class="seg" role="group" aria-label="Situação do item ' + it.numero + '">' +
        ['OK', 'MU', 'PR', 'NA'].map(s => '<button type="button" class="seg-b" data-n="' + it.numero + '" data-s="' + s + '" aria-pressed="' + (r.status === s) + '">' + s + '</button>').join('') +
      '</div>' +
      '<div class="obs"' + (div ? '' : ' hidden') + '><textarea class="inp" maxlength="1000" data-obs="' + it.numero + '" placeholder="Descreva a divergência (obrigatório)">' + esc(r.obs || '') + '</textarea></div>' +
    '</div>';
  }).join('');
  contar();
}

$('#itens').addEventListener('click', e => {
  const b = e.target.closest('.seg-b');
  if (b) marcar(Number(b.dataset.n), b.dataset.s);
});
$('#itens').addEventListener('input', e => {
  const t = e.target.closest('[data-obs]');
  if (!t) return;
  const n = Number(t.dataset.obs);
  respostas[n] = Object.assign(respostas[n] || {}, { obs: t.value });
  if (t.value.trim()) $('#it' + n).classList.remove('erro');
});

function marcar(n, s) {
  respostas[n] = Object.assign(respostas[n] || {}, { status: s });
  const el = $('#it' + n);
  el.querySelectorAll('.seg-b').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === s)));
  const div = s === 'MU' || s === 'PR';
  el.classList.toggle('div', div); el.classList.toggle('mu', s === 'MU'); el.classList.remove('erro');
  el.querySelector('.obs').hidden = !div;
  if (div) el.querySelector('textarea').focus();
  contar();
}
$('#btnRestantesOk').addEventListener('click', () => S.itens.forEach(it => { if (!(respostas[it.numero] || {}).status) marcar(it.numero, 'OK'); }));

function contar() {
  const c = { OK: 0, MU: 0, PR: 0, NA: 0 };
  S.itens.forEach(it => { const st = (respostas[it.numero] || {}).status; if (st in c) c[st]++; });
  Object.keys(c).forEach(k => { $('#c' + k).textContent = c[k]; });
  $('#cFalta').textContent = S.itens.length - c.OK - c.MU - c.PR - c.NA;
}

// ---------- KM / horímetro ----------
// A leitura atual do equipamento é a maior entre a do cadastro e a do último checklist já carregado.
const UNID = { KM: 'km', HR: 'h' };
const fmtNum = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
// Aceita o jeito brasileiro: "12.345,6" ou "12.345" (ponto de milhar) e também "12345.6".
const lerNum = s => {
  let t = String(s || '').trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
function leituraAtual(e) {
  let atual = typeof e.medidorAtual === 'number' ? { valor: e.medidorAtual, em: e.medidorEm } : null;
  S.insp.forEach(i => {
    if (i.placaId === e.id && typeof i.kmHrValor === 'number' && (!atual || i.kmHrValor > atual.valor)) atual = { valor: i.kmHrValor, em: i.criadoEm || i.criadoEmLocal };
  });
  return atual;
}
function mostrarMedidor() {
  const p = $('#placa').value.trim().toUpperCase();
  const e = S.equip.find(x => String(x.placa).toUpperCase() === p);
  const tipo = e && e.tipoMedidor;
  $('#kmHrLbl').textContent = tipo === 'HR' ? 'Horímetro atual (h) *' : tipo === 'KM' ? 'KM atual *' : 'KM / HR';
  const a = e && leituraAtual(e);
  // A última leitura fica como texto de fundo do campo e some quando a pessoa digita.
  $('#kmHr').placeholder = a ? 'Último: ' + fmtNum(a.valor) + ' ' + (UNID[tipo] || '') + (a.em ? ' (' + fmt(a.em).slice(0, 5) + ')' : '') : '';
}
$('#placa').addEventListener('change', function () {
  const p = this.value.trim().toUpperCase();
  const e = S.equip.find(x => String(x.placa).toUpperCase() === p);
  mostrarMedidor();
  if (!e) return;
  if (!$('#equipamento').value) $('#equipamento').value = e.equipamento || '';
  if (!$('#equipe').value) $('#equipe').value = e.equipe || '';
  if (e.cabine) $('#cabine').value = e.cabine;
});
$('#placa').addEventListener('input', mostrarMedidor);

// Trava contra cliques repetidos: o botão fica desligado durante o envio e por alguns segundos depois.
const ESPERA_ENTRE_ENVIOS_MS = 5000;
let enviando = false;
$('#btnEnviar').addEventListener('click', async () => {
  if (enviando) return;
  enviando = true;
  const btn = $('#btnEnviar');
  btn.disabled = true; btn.textContent = 'Registrando…';
  try {
    await enviarChecklist();
  } finally {
    setTimeout(() => { enviando = false; btn.disabled = false; btn.textContent = 'Registrar checklist'; }, ESPERA_ENTRE_ENVIOS_MS);
  }
});

async function enviarChecklist() {
  const v = id => $('#' + id).value.trim();
  const err = $('#erroEnvio'); err.hidden = true;
  const falhar = msg => { err.hidden = false; err.textContent = msg; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const faltam = [['placa', 'Placa'], ['equipamento', 'Equipamento'], ['avaliador', 'Avaliador']].filter(([id]) => !v(id));
  if (faltam.length) {
    err.hidden = false; err.textContent = 'Preencha: ' + faltam.map(f => f[1]).join(', ') + '.';
    $('#' + faltam[0][0]).focus(); return;
  }
  let primeiro = null;
  const lista = S.itens.map(it => {
    const r = respostas[it.numero] || {};
    const ruim = !r.status || ((r.status === 'MU' || r.status === 'PR') && !(r.obs || '').trim());
    $('#it' + it.numero).classList.toggle('erro', ruim);
    if (ruim && !primeiro) primeiro = $('#it' + it.numero);
    return { numero: it.numero, nome: it.nome, status: r.status || '', obs: (r.obs || '').trim() };
  });
  if (primeiro) {
    err.hidden = false; err.textContent = 'Há itens sem resposta ou divergências sem descrição (destacados em vermelho).';
    primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }

  // Só equipamento cadastrado, e um checklist por equipamento por dia (o banco também exige isso).
  const placa = v('placa').toUpperCase();
  const equip = S.equip.find(e => String(e.placa).toUpperCase() === placa);
  if (!equip) return falhar('A placa ' + placa + ' não está cadastrada. Peça ao gestor para cadastrar o equipamento.');
  const dataInspecao = v('dataInspecao') || hojeISO();
  const atraso = Date.now() - new Date(dataInspecao + 'T12:00:00');
  if (atraso > 30 * 864e5 || atraso < -864e5) return falhar('A data da inspeção precisa ser de hoje ou dos últimos 30 dias.');
  // KM / horímetro: obrigatório quando o equipamento tem medidor; não pode voltar para trás.
  const tipo = equip.tipoMedidor || '', un = UNID[tipo] || '';
  const valor = lerNum(v('kmHr'));
  if (Number.isNaN(valor)) { $('#kmHr').focus(); return falhar('O KM / horímetro precisa ser um número.'); }
  if (tipo && valor == null) { $('#kmHr').focus(); return falhar('Informe o ' + (tipo === 'HR' ? 'horímetro' : 'KM') + ' atual do equipamento.'); }
  const ant = leituraAtual(equip);
  let rodado = null;
  if (valor != null && ant) {
    rodado = Math.round((valor - ant.valor) * 10) / 10;
    if (rodado < 0) { $('#kmHr').focus(); return falhar('O valor informado (' + fmtNum(valor) + ' ' + un + ') é menor que a última leitura (' + fmtNum(ant.valor) + ' ' + un + '). Confira o painel ou peça ao gestor para corrigir o cadastro.'); }
    const limite = tipo === 'HR' ? 300 : 5000;
    if (rodado > limite && !confirm('Desde a última leitura foram ' + fmtNum(rodado) + ' ' + un + '. Está certo?')) { $('#kmHr').focus(); return; }
  }

  const inspId = equip.id + '_' + dataInspecao;
  if (await checklistExiste(inspId)) {
    return falhar('Já existe um checklist do equipamento ' + placa + ' em ' + fmtData(dataInspecao) + '. Se precisar corrigir, fale com o gestor.');
  }

  const r = registrarChecklist(inspId, {
    dataInspecao, placaId: equip.id, equipamento: v('equipamento'), placa,
    kmHr: valor == null ? '' : fmtNum(valor) + (un ? ' ' + un : ''), kmHrValor: valor, kmHrTipo: tipo, kmHrAnterior: ant ? ant.valor : null, kmHrRodado: rodado,
    avaliador: v('avaliador'), equipe: v('equipe'), cabine: v('cabine'), respostas: lista,
  });

  // Atualiza a leitura do cadastro em gravação separada: se falhar, o checklist não é afetado.
  if (valor != null && (!ant || valor >= ant.valor)) {
    updateDoc(doc(db, 'equipamentos', equip.id), { medidorAtual: valor, medidorEm: serverTimestamp(), medidorPor: S.user.uid }).catch(() => {});
  }

  const ok = $('#okMsg'); ok.hidden = false;
  ok.innerHTML = '<b>Checklist ' + esc(r.codigo) + (navigator.onLine ? ' registrado.' : ' salvo no aparelho.</b> Será enviado sozinho quando houver internet.<b>') +
    '</b> Liberado para atividades: <b>' + r.liberado + '</b>. ' +
    (rodado != null ? 'Rodou <b>' + fmtNum(rodado) + ' ' + un + '</b> desde a última conferência. ' : '') +
    (r.reqs.length ? r.reqs.length + ' requerimento(s) de OS: ' + r.reqs.map(q => esc(q.codigo) + (q.novo ? '' : ' (somado a um já aberto)')).join(', ') + '.' : 'Nenhuma divergência.');
  limparFormulario();
  toast(navigator.onLine ? 'Checklist registrado' : 'Salvo offline. Envio automático quando conectar.');
  scrollTo({ top: 0, behavior: 'smooth' });
}

/** Online consulta o servidor; offline usa o que já está no aparelho. */
async function checklistExiste(inspId) {
  if (S.insp.some(i => i.id === inspId)) return true;
  if (!navigator.onLine) return false;
  try {
    return (await Promise.race([getDoc(doc(db, 'inspecoes', inspId)), new Promise((_, f) => setTimeout(f, 6000))])).exists();
  } catch (e) { return false; }
}

/**
 * Grava inspeção + requerimentos num único lote. Não espera o servidor: offline o
 * lote fica na fila do Firestore e sobe sozinho quando a conexão voltar.
 */
function registrarChecklist(inspId, d) {
  const batch = writeBatch(db);
  const inspRef = doc(db, 'inspecoes', inspId);
  const cod = codigo('CHK');
  const agora = Date.now();
  const criticos = new Set(S.cfg.criticos || []);
  const divergencias = d.respostas.filter(r => r.status === 'MU' || r.status === 'PR');
  const reqs = [];

  divergencias.forEach(item => {
    const alta = item.status === 'MU' || criticos.has(item.numero);
    const existente = S.reqAbertos.find(q => q.placa === d.placa && q.itemNumero === item.numero);
    if (existente) {
      const upd = {
        ocorrencias: increment(1), ultimaOcorrencia: agora, inspecoes: arrayUnion(inspRef.id), ultimaInspecao: inspRef.id,
        descricao: (existente.descricao ? existente.descricao + '\n' : '') + '[' + cod + '] ' + item.obs,
      };
      if (alta) { upd.prioridade = 'ALTA'; upd.classificacao = CLASSIF[item.status]; }
      batch.update(doc(db, 'requerimentos', existente.id), upd);
      reqs.push({ codigo: existente.codigo, novo: false });
    } else {
      const ref = doc(db, 'requerimentos', inspRef.id + '_' + item.numero);
      const rc = codigo('REQ');
      batch.set(ref, {
        codigo: rc, criadoEm: serverTimestamp(), criadoEmLocal: agora, criadoPor: S.user.uid,
        inspecaoId: inspRef.id, inspecaoCodigo: cod, inspecoes: [inspRef.id], ultimaInspecao: inspRef.id,
        equipamento: d.equipamento, placa: d.placa, kmHr: d.kmHr,
        itemNumero: item.numero, itemNome: item.nome, classificacao: CLASSIF[item.status],
        prioridade: alta ? 'ALTA' : 'NORMAL', descricao: item.obs, avaliador: d.avaliador,
        responsavel: '', status: 'Aberto', numeroOS: '', fechadoEm: null, ocorrencias: 1, ultimaOcorrencia: agora,
      });
      reqs.push({ codigo: rc, novo: true });
    }
  });

  const conta = s => d.respostas.filter(r => r.status === s).length;
  const lib = d.respostas.find(r => r.numero === ITEM_LIBERACAO);
  const bloqueia = divergencias.some(r => r.status === 'MU' || criticos.has(r.numero)) || (lib && lib.status !== 'OK' && lib.status !== 'NA');
  const liberado = bloqueia ? 'NÃO' : 'SIM';
  const [a, m, dia] = d.dataInspecao.split('-').map(Number);

  batch.set(inspRef, {
    codigo: cod, ...d, diaSemana: DIAS[new Date(a, m - 1, dia).getDay()],
    contagem: { OK: conta('OK'), MU: conta('MU'), PR: conta('PR'), NA: conta('NA') },
    liberado, requerimentos: reqs.map(q => q.codigo),
    criadoPor: S.user.uid, criadoPorNome: S.perfil.nome || '', criadoEm: serverTimestamp(), criadoEmLocal: agora,
  });

  batch.commit().catch(e => toast('Falha ao enviar ' + cod + ': ' + traduzErro(e), true));
  return { codigo: cod, liberado, reqs };
}

function limparFormulario() {
  ['placa', 'equipamento', 'kmHr', 'equipe'].forEach(id => { $('#' + id).value = ''; });
  mostrarMedidor();
  $('#cabine').value = '';
  $('#dataInspecao').value = hojeISO();
  Object.keys(respostas).forEach(k => delete respostas[k]);
  montarItens();
}

// ---------- Requerimentos ----------
['#rBusca', '#rStatus', '#rPrio'].forEach(s => $(s).addEventListener('input', () => { paginas.req = 0; renderReq(); }));
$('#pg-req').addEventListener('pagina', renderReq);
$('#rStatus').innerHTML = '<option value="abertos">Em aberto</option><option value="">Todos os status</option>' + STATUS_REQ.map(s => '<option>' + s + '</option>').join('');

function renderReq() {
  const abertos = S.reqAbertos;
  $('#reqBadge').hidden = !abertos.length; $('#reqBadge').textContent = abertos.length;
  const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
  const concluidosMes = S.reqRecentes.filter(r => r.status === 'Concluído' && r.fechadoEm && r.fechadoEm.toDate && r.fechadoEm.toDate() >= ini).length;
  const kpi = (lbl, val, sub, alert) => '<div class="kpi' + (alert ? ' alert' : '') + '"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="sub">' + sub + '</span></div>';
  $('#reqKpis').innerHTML =
    kpi('Em aberto', abertos.length, 'aguardando tratamento') +
    kpi('Prioridade alta', abertos.filter(r => r.prioridade === 'ALTA').length, 'MU ou item crítico', true) +
    kpi('Com OS aberta', abertos.filter(r => r.status === 'OS aberta').length, 'em execução') +
    kpi('Concluídos no mês', concluidosMes, ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  const q = $('#rBusca').value.trim().toLowerCase(), st = $('#rStatus').value, pr = $('#rPrio').value;
  const base = st === 'abertos'
    ? [...abertos].sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0))
    : S.reqRecentes.filter(r => !st || r.status === st);
  const lista = base.filter(r => (!pr || r.prioridade === pr) &&
    (!q || [r.codigo, r.placa, r.equipamento, r.itemNome, r.numeroOS].join(' ').toLowerCase().includes(q)));
  $('#reqCont').textContent = lista.length + ' requerimento(s)';
  const maisReq = st !== 'abertos' && S.reqRecentes.length >= LIM.req ? () => { LIM.req += 500; ouvirReqRecentes(); } : null;
  $('#reqTbody').innerHTML = lista.length ? paginar('req', lista.map(r =>
    '<tr class="click" data-id="' + esc(r.id) + '">' +
      '<td class="mono">' + esc(r.codigo) + (r.pend ? ' <span class="tag-pend">a enviar</span>' : '') + '</td>' +
      '<td class="nw dim">' + esc(fmt(r.criadoEm || r.criadoEmLocal)) + '</td>' +
      '<td class="mono">' + esc(r.placa) + '</td>' +
      '<td>' + esc(r.equipamento) + '</td>' +
      '<td><span class="dim">' + esc(r.itemNumero) + '</span> ' + esc(r.itemNome) + '</td>' +
      '<td><span class="prio-' + slug(r.prioridade) + '">' + esc(r.prioridade) + '</span> <span class="dim">' + esc(String(r.classificacao || '').slice(0, 2)) + '</span></td>' +
      '<td class="r mono">' + esc(r.ocorrencias) + '</td>' +
      '<td class="mono">' + (esc(r.numeroOS) || '<span class="dim">—</span>') + '</td>' +
      '<td><span class="pill s-' + slug(r.status) + '">' + esc(r.status) + '</span></td>' +
    '</tr>'), maisReq)
    : (paginar('req', [], maisReq), '') + '<tr><td colspan="9"><div class="empty"><h3>Nenhum requerimento</h3><p>Quando um checklist tiver itens MU ou PR, os requerimentos aparecem aqui.</p></div></td></tr>';
}

$('#reqTbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const r = S.reqRecentes.find(x => x.id === tr.dataset.id) || S.reqAbertos.find(x => x.id === tr.dataset.id);
  if (r) abrirReq(r);
});

// ---------- Finalizados (gestor) ----------
['#fBusca', '#fPeriodo', '#fStatus'].forEach(s => $(s).addEventListener('input', () => { paginas.fin = 0; renderFinalizados(); }));
$('#pg-fin').addEventListener('pagina', renderFinalizados);
const paraData = v => v && v.toDate ? v.toDate() : (typeof v === 'number' ? new Date(v) : null);
const diasAteFechar = r => {
  const a = paraData(r.criadoEm || r.criadoEmLocal), f = paraData(r.fechadoEm);
  return a && f ? Math.max(0, Math.round((f - a) / 86400000)) : null;
};
function filtrarFinalizados() {
  const q = $('#fBusca').value.trim().toLowerCase(), st = $('#fStatus').value, per = $('#fPeriodo').value;
  let ini = null;
  if (per === 'mes') { ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0); }
  else if (per === 'ano') { ini = new Date(new Date().getFullYear(), 0, 1); }
  else if (per) { ini = new Date(Date.now() - Number(per) * 86400000); }
  return S.reqFinalizados.filter(r => {
    const f = paraData(r.fechadoEm);
    return (!st || r.status === st) && (!ini || (f && f >= ini)) &&
      (!q || [r.codigo, r.placa, r.equipamento, r.itemNome, r.numeroOS, r.responsavel].join(' ').toLowerCase().includes(q));
  });
}
function renderFinalizados() {
  const lista = filtrarFinalizados();
  const concl = lista.filter(r => r.status === 'Concluído');
  const dias = concl.map(diasAteFechar).filter(d => d != null);
  const media = dias.length ? (dias.reduce((a, b) => a + b, 0) / dias.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—';
  const kpi = (lbl, val, sub, alert) => '<div class="kpi' + (alert ? ' alert' : '') + '"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="sub">' + sub + '</span></div>';
  const periodo = $('#fPeriodo').selectedOptions[0].textContent.toLowerCase();
  $('#finKpis').innerHTML =
    kpi('Finalizados', lista.length, periodo) +
    kpi('Concluídos', concl.length, 'serviço realizado') +
    kpi('Cancelados', lista.length - concl.length, 'sem execução') +
    kpi('Tempo médio', media + (dias.length ? ' d' : ''), 'da abertura à conclusão');
  renderGraficosFin(lista);
  $('#finCont').textContent = lista.length + ' requerimento(s)';
  $('#finTbody').innerHTML = lista.length ? paginar('fin', lista.map(r => {
    const d = diasAteFechar(r);
    return '<tr class="click" data-id="' + esc(r.id) + '">' +
      '<td class="mono">' + esc(r.codigo) + (r.pend ? ' <span class="tag-pend">a enviar</span>' : '') + '</td>' +
      '<td class="nw dim">' + esc(fmt(r.criadoEm || r.criadoEmLocal)) + '</td>' +
      '<td class="nw">' + esc(fmt(r.fechadoEm)) + '</td>' +
      '<td class="r mono">' + (d == null ? '<span class="dim">—</span>' : d) + '</td>' +
      '<td class="mono">' + esc(r.placa) + '</td>' +
      '<td>' + esc(r.equipamento) + '</td>' +
      '<td><span class="dim">' + esc(r.itemNumero) + '</span> ' + esc(r.itemNome) + '</td>' +
      '<td><span class="prio-' + slug(r.prioridade) + '">' + esc(r.prioridade) + '</span></td>' +
      '<td class="mono">' + (esc(r.numeroOS) || '<span class="dim">—</span>') + '</td>' +
      '<td>' + (esc(r.responsavel) || '<span class="dim">—</span>') + '</td>' +
      '<td><span class="pill s-' + slug(r.status) + '">' + esc(r.status) + '</span></td>' +
    '</tr>';
  }))
    : (paginar('fin', []), '') + '<tr><td colspan="11"><div class="empty"><h3>Nenhum requerimento finalizado</h3><p>Quando um requerimento for marcado como Concluído ou Cancelado, ele aparece aqui. Tente outro período.</p></div></td></tr>';
}
function renderGraficosFin(lista) {
  const bloco = (titulo, extra, corpo) => '<div class="block"><div class="block-h"><h2>' + titulo + '</h2>' + (extra ? '<span>' + extra + '</span>' : '') + '</div><div class="block-b">' + corpo + '</div></div>';
  const vazio = '<p class="hint">Sem dados no filtro atual.</p>';

  // Últimos 6 meses (ignora o filtro de período para mostrar a tendência)
  const meses = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); meses.push({ ano: d.getFullYear(), mes: d.getMonth(), ok: 0, can: 0, d }); }
  const st = $('#fStatus').value;
  S.reqFinalizados.forEach(r => {
    const f = paraData(r.fechadoEm); if (!f || (st && r.status !== st)) return;
    const m = meses.find(x => x.ano === f.getFullYear() && x.mes === f.getMonth());
    if (m) m[r.status === 'Concluído' ? 'ok' : 'can']++;
  });
  const maxM = Math.max(1, ...meses.map(m => m.ok + m.can));
  const colunas = '<div class="cols">' + meses.map(m => {
    const t = m.ok + m.can, hOk = m.ok / maxM * 100, hCan = m.can / maxM * 100;
    return '<div class="col" title="' + m.ok + ' concluído(s), ' + m.can + ' cancelado(s)"><div class="col-bar">' +
      (t ? '<b style="bottom:calc(' + (hOk + hCan) + '% + 2px)">' + t + '</b>' : '') +
      (m.can ? '<span class="c-can" style="height:' + hCan + '%"></span>' : '') +
      (m.ok ? '<span class="c-ok" style="height:' + hOk + '%"></span>' : '') +
      '</div><small>' + m.d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '</small></div>';
  }).join('') + '</div>';
  const leg = '<div class="chart-leg"><span><i style="background:var(--ok)"></i>Concluídos</span><span><i style="background:#9A9A9A"></i>Cancelados</span></div>';

  const ranking = (chave, rotulo, alt) => {
    const cont = {};
    lista.forEach(r => { const k = chave(r); if (k) cont[k] = (cont[k] || 0) + 1; });
    const top = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!top.length) return vazio;
    return '<div class="hbars">' + top.map(([k, v]) =>
      '<div class="hbar"><span class="t" title="' + esc(k) + '">' + esc(rotulo(k)) + '</span><span class="v">' + v + '</span>' +
      '<div class="track"><span' + (alt ? ' class="alt"' : '') + ' style="width:' + (v / top[0][1] * 100) + '%"></span></div></div>').join('') + '</div>';
  };
  const equipDe = {}; lista.forEach(r => { equipDe[r.placa] = r.equipamento; });

  $('#finCharts').innerHTML =
    bloco('Finalizados por mês', leg, colunas) +
    bloco('Equipamentos com mais OS', 'no filtro', ranking(r => r.placa, k => k + (equipDe[k] ? ' · ' + equipDe[k] : ''), true)) +
    bloco('Itens que mais dão problema', 'no filtro', ranking(r => r.itemNumero ? r.itemNumero + ' · ' + r.itemNome : '', k => k));
}

$('#finTbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  const r = tr && S.reqFinalizados.find(x => x.id === tr.dataset.id);
  if (r) abrirReq(r);
});
$('#btnFinCsv').addEventListener('click', () => {
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const linhas = [['Requerimento', 'Abertura', 'Fechamento', 'Dias', 'Placa', 'Equipamento', 'Item', 'Classificação', 'Prioridade', 'Ocorrências', 'Nº OS', 'Responsável', 'Status', 'Divergência']]
    .concat(filtrarFinalizados().map(r => [r.codigo, fmt(r.criadoEm || r.criadoEmLocal), fmt(r.fechadoEm), diasAteFechar(r), r.placa, r.equipamento,
      r.itemNumero + ' - ' + r.itemNome, r.classificacao, r.prioridade, r.ocorrencias, r.numeroOS, r.responsavel, r.status, r.descricao]));
  const blob = new Blob(['\ufeff' + linhas.map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'requerimentos-finalizados-' + hojeISO() + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/** Próximo Nº de OS: o maior número já usado + 1, mantendo o formato (ex.: "OS-0012" vira "OS-0013"). */
function proximaOS(ignorarId) {
  let melhor = null;
  [...S.reqAbertos, ...S.reqRecentes, ...S.reqFinalizados].forEach(q => {
    if (q.id === ignorarId) return;
    const m = String(q.numeroOS || '').trim().match(/^(.*?)(\d+)(\D*)$/);
    if (m && (!melhor || Number(m[2]) > melhor.n)) melhor = { n: Number(m[2]), pre: m[1], dig: m[2].length, suf: m[3] };
  });
  if (!melhor) return '1';
  return melhor.pre + String(melhor.n + 1).padStart(melhor.dig, '0') + melhor.suf;
}

function abrirReq(r) {
  const campos = [['Abertura', fmt(r.criadoEm || r.criadoEmLocal)], ['Inspeção', r.inspecaoCodigo], ['Placa / prefixo', r.placa],
    ['Equipamento', r.equipamento], ['KM / HR', r.kmHr], ['Item', r.itemNumero + ' · ' + r.itemNome], ['Classificação', r.classificacao],
    ['Prioridade', r.prioridade], ['Avaliador', r.avaliador], ['Ocorrências', r.ocorrencias], ['Última ocorrência', fmt(r.ultimaOcorrencia)],
    ['Fechamento', fmt(r.fechadoEm)], ['Divergência', r.descricao]].filter(([, v]) => v !== '' && v != null);
  const pode = gestor();
  $('#modalRoot').innerHTML =
    '<div class="ov" id="ov"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="block-h"><h2>' + esc(r.codigo) + '</h2><button class="modal-x" id="mX" aria-label="Fechar">×</button></div>' +
      '<div class="modal-b"><dl class="kv">' + campos.map(([l, v]) => '<dt>' + l + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
        '<p class="section-t">Tratamento</p>' +
        '<div class="row">' +
          '<div class="field"><label for="mStatus">Status</label><select id="mStatus" class="inp"' + (pode ? '' : ' disabled') + '>' + STATUS_REQ.map(s => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
          '<div class="field"><label for="mOS">Nº da OS</label><input id="mOS" class="inp" value="' + esc(r.numeroOS) + '"' + (pode ? '' : ' readonly') + '></div>' +
          '<div class="field"><label for="mResp">Responsável</label><input id="mResp" class="inp" value="' + esc(r.responsavel) + '"' + (pode ? '' : ' readonly') + '></div>' +
        '</div>' + (pode ? '' : '<p class="hint">Somente o gestor altera o tratamento.</p>') + '</div>' +
      '<div class="modal-f"><button class="btn" id="mCancelar">' + (pode ? 'Cancelar' : 'Fechar') + '</button>' + (pode ? '<button class="btn primary" id="mSalvar">Salvar</button>' : '') + '</div>' +
    '</div></div>';
  const fechar = () => { $('#modalRoot').innerHTML = ''; };
  $('#mX').onclick = fechar; $('#mCancelar').onclick = fechar;
  $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') fechar(); });
  if (!pode) return;
  // Ao marcar "OS aberta" com o campo vazio, já sugere o próximo número.
  const sugerir = () => { if ($('#mStatus').value === 'OS aberta' && !$('#mOS').value.trim()) $('#mOS').value = proximaOS(r.id); };
  $('#mStatus').addEventListener('change', sugerir); sugerir();
  $('#mSalvar').onclick = () => {
    const status = $('#mStatus').value;
    const fechado = status === 'Concluído' || status === 'Cancelado';
    updateDoc(doc(db, 'requerimentos', r.id), {
      status, numeroOS: $('#mOS').value.trim(), responsavel: $('#mResp').value.trim(),
      fechadoEm: fechado ? (r.fechadoEm || serverTimestamp()) : null,
    }).catch(e => toast(traduzErro(e), true));
    fechar();
    toast(navigator.onLine ? 'Requerimento atualizado' : 'Atualização salva offline');
  };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modalRoot').innerHTML = ''; });

// ---------- Inspeções ----------
$('#iBusca').addEventListener('input', () => { paginas.insp = 0; renderInsp(); });
$('#pg-insp').addEventListener('pagina', renderInsp);
function renderInsp() {
  const q = $('#iBusca').value.trim().toLowerCase();
  const lista = S.insp.filter(r => !q || [r.codigo, r.placa, r.equipamento, r.avaliador].join(' ').toLowerCase().includes(q));
  $('#inspCont').textContent = lista.length + ' registro(s)';
  const maisInsp = S.insp.length >= LIM.insp ? () => { LIM.insp += 300; ouvirInsp(); } : null;
  $('#inspTbody').innerHTML = lista.length ? paginar('insp', lista.map(r => {
    const c = r.contagem || {};
    return '<tr>' +
      '<td class="mono">' + esc(r.codigo) + (r.pend ? ' <span class="tag-pend">a enviar</span>' : '') + '</td>' +
      '<td class="nw">' + esc(fmtData(r.dataInspecao)) + '</td>' +
      '<td class="dim">' + esc(r.diaSemana) + '</td>' +
      '<td class="mono">' + esc(r.placa) + '</td>' +
      '<td>' + esc(r.equipamento) + '</td>' +
      '<td>' + esc(r.avaliador) + '</td>' +
      '<td class="r nw mono">' + (esc(r.kmHr) || '<span class="dim">—</span>') + (r.kmHrRodado != null ? ' <span class="dim">(+' + fmtNum(r.kmHrRodado) + ')</span>' : '') + '</td>' +
      '<td class="r mono">' + (c.OK || 0) + '</td>' +
      '<td class="r mono"' + (c.MU ? ' style="color:var(--accent)"' : '') + '>' + (c.MU || 0) + '</td>' +
      '<td class="r mono"' + (c.PR ? ' style="color:var(--warn)"' : '') + '>' + (c.PR || 0) + '</td>' +
      '<td class="r mono">' + (c.NA || 0) + '</td>' +
      '<td><span class="pill s-' + slug(r.liberado) + '">' + esc(r.liberado) + '</span></td>' +
      '<td class="dim">' + (esc((r.requerimentos || []).join(', ')) || '—') + '</td>' +
    '</tr>';
  }), maisInsp)
    : (paginar('insp', [], maisInsp), '') + '<tr><td colspan="13"><div class="empty"><h3>Nenhuma inspeção ainda</h3><p>Os checklists registrados aparecem aqui.</p></div></td></tr>';
}

// ---------- Cadastros (gestor) ----------
function renderCadastros() {
  if (!gestor()) return;
  $('#eqTbody').innerHTML = S.equip.length ? S.equip.map(e =>
    '<tr><td class="mono">' + esc(e.placa) + '</td><td>' + esc(e.equipamento) + '</td><td>' + esc(e.equipe) + '</td><td>' + esc(e.cabine) + '</td>' +
    '<td class="r mono">' + (() => { const a = leituraAtual(e); return a ? fmtNum(a.valor) + ' ' + (UNID[e.tipoMedidor] || '') : '<span class="dim">—</span>'; })() + '</td>' +
    '<td class="r nw"><button class="btn sm" data-edit-eq="' + esc(e.id) + '">Editar</button> <button class="btn sm" data-del-eq="' + esc(e.id) + '">Remover</button></td></tr>').join('')
    : '<tr><td colspan="6" class="dim">Nenhum equipamento cadastrado.</td></tr>';
  const criticos = new Set(S.cfg.criticos || []), inativos = new Set(S.cfg.inativos || []);
  const livres = MAX_ITEM - ultimoNumero();
  $('#novoItemInfo').textContent = livres > 0 ? 'Ainda cabem ' + livres + ' item(ns) novo(s).' : 'Limite de itens novos atingido. Desative os que não usa mais.';
  $('#novoItemNome').disabled = $('#btnNovoItem').disabled = livres <= 0;
  $('#cfgItens').innerHTML = todosItens().map(it => {
    const n = it.numero;
    return '<tr><td class="dim">' + n + '</td><td>' + esc(it.nome) + (it.extra ? ' <span class="tag-pend" style="color:var(--ok);border-color:var(--ok)">novo</span>' : '') + '</td>' +
      '<td><label class="chk"><input type="checkbox" data-crit="' + n + '"' + (criticos.has(n) ? ' checked' : '') + '> crítico</label></td>' +
      '<td><label class="chk"><input type="checkbox" data-ativo="' + n + '"' + (inativos.has(n) ? '' : ' checked') + '> ativo</label></td>' +
      '<td class="r nw"><button type="button" class="btn sm" data-edit-item="' + n + '">Editar</button> <button type="button" class="btn sm" data-del-item="' + n + '">Excluir</button></td></tr>';
  }).join('');
  const nRem = (S.cfg.removidos || []).length;
  $('#restaurarItens').hidden = !nRem;
  $('#restaurarItens').textContent = 'Restaurar ' + nRem + ' item(ns) original(is) excluído(s)';
}

$('#formEq').addEventListener('submit', e => {
  e.preventDefault();
  const placa = $('#eqPlaca').value.trim().toUpperCase();
  if (!placa) return;
  const leitura = lerNum($('#eqMedidor').value);
  if (Number.isNaN(leitura)) { toast('O KM / horímetro atual precisa ser um número.', true); return; }
  const dados = { placa, equipamento: $('#eqNome').value.trim(), equipe: $('#eqEquipe').value.trim(), cabine: $('#eqCabine').value, tipoMedidor: $('#eqTipo').value };
  // O gestor pode corrigir a leitura para qualquer valor; vazio mantém a atual.
  if (leitura != null) Object.assign(dados, { medidorAtual: leitura, medidorEm: serverTimestamp(), medidorPor: S.user.uid });
  setDoc(doc(db, 'equipamentos', idPlaca(placa)), dados, { merge: true }).then(() => toast('Equipamento salvo')).catch(ex => toast(traduzErro(ex), true));
  e.target.reset(); $('#eqBtn').textContent = 'Adicionar';
});
$('#eqTbody').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit-eq]');
  const eq = ed && S.equip.find(x => x.id === ed.dataset.editEq);
  if (eq) {
    $('#eqPlaca').value = eq.placa || ''; $('#eqNome').value = eq.equipamento || ''; $('#eqEquipe').value = eq.equipe || '';
    $('#eqCabine').value = eq.cabine || ''; $('#eqTipo').value = eq.tipoMedidor || '';
    const a = leituraAtual(eq); $('#eqMedidor').value = a ? String(a.valor).replace('.', ',') : '';
    $('#eqBtn').textContent = 'Salvar'; $('#eqPlaca').focus(); return;
  }
  const b = e.target.closest('[data-del-eq]');
  if (b && confirm('Remover este equipamento do cadastro?')) deleteDoc(doc(db, 'equipamentos', b.dataset.delEq)).catch(ex => toast(traduzErro(ex), true));
});
$('#cfgItens').addEventListener('change', () => {
  const criticos = $$('[data-crit]').filter(c => c.checked).map(c => Number(c.dataset.crit));
  const inativos = $$('[data-ativo]').filter(c => !c.checked).map(c => Number(c.dataset.ativo));
  setDoc(doc(db, 'config', 'checklist'), { criticos, inativos }, { merge: true }).catch(ex => toast(traduzErro(ex), true));
});
$('#cfgItens').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit-item]'), del = e.target.closest('[data-del-item]');
  if (!ed && !del) return;
  const n = Number((ed || del).dataset.editItem || (ed || del).dataset.delItem);
  const extras = S.cfg.extras || [], item = todosItens().find(x => x.numero === n);
  if (!item) return;
  const salvar = (dados, msg) => setDoc(doc(db, 'config', 'checklist'), dados, { merge: true }).then(() => toast(msg)).catch(ex => toast(traduzErro(ex), true));
  if (ed) {
    const nome = (prompt('Novo nome do item ' + n + ':', item.nome) || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!nome || nome === item.nome) return;
    if (todosItens().some(it => it.nome === nome)) { toast('Já existe um item com esse nome.', true); return; }
    if (item.extra) salvar({ extras: extras.map(x => x.numero === n ? { numero: n, nome } : x) }, 'Item ' + n + ' renomeado');
    else salvar({ nomes: { ...(S.cfg.nomes || {}), [n]: nome } }, 'Item ' + n + ' renomeado');
    return;
  }
  const aviso = n === ITEM_LIBERACAO ? '\n\nAtenção: este item decide a liberação para atividades. Sem ele, só MU ou item crítico com divergência bloqueiam o equipamento.' : '';
  if (!confirm('Excluir o item ' + n + ' - ' + item.nome + '?\n\nEle sai do checklist. Checklists e requerimentos antigos continuam com o registro dele.' + aviso)) return;
  const limpar = { criticos: (S.cfg.criticos || []).filter(x => x !== n), inativos: (S.cfg.inativos || []).filter(x => x !== n) };
  if (!item.extra) { salvar({ ...limpar, removidos: [...new Set([...(S.cfg.removidos || []), n])] }, 'Item ' + n + ' excluído'); return; }
  // Se o item já gerou requerimento, o número fica reservado para não misturar o histórico.
  let usado = true;
  try { usado = !(await getDocs(query(collection(db, 'requerimentos'), where('itemNumero', '==', n), limit(1)))).empty; } catch (ex) { /* offline: reserva por segurança */ }
  salvar({
    ...limpar, extras: extras.filter(x => x.numero !== n),
    retirados: usado ? [...new Set([...(S.cfg.retirados || []), n])] : (S.cfg.retirados || []),
  }, 'Item ' + n + ' excluído');
});
$('#restaurarItens').addEventListener('click', () => {
  setDoc(doc(db, 'config', 'checklist'), { removidos: [] }, { merge: true })
    .then(() => toast('Itens originais restaurados')).catch(ex => toast(traduzErro(ex), true));
});
$('#formItem').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('#novoItemNome').value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!nome) return;
  if (todosItens().some(it => it.nome === nome)) { toast('Já existe um item com esse nome.', true); return; }
  const extras = S.cfg.extras || [];
  // Número nunca reaproveitado, para não misturar o histórico de requerimentos.
  const numero = ultimoNumero() + 1;
  if (numero > MAX_ITEM) { toast('Limite de itens atingido.', true); return; }
  setDoc(doc(db, 'config', 'checklist'), { extras: [...extras, { numero, nome }] }, { merge: true })
    .then(() => toast('Item ' + numero + ' adicionado ao checklist')).catch(ex => toast(traduzErro(ex), true));
  $('#novoItemNome').value = '';
});

function renderUsuarios() {
  const lista = [...S.usuarios].sort((a, b) => Number(a.ativo) - Number(b.ativo) || String(a.nome).localeCompare(b.nome));
  const pend = lista.filter(u => !u.ativo).length;
  $('#usrBadge').hidden = !pend; $('#usrBadge').textContent = pend;
  $('#usrTbody').innerHTML = lista.map(u =>
    '<tr><td><b>' + esc(u.nome) + '</b></td><td class="dim">' + esc(u.email) + '</td>' +
    '<td><select class="inp" data-papel="' + esc(u.id) + '"' + (u.id === S.user.uid ? ' disabled' : '') + '>' +
      ['operador', 'gestor'].map(p => '<option value="' + p + '"' + (u.papel === p ? ' selected' : '') + '>' + (p === 'gestor' ? 'Gestor' : 'Operador') + '</option>').join('') + '</select></td>' +
    '<td><span class="pill s-' + (u.ativo ? 'sim' : 'nao') + '">' + (u.ativo ? 'Ativo' : 'Aguardando') + '</span></td>' +
    '<td class="r nw">' + (u.id === S.user.uid ? '' :
      '<button class="btn sm' + (u.ativo ? '' : ' primary') + '" data-ativar="' + esc(u.id) + '" data-v="' + (!u.ativo) + '">' + (u.ativo ? 'Bloquear' : 'Aprovar') + '</button> ' +
      '<button class="btn sm" data-excluir="' + esc(u.id) + '" title="Remove a pessoa da lista e tira o acesso">Excluir</button>') + '</td></tr>').join('');
}
$('#usrTbody').addEventListener('click', e => {
  const b = e.target.closest('[data-ativar]');
  if (b) updateDoc(doc(db, 'usuarios', b.dataset.ativar), { ativo: b.dataset.v === 'true' }).catch(ex => toast(traduzErro(ex), true));
  const x = e.target.closest('[data-excluir]');
  const u = x && S.usuarios.find(v => v.id === x.dataset.excluir);
  if (u && confirm('Excluir ' + (u.nome || u.email) + '?\n\nA pessoa perde o acesso e sai da lista. Os checklists que ela já fez continuam no histórico. Se tentar entrar de novo, aparece aqui como "Aguardando".')) {
    deleteDoc(doc(db, 'usuarios', u.id)).then(() => toast('Usuário excluído')).catch(ex => toast(traduzErro(ex), true));
  }
});
$('#usrTbody').addEventListener('change', e => {
  const s = e.target.closest('[data-papel]');
  if (s) updateDoc(doc(db, 'usuarios', s.dataset.papel), { papel: s.value }).catch(ex => toast(traduzErro(ex), true));
});

// ---------- Service worker (abre sem internet) ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
