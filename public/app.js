// Check List de Averiguação: PWA offline com Firebase (Auth + Firestore).
// As gravações vão primeiro para o cache local do Firestore e são enviadas
// sozinhas quando o aparelho volta a ter internet.

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const { initializeApp } = await import(SDK + 'firebase-app.js');
const {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, connectAuthEmulator, sendPasswordResetEmail,
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
auth.languageCode = 'pt-BR';
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
  equip: [], reqAbertos: [], reqRecentes: [], reqFinalizados: [], minhas: [], insp: [], usuarios: [], prev: [], pendentes: 0, subs: [],
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
const tecnico = () => S.perfil && S.perfil.papel === 'tecnico';
const PAPEIS = { operador: 'Operador', tecnico: 'Técnico', gestor: 'Gestor' };
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
  const err = $('#loginErr'); err.hidden = true; $('#loginOk').hidden = true;
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
$('#lnkSenha').addEventListener('click', async () => {
  const err = $('#loginErr'), ok = $('#loginOk'); err.hidden = true; ok.hidden = true;
  const email = $('#lEmail').value.trim();
  if (!email) { err.hidden = false; err.textContent = 'Digite seu e-mail no campo acima e clique de novo em "Esqueci minha senha".'; $('#lEmail').focus(); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    ok.hidden = false;
    ok.textContent = 'Se existir uma conta com ' + email + ', enviamos um link para criar uma senha nova. Confira também a caixa de spam.';
  } catch (ex) { err.hidden = false; err.textContent = traduzErro(ex); }
});
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
  $('#quem').innerHTML = $('#quemMenu').innerHTML = '<b>' + esc(S.perfil.nome) + '</b><span>' + (PAPEIS[S.perfil.papel] || 'Operador') + '</span>';
  $('#avatar').textContent = iniciais(S.perfil.nome);
  $$('.so-gestor').forEach(e => { e.hidden = !gestor(); });
  $$('.so-tecnico').forEach(e => { e.hidden = !tecnico(); });
  $$('.so-painel').forEach(e => { e.hidden = !gestor() && !tecnico(); });
  // Se o cargo mudou e a aba aberta sumiu, volta para o checklist.
  const aberta = $('.tab[aria-selected="true"]');
  if (aberta && aberta.hidden) abrirAba('check');
  if (!$('#avaliador').value) $('#avaliador').value = S.perfil.nome || '';
  if (!$('#dataInspecao').value) $('#dataInspecao').value = hojeISO();
  montarItens();
  if (placaDoQR) { abrirAba('check'); $('#placa').value = placaDoQR; }
  renderRelatorios();
  atualizarRede();

  const ouvir = (q, fn) => S.subs.push(onSnapshot(q, { includeMetadataChanges: true }, fn, e => console.warn(e)));

  ouvir(doc(db, 'config', 'checklist'), snap => {
    S.cfg = Object.assign({ criticos: [], inativos: [], extras: [], removidos: [], nomes: {} }, snap.exists() ? snap.data() : {});
    montarItens(); renderCadastros();
  });
  ouvir(collection(db, 'equipamentos'), snap => {
    // Data da leitura ainda não confirmada pelo servidor: usa a estimativa local, para a correção valer na hora.
    S.equip = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort((a, b) => String(a.placa).localeCompare(b.placa));
    $('#listaPlaca').innerHTML = S.equip.map(e => '<option value="' + esc(e.placa) + '">' + esc(e.equipamento) + '</option>').join('');
    $('#listaEquip').innerHTML = [...new Set(S.equip.map(e => e.equipamento))].map(v => '<option value="' + esc(v) + '">').join('');
    renderCadastros(); mostrarMedidor(); renderDia(); renderEquip();
    usarPlacaDoQR();
  });
  ouvir(collection(db, 'preventivas'), snap => {
    S.prev = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    renderEquip(); renderDia(); if (pintarPrev.eq) pintarPrev(pintarPrev.eq);
  });
  novidades.vistos = {};
  atualizarBtnAvisos();
  ouvir(query(collection(db, 'requerimentos'), where('status', 'in', STATUS_ABERTOS)), snap => {
    S.reqAbertos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReq(); renderDia();
    if (gestor()) novidades('reqs', snap).filter(r => r.prioridade === 'ALTA' && r.criadoPor !== S.user.uid)
      .forEach(r => avisar('Requerimento urgente: ' + r.placa, r.itemNumero + ' · ' + r.itemNome + (r.descricao ? ' — ' + r.descricao : ''), r.id));
  });
  if (tecnico()) {
    ouvir(query(collection(db, 'requerimentos'), where('responsavelUid', '==', S.user.uid)), snap => {
      S.minhas = snap.docs.map(d => ({ id: d.id, pend: d.metadata.hasPendingWrites, ...d.data() }))
        .sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0));
      renderMinhas();
      novidades('minhas', snap).filter(r => STATUS_ABERTOS.includes(r.status))
        .forEach(r => avisar('Nova OS para você: ' + r.placa, r.itemNumero + ' · ' + r.itemNome + (r.numeroOS ? ' · OS ' + r.numeroOS : ''), r.id));
    });
  }
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
    atualizarRede(); renderInsp(); renderCadastros(); mostrarMedidor(); renderDia(); renderEquip();
  });
}

// ---------- Abas ----------
$$('.tab').forEach(t => t.addEventListener('click', () => abrirAba(t.dataset.view)));
function abrirAba(v) {
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  const t = $('.tab[data-view="' + v + '"]');
  $('#secAtual').textContent = t ? t.firstChild.textContent.trim() : '';
  $('#btnGestao').classList.toggle('ativo', !!(t && t.closest('#listaGestao')));
  abrirMenu(false); fecharPops();
  $$('.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  scrollTo({ top: 0 });
}

// ---------- Menu do celular ----------
// Na tela estreita as abas ficam escondidas num menu que abre pelo botão do topo.
function abrirMenu(aberto) {
  $('header.top').classList.toggle('menu-aberto', aberto);
  $('#btnMenu').setAttribute('aria-expanded', String(aberto));
  $('#btnMenu').setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
  $('#menuFundo').hidden = !aberto;
}
$('#btnMenu').addEventListener('click', () => abrirMenu(!$('header.top').classList.contains('menu-aberto')));
$('#menuFundo').addEventListener('click', () => abrirMenu(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { abrirMenu(false); fecharPops(); } });
// O botão do menu mostra a soma dos avisos (números vermelhos) das abas visíveis; o "Gestão", a das abas dele.
function somarAvisos() {
  const soma = sel => $$(sel + ' .tab:not([hidden]) .badge:not([hidden])').reduce((s, b) => s + (Number(b.textContent) || 0), 0);
  const mostrar = (b, n) => { if (b.hidden !== !n) b.hidden = !n; if (b.textContent !== String(n)) b.textContent = n; };
  mostrar($('#menuBadge'), soma('#tabs'));
  mostrar($('#gestaoBadge'), soma('#listaGestao'));
}

// ---------- Menus do topo no computador (usuário e Gestão) ----------
function fecharPops(exceto) {
  $$('.pop.aberto').forEach(p => {
    if (p === exceto) return;
    p.classList.remove('aberto'); p.querySelector('[data-pop]').setAttribute('aria-expanded', 'false');
  });
}
$$('[data-pop]').forEach(b => b.addEventListener('click', () => {
  const p = b.closest('.pop'), abrir = !p.classList.contains('aberto');
  fecharPops(p);
  p.classList.toggle('aberto', abrir); b.setAttribute('aria-expanded', String(abrir));
}));
// Clicar fora ou escolher uma opção fecha o menu aberto.
document.addEventListener('click', e => { if (!e.target.closest('[data-pop]')) fecharPops(); });
function iniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
new MutationObserver(somarAvisos).observe($('#tabs'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

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
  // A legenda do (*) só aparece quando o gestor marcou algum item como crítico.
  $('#guiaCrit').hidden = !S.itens.some(it => it.critico);
  $('#itens').innerHTML = S.itens.map(it => {
    const r = respostas[it.numero] || {};
    const div = r.status === 'MU' || r.status === 'PR';
    return '<div class="item' + (div ? ' div' : '') + (r.status === 'MU' ? ' mu' : '') + '" id="it' + it.numero + '">' +
      '<span class="n">' + it.numero + '</span>' +
      '<span class="nome">' + esc(it.nome) + (it.critico ? '<span class="crit">(*)</span>' : '') + '</span>' +
      '<div class="seg" role="group" aria-label="Situação do item ' + it.numero + '">' +
        ['OK', 'MU', 'PR', 'NA'].map(s => '<button type="button" class="seg-b" data-n="' + it.numero + '" data-s="' + s + '" aria-pressed="' + (r.status === s) + '">' + s + '</button>').join('') +
      '</div>' +
      '<div class="obs"' + (div ? '' : ' hidden') + '><textarea class="inp" maxlength="1000" data-obs="' + it.numero + '" placeholder="Descreva a divergência (obrigatório)">' + esc(r.obs || '') + '</textarea>' +
        '<div class="foto-box" id="fb' + it.numero + '">' + htmlFoto(it.numero) + '</div></div>' +
    '</div>';
  }).join('');
  contar();
}

$('#itens').addEventListener('click', e => {
  const b = e.target.closest('.seg-b');
  if (b) marcar(Number(b.dataset.n), b.dataset.s);
  const x = e.target.closest('[data-tirar-foto]');
  if (x) { const n = Number(x.dataset.tirarFoto); delete (respostas[n] || {}).foto; $('#fb' + n).innerHTML = htmlFoto(n); }
  const im = e.target.closest('img.foto-mini');
  if (im) verFoto(im.src);
});
$('#itens').addEventListener('change', async e => {
  const inp = e.target.closest('[data-foto]');
  if (!inp || !inp.files[0]) return;
  const n = Number(inp.dataset.foto);
  $('#fb' + n).innerHTML = '<span class="dim">Preparando foto…</span>';
  try {
    respostas[n] = Object.assign(respostas[n] || {}, { foto: await comprimirFoto(inp.files[0]) });
  } catch (ex) { toast('Não foi possível usar essa foto.', true); }
  $('#fb' + n).innerHTML = htmlFoto(n);
});

// ---------- Fotos ----------
// A foto é reduzida no próprio aparelho (lado maior até 1024 px, JPEG) e gravada no Firestore,
// em fotos/<inspeção>_<item>. Assim ela também fica na fila quando não há internet.
function htmlFoto(n) {
  const f = (respostas[n] || {}).foto;
  return f
    ? '<img class="foto-mini" src="' + esc(f) + '" alt="Foto do item ' + n + '"><button type="button" class="btn sm" data-tirar-foto="' + n + '">Remover foto</button>'
    : '<label class="btn sm">Adicionar foto<input type="file" accept="image/*" capture="environment" data-foto="' + n + '" hidden></label><span class="dim">Opcional</span>';
}
function comprimirFoto(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image(), url = URL.createObjectURL(arquivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let lado = 1024, q = 0.6, dados = '';
      for (let i = 0; i < 4; i++) {
        const k = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        dados = c.toDataURL('image/jpeg', q);
        if (dados.length < 500000) return ok(dados);
        lado = Math.round(lado * 0.75); q = Math.max(0.4, q - 0.1);
      }
      dados.length < 900000 ? ok(dados) : falha(new Error('foto grande demais'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('imagem inválida')); };
    img.src = url;
  });
}
async function carregarFotos(ids, alvo, alt = 'Foto da divergência') {
  const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'fotos', id)).catch(() => null)));
  const fotos = docs.filter(d => d && d.exists()).map(d => d.data().dados).filter(f => String(f).startsWith('data:image/'));
  if (alvo) alvo.innerHTML = fotos.length ? fotos.map(f => '<img class="foto-mini" src="' + esc(f) + '" alt="' + alt + '">').join('') : '<span class="dim">Sem foto</span>';
  return fotos;
}
function verFoto(src) {
  const ov = document.createElement('div');
  ov.className = 'ov foto-ov'; ov.innerHTML = '<img alt="Foto ampliada">'; ov.firstChild.src = src;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}
document.addEventListener('click', e => { const im = e.target.closest('#modalRoot img.foto-mini'); if (im) verFoto(im.src); });
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
// A leitura atual do equipamento é a mais recente entre a do cadastro (o gestor pode corrigir para menos)
// e a dos checklists já carregados. Cadastro antigo sem data de leitura: vale a maior.
const UNID = { KM: 'km', HR: 'h' };
const fmtNum = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtNum2 = n => typeof n === 'number' ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
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
  const ms = v => { const d = paraData(v); return d ? d.getTime() : 0; };
  let atual = typeof e.medidorAtual === 'number' ? { valor: e.medidorAtual, em: e.medidorEm, t: ms(e.medidorEm) } : null;
  S.insp.forEach(i => {
    if (i.placaId !== e.id || typeof i.kmHrValor !== 'number') return;
    const t = i.criadoEmLocal || ms(i.criadoEm);
    if (!atual || (atual.t ? t > atual.t : i.kmHrValor > atual.valor)) atual = { valor: i.kmHrValor, em: i.criadoEm || i.criadoEmLocal, t };
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
const MAX_POR_DIA = 2;
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
    const div = r.status === 'MU' || r.status === 'PR';
    return { numero: it.numero, nome: it.nome, status: r.status || '', obs: (r.obs || '').trim(), foto: div && !!r.foto };
  });
  if (primeiro) {
    err.hidden = false; err.textContent = 'Há itens sem resposta ou divergências sem descrição (destacados em vermelho).';
    primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }

  // Só equipamento cadastrado, e até dois checklists por equipamento por dia (o banco também exige isso).
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

  // O primeiro do dia é "<placa>_<data>"; o segundo, "<placa>_<data>_2".
  let inspId = equip.id + '_' + dataInspecao;
  if (await checklistExiste(inspId)) {
    inspId += '_' + MAX_POR_DIA;
    if (await checklistExiste(inspId)) {
      return falhar('O equipamento ' + placa + ' já tem ' + MAX_POR_DIA + ' checklists em ' + fmtData(dataInspecao) + ', que é o máximo por dia. Se precisar corrigir, fale com o gestor.');
    }
  }

  const fotos = {};
  lista.forEach(it => { if (it.foto) fotos[it.numero] = respostas[it.numero].foto; });
  const r = registrarChecklist(inspId, fotos, {
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
    (r.reqs.length ? r.reqs.length + ' requerimento(s) de OS: ' + r.reqs.map(q => esc(q.codigo) + (q.novo ? '' : ' (somado a um já aberto)')).join(', ') + '.' : 'Nenhuma divergência.') +
    alertasPrev(equip, valor).map(a => '<span class="ok-prev">Preventiva <b>' + esc(a.p.nome) + '</b> ' + txtPrev(a, un) + '. Avise a manutenção.</span>').join('');
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
function registrarChecklist(inspId, fotos, d) {
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
      // Conta quantas vezes o item veio MU e quantas PR. Requerimento antigo (sem a conta) começa pelo que já tinha.
      if (existente.ocorrMU != null || existente.ocorrPR != null) upd[item.status === 'MU' ? 'ocorrMU' : 'ocorrPR'] = increment(1);
      else {
        const o = ocorrMuPr(existente);
        upd.ocorrMU = o.mu + (item.status === 'MU' ? 1 : 0); upd.ocorrPR = o.pr + (item.status === 'PR' ? 1 : 0);
      }
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
        ocorrMU: item.status === 'MU' ? 1 : 0, ocorrPR: item.status === 'PR' ? 1 : 0,
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

  Object.entries(fotos).forEach(([n, dados]) => {
    batch.set(doc(db, 'fotos', inspId + '_' + n), {
      inspecaoId: inspId, itemNumero: Number(n), dados, criadoPor: S.user.uid, criadoEm: serverTimestamp(),
    });
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
['#rBusca', '#rStatus', '#rPrio', '#rPeriodo'].forEach(s => $(s).addEventListener('input', () => { paginas.req = 0; renderReq(); }));
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

  const q = $('#rBusca').value.trim().toLowerCase(), st = $('#rStatus').value, pr = $('#rPrio').value, desde = inicioPeriodo($('#rPeriodo').value);
  const base = st === 'abertos'
    ? [...abertos].sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0))
    : S.reqRecentes.filter(r => !st || r.status === st);
  const lista = base.filter(r => (!pr || r.prioridade === pr) && (!desde || (paraData(r.criadoEm || r.criadoEmLocal) || 0) >= desde) &&
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
      '<td class="r mono"><span>' + esc(r.ocorrencias) + '<small class="ocorr">' + esc(txtMuPr(ocorrMuPr(r))) + '</small></span></td>' +
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
// Custo da OS (peças + mão de obra), informado pelo técnico ou gestor.
const fmtReais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const temCusto = r => typeof r.custoPecas === 'number' || typeof r.custoMaoObra === 'number';
const custoReq = r => (r.custoPecas || 0) + (r.custoMaoObra || 0);
const diasAteFechar = r => {
  const a = paraData(r.criadoEm || r.criadoEmLocal), f = paraData(r.fechadoEm);
  return a && f ? Math.max(0, Math.round((f - a) / 86400000)) : null;
};
/** Início do período escolhido nos filtros de data ("mes", "ano", número de dias ou vazio = tudo). */
function inicioPeriodo(per) {
  if (per === 'mes') { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
  if (per === 'ano') return new Date(new Date().getFullYear(), 0, 1);
  if (per === 'hoje') { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  return per ? new Date(Date.now() - Number(per) * 86400000) : null;
}
function filtrarFinalizados() {
  const q = $('#fBusca').value.trim().toLowerCase(), st = $('#fStatus').value, ini = inicioPeriodo($('#fPeriodo').value);
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
    kpi('Tempo médio', media + (dias.length ? ' d' : ''), 'da abertura à conclusão') +
    kpi('Custo total', fmtReais(lista.reduce((s, r) => s + custoReq(r), 0)), lista.filter(temCusto).length + ' OS com custo informado');
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
      '<td class="r nw mono">' + (temCusto(r) ? fmtReais(custoReq(r)) : '<span class="dim">—</span>') + '</td>' +
      '<td><span class="pill s-' + slug(r.status) + '">' + esc(r.status) + '</span></td>' +
    '</tr>';
  }))
    : (paginar('fin', []), '') + '<tr><td colspan="12"><div class="empty"><h3>Nenhum requerimento finalizado</h3><p>Quando um requerimento for marcado como Concluído ou Cancelado, ele aparece aqui. Tente outro período.</p></div></td></tr>';
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
  const linhas = [['Requerimento', 'Abertura', 'Fechamento', 'Dias', 'Placa', 'Equipamento', 'Item', 'Classificação', 'Prioridade', 'Ocorrências', 'Nº OS', 'Responsável', 'Status', 'Divergência', 'Peças (R$)', 'Mão de obra (R$)', 'Custo total (R$)']]
    .concat(filtrarFinalizados().map(r => [r.codigo, fmt(r.criadoEm || r.criadoEmLocal), fmt(r.fechadoEm), diasAteFechar(r), r.placa, r.equipamento,
      r.itemNumero + ' - ' + r.itemNome, r.classificacao, r.prioridade, r.ocorrencias, r.numeroOS, r.responsavel, r.status, r.descricao,
      fmtNum2(r.custoPecas), fmtNum2(r.custoMaoObra), temCusto(r) ? fmtNum2(custoReq(r)) : '']));
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
    const m = String(q.numeroOS || '').trim().match(/^(\D*)(\d+)(.*)$/);
    if (m && (!melhor || Number(m[2]) > melhor.n)) melhor = { n: Number(m[2]), pre: m[1], dig: m[2].length, suf: m[3] };
  });
  if (!melhor) return '1';
  return melhor.pre + String(melhor.n + 1).padStart(melhor.dig, '0') + melhor.suf;
}

/** Responsável da OS: lista dos técnicos ativos (cadastrados na aba Usuários com o cargo Técnico). O valor é o uid. */
function campoResponsavel(r, pode) {
  if (!pode) return '<input id="mResp" class="inp" value="' + esc(r.responsavel) + '" readonly>';
  const tecnicos = S.usuarios.filter(u => u.papel === 'tecnico' && u.ativo)
    .map(u => ({ uid: u.id, nome: u.nome || u.email })).sort((a, b) => a.nome.localeCompare(b.nome));
  const atualUid = r.responsavelUid || (tecnicos.find(t => t.nome === r.responsavel) || {}).uid || '';
  // Responsável antigo (só nome, ou técnico que saiu): continua aparecendo para não ser apagado sem querer.
  if (r.responsavel && !tecnicos.some(t => t.uid === atualUid)) tecnicos.unshift({ uid: 'nome:' + r.responsavel, nome: r.responsavel + ' (sem acesso de técnico)' });
  if (!tecnicos.length) return '<input id="mResp" class="inp" value="' + esc(r.responsavel) + '" placeholder="Nenhum técnico cadastrado">';
  const sel = atualUid || (r.responsavel ? 'nome:' + r.responsavel : '');
  return '<select id="mResp" class="inp"><option value="">Selecione</option>' +
    tecnicos.map(t => '<option value="' + esc(t.uid) + '"' + (t.uid === sel ? ' selected' : '') + '>' + esc(t.nome) + '</option>').join('') + '</select>';
}
/** Lê o campo de responsável: { nome, uid }. */
function lerResponsavel() {
  const el = $('#mResp'), v = el.value.trim();
  if (el.tagName !== 'SELECT') return { nome: v, uid: '' };
  if (!v) return { nome: '', uid: '' };
  if (v.startsWith('nome:')) return { nome: v.slice(5), uid: '' };
  const u = S.usuarios.find(x => x.id === v);
  return { nome: u ? (u.nome || u.email) : '', uid: v };
}

// ---------- Ocorrências MU / PR ----------
// Quantas vezes o item foi marcado MU e PR. Requerimento antigo (sem a separação) conta tudo na classificação dele.
function ocorrMuPr(r) {
  if (r.ocorrMU != null || r.ocorrPR != null) return { mu: r.ocorrMU || 0, pr: r.ocorrPR || 0 };
  const n = r.ocorrencias || 1;
  return String(r.classificacao || '').startsWith('PR') ? { mu: 0, pr: n } : { mu: n, pr: 0 };
}
const txtMuPr = o => 'MU ' + o.mu + ' · PR ' + o.pr;
const txtOcorr = r => (r.ocorrencias || 1) + ' (' + txtMuPr(ocorrMuPr(r)) + ')';
/** Soma por item ("23 · FREIOS") as vezes que veio MU e PR; mais ocorrências primeiro. */
function itensMuPr(reqs) {
  const it = {};
  reqs.forEach(r => {
    const k = r.itemNumero + ' · ' + r.itemNome, o = ocorrMuPr(r), x = it[k] || (it[k] = { mu: 0, pr: 0 });
    x.mu += o.mu; x.pr += o.pr;
  });
  return Object.entries(it).map(([k, o]) => [k, o.mu + o.pr, o]).sort((a, b) => b[1] - a[1]);
}

// ---------- Histórico da OS ----------
// Cada mudança de tratamento entra em `historico` (lista no próprio requerimento): quem, quando e o que mudou.
function eventosHistorico(r) {
  const ev = [{ em: r.criadoEm || r.criadoEmLocal, por: r.avaliador, txt: 'Requerimento aberto pelo checklist ' + (r.inspecaoCodigo || '') }];
  if ((r.ocorrencias || 1) > 1) ev.push({ em: r.ultimaOcorrencia, por: '', txt: 'Divergência repetida em outro checklist (' + r.ocorrencias + ' ocorrências no total)' });
  (r.historico || []).forEach(h => {
    const m = [];
    if (h.de !== h.status) m.push('Status: ' + (h.de || '—') + ' → ' + h.status);
    if (h.osAntes !== h.os) m.push('Nº da OS: ' + (h.os || '—'));
    if (h.respAntes !== h.resp) m.push('Responsável: ' + (h.resp || '—'));
    if (h.custo !== undefined && h.custo !== h.custoAntes) m.push('Custo: ' + (h.custo == null ? '—' : fmtReais(h.custo)));
    ev.push({ em: h.em, por: h.por, txt: m.join(' · ') || 'Observação', obs: h.obs });
  });
  return ev.sort((a, b) => (paraData(a.em) || 0) - (paraData(b.em) || 0));
}
function htmlHistorico(r) {
  return '<ul class="hist">' + eventosHistorico(r).map(e => '<li><b>' + esc(e.txt) + '</b><small>' + esc(fmt(e.em)) + (e.por ? ' · ' + esc(e.por) : '') + '</small>' +
    (e.obs ? '<div class="h-obs">' + esc(e.obs) + '</div>' : '') + '</li>').join('') + '</ul>';
}

function abrirReq(r) {
  const campos = [['Abertura', fmt(r.criadoEm || r.criadoEmLocal)], ['Inspeção', r.inspecaoCodigo], ['Placa / prefixo', r.placa],
    ['Equipamento', r.equipamento], ['KM / HR', r.kmHr], ['Item', r.itemNumero + ' · ' + r.itemNome], ['Classificação', r.classificacao],
    ['Prioridade', r.prioridade], ['Avaliador', r.avaliador], ['Ocorrências', txtOcorr(r)], ['Última ocorrência', fmt(r.ultimaOcorrencia)],
    ['Fechamento', fmt(r.fechadoEm)], ['Divergência', r.descricao],
    ['Custo', temCusto(r) ? fmtReais(custoReq(r)) + ' (peças ' + fmtReais(r.custoPecas) + ' · mão de obra ' + fmtReais(r.custoMaoObra) + ')' : '']].filter(([, v]) => v !== '' && v != null);
  const pode = gestor();
  // O técnico responsável muda o status da própria OS (não cancela, não troca número nem responsável).
  const tec = !pode && tecnico() && r.responsavelUid === S.user.uid && r.status !== 'Cancelado';
  const opcoes = tec ? ['Em análise', 'OS aberta', 'Concluído'].concat(['Em análise', 'OS aberta', 'Concluído'].includes(r.status) ? [] : [r.status]) : STATUS_REQ;
  const edita = pode || tec;
  $('#modalRoot').innerHTML =
    '<div class="ov" id="ov"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="block-h"><h2>' + esc(r.codigo) + '</h2><button class="modal-x" id="mX" aria-label="Fechar">×</button></div>' +
      '<div class="modal-b"><dl class="kv">' + campos.map(([l, v]) => '<dt>' + l + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
        '<div class="fotos-2"><div><p class="section-t">Fotos da divergência</p><div class="fotos" id="mFotos"><span class="dim">Carregando…</span></div></div>' +
        '<div><p class="section-t">Serviço pronto</p><div class="fotos" id="mFotoServ"><span class="dim">Carregando…</span></div>' +
        (edita ? '<label class="btn sm" style="margin-top:8px">Anexar foto do serviço<input type="file" accept="image/*" capture="environment" id="mFotoServInp" hidden></label>' : '') + '</div></div>' +
        '<p class="section-t">Tratamento</p>' +
        '<div class="row">' +
          '<div class="field"><label for="mStatus">Status</label><select id="mStatus" class="inp"' + (edita ? '' : ' disabled') + '>' + opcoes.map(s => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
          '<div class="field"><label for="mOS">Nº da OS</label><input id="mOS" class="inp" value="' + esc(r.numeroOS) + '"' + (pode ? '' : ' readonly') + '></div>' +
          '<div class="field"><label for="mResp">Responsável (técnico)</label>' + campoResponsavel(r, pode) + '</div>' +
        '</div>' +
        (edita ? '<div class="row" style="margin-top:10px">' +
          '<div class="field"><label for="mCustoPecas">Custo das peças (R$)</label><input id="mCustoPecas" class="inp" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + (typeof r.custoPecas === 'number' ? esc(fmtNum2(r.custoPecas)) : '') + '"></div>' +
          '<div class="field"><label for="mCustoMO">Custo da mão de obra (R$)</label><input id="mCustoMO" class="inp" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + (typeof r.custoMaoObra === 'number' ? esc(fmtNum2(r.custoMaoObra)) : '') + '"></div>' +
        '</div>' : '') +
        (edita ? '<div class="field" style="margin-top:10px"><label for="mObs">' + (tec ? 'Serviço realizado / observação' : 'Observação (opcional)') + '</label><textarea id="mObs" class="inp" maxlength="1000" rows="2" placeholder="Fica registrada no histórico"></textarea></div>'
          : '<p class="hint">Somente o gestor ou o técnico responsável altera o tratamento.</p>') +
        '<p class="section-t">Histórico</p>' + htmlHistorico(r) + '</div>' +
      '<div class="modal-f"><button class="btn" id="mImprimir" style="margin-right:auto">Imprimir / PDF</button><button class="btn" id="mCancelar">' + (edita ? 'Cancelar' : 'Fechar') + '</button>' + (edita ? '<button class="btn primary" id="mSalvar">Salvar</button>' : '') + '</div>' +
    '</div></div>';
  const fechar = () => { $('#modalRoot').innerHTML = ''; };
  $('#mX').onclick = fechar; $('#mCancelar').onclick = fechar;
  $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') fechar(); });
  carregarFotos(idsFotosReq(r), $('#mFotos'));
  carregarFotos(['servico_' + r.id], $('#mFotoServ'), 'Foto do serviço pronto');
  $('#mImprimir').onclick = () => imprimirReq(r);
  if (!edita) return;
  let fotoServ = null;
  $('#mFotoServInp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      fotoServ = await comprimirFoto(f);
      $('#mFotoServ').innerHTML = '<img class="foto-mini" src="' + esc(fotoServ) + '" alt="Foto do serviço pronto"><span class="dim">Nova, salva ao clicar em Salvar</span>';
    } catch (ex) { toast('Não foi possível usar esta foto.', true); }
  };
  // Ao marcar "OS aberta" com o campo vazio, já sugere o próximo número.
  const sugerir = () => { if (pode && $('#mStatus').value === 'OS aberta' && !$('#mOS').value.trim()) $('#mOS').value = proximaOS(r.id); };
  $('#mStatus').addEventListener('change', sugerir); sugerir();
  $('#mSalvar').onclick = () => {
    const status = $('#mStatus').value, obs = $('#mObs').value.trim();
    const fechado = status === 'Concluído' || status === 'Cancelado';
    const os = pode ? $('#mOS').value.trim() : (r.numeroOS || '');
    const resp = pode ? lerResponsavel() : { nome: r.responsavel || '', uid: r.responsavelUid || '' };
    const pecas = lerNum($('#mCustoPecas').value), mo = lerNum($('#mCustoMO').value);
    if (Number.isNaN(pecas) || Number.isNaN(mo)) { toast('O custo precisa ser um número, por exemplo 350,00.', true); return; }
    const custoAntes = temCusto(r) ? custoReq(r) : null, custo = pecas == null && mo == null ? null : (pecas || 0) + (mo || 0);
    const mudouCusto = pecas !== (r.custoPecas ?? null) || mo !== (r.custoMaoObra ?? null);
    const mudou = status !== r.status || os !== (r.numeroOS || '') || resp.nome !== (r.responsavel || '') || mudouCusto;
    if (!mudou && !obs && !fotoServ) { fechar(); return; }
    if (fotoServ) {
      setDoc(doc(db, 'fotos', 'servico_' + r.id), { reqId: r.id, tipo: 'servico', dados: fotoServ, criadoPor: S.user.uid, criadoEm: serverTimestamp() })
        .catch(e => toast(traduzErro(e), true));
    }
    const upd = { status, fechadoEm: fechado ? (r.fechadoEm || serverTimestamp()) : null };
    if (pode) Object.assign(upd, { numeroOS: os, responsavel: resp.nome, responsavelUid: resp.uid });
    if (mudouCusto) Object.assign(upd, { custoPecas: pecas, custoMaoObra: mo });
    upd.historico = arrayUnion({
      em: Date.now(), por: S.perfil.nome || S.user.email || '', uid: S.user.uid,
      de: r.status, status, osAntes: r.numeroOS || '', os, respAntes: r.responsavel || '', resp: resp.nome, custoAntes, custo,
      obs: [obs, fotoServ ? 'Foto do serviço pronto anexada.' : ''].filter(Boolean).join('\n'),
    });
    updateDoc(doc(db, 'requerimentos', r.id), upd).catch(e => toast(traduzErro(e), true));
    fechar();
    toast(navigator.onLine ? 'Requerimento atualizado' : 'Atualização salva offline');
  };
}
const idsFotosReq = r => [...new Set(r.inspecoes || [r.inspecaoId])].map(i => i + '_' + r.itemNumero);
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modalRoot').innerHTML = ''; });

// ---------- Inspeções ----------
$('#iBusca').addEventListener('input', () => { paginas.insp = 0; renderInsp(); });
$('#pg-insp').addEventListener('pagina', renderInsp);
$('#inspTbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  const r = tr && S.insp.find(x => x.id === tr.dataset.id);
  if (r) abrirInsp(r);
});

/** Checklist completo: cabeçalho, todos os itens com a situação, observações e fotos. */
function abrirInsp(r) {
  const campos = [['Data', fmtData(r.dataInspecao) + (r.diaSemana ? ' (' + r.diaSemana.toLowerCase() + ')' : '')], ['Placa / prefixo', r.placa],
    ['Equipamento', r.equipamento], ['KM / HR', r.kmHr + (r.kmHrRodado != null ? ' (rodou ' + fmtNum(r.kmHrRodado) + ')' : '')], ['Avaliador', r.avaliador],
    ['Equipe', r.equipe], ['Cabine fechada', r.cabine], ['Registrado em', fmt(r.criadoEm || r.criadoEmLocal)],
    ['Liberado para atividades', r.liberado], ['Requerimentos', (r.requerimentos || []).join(', ')]].filter(([, v]) => v !== '' && v != null && v !== ' ()');
  const itens = r.respostas || [];
  const linha = it => '<tr class="' + (it.status === 'MU' || it.status === 'PR' ? 'det-div' : '') + '"><td class="dim">' + esc(it.numero) + '</td><td>' + esc(it.nome) +
    (it.obs ? '<div class="det-obs">' + esc(it.obs) + '</div>' : '') +
    (it.foto ? '<div class="fotos" data-foto-insp="' + esc(r.id + '_' + it.numero) + '"><span class="dim">Carregando foto…</span></div>' : '') +
    '</td><td class="r"><span class="lg ' + esc(it.status) + '">' + esc(it.status || '—') + '</span></td></tr>';
  const c = r.contagem || {};
  $('#modalRoot').innerHTML =
    '<div class="ov" id="ov"><div class="modal modal-lg" role="dialog" aria-modal="true">' +
      '<div class="block-h"><h2>' + esc(r.codigo) + '</h2><button class="modal-x" id="mX" aria-label="Fechar">×</button></div>' +
      '<div class="modal-b"><dl class="kv">' + campos.map(([l, v]) => '<dt>' + l + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
        '<div class="row" style="justify-content:space-between;align-items:center"><p class="section-t">Itens · OK ' + (c.OK || 0) + ' · MU ' + (c.MU || 0) + ' · PR ' + (c.PR || 0) + ' · NA ' + (c.NA || 0) + '</p>' +
        '<label class="chk"><input type="checkbox" id="mSoDiv"' + ((c.MU || 0) + (c.PR || 0) ? ' checked' : '') + '> Só divergências</label></div>' +
        '<div class="tbl-wrap"><table><tbody id="mItens"></tbody></table></div></div>' +
      '<div class="modal-f"><button class="btn" id="mImprimir" style="margin-right:auto">Imprimir / PDF</button><button class="btn" id="mCancelar">Fechar</button></div>' +
    '</div></div>';
  const pintar = () => {
    const so = $('#mSoDiv').checked;
    const lista = itens.filter(it => !so || it.status === 'MU' || it.status === 'PR');
    $('#mItens').innerHTML = lista.length ? lista.map(linha).join('') : '<tr><td class="dim">Nenhuma divergência neste checklist.</td></tr>';
    $$('[data-foto-insp]').forEach(el => carregarFotos([el.dataset.fotoInsp], el));
  };
  $('#mSoDiv').onchange = pintar; pintar();
  $('#mImprimir').onclick = () => imprimirInsp(r);
  const fechar = () => { $('#modalRoot').innerHTML = ''; };
  $('#mX').onclick = fechar; $('#mCancelar').onclick = fechar;
  $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') fechar(); });
}
function renderInsp() {
  const q = $('#iBusca').value.trim().toLowerCase();
  const lista = S.insp.filter(r => !q || [r.codigo, r.placa, r.equipamento, r.avaliador].join(' ').toLowerCase().includes(q));
  $('#inspCont').textContent = lista.length + ' registro(s)';
  const maisInsp = S.insp.length >= LIM.insp ? () => { LIM.insp += 300; ouvirInsp(); } : null;
  $('#inspTbody').innerHTML = lista.length ? paginar('insp', lista.map(r => {
    const c = r.contagem || {};
    return '<tr class="click" data-id="' + esc(r.id) + '">' +
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

// ---------- Painel do dia (gestor e técnico) ----------
['#dBusca', '#dFiltro'].forEach(s => $(s).addEventListener('input', renderDia));
function renderDia() {
  if (!gestor() && !tecnico()) return;
  const hoje = hojeISO();
  const linhas = S.equip.map(e => {
    // S.insp vem do mais novo para o mais antigo.
    const doEq = S.insp.filter(i => i.placaId === e.id);
    const ult = doEq[0] || null, hj = doEq.find(i => i.dataInspecao === hoje) || null;
    const os = S.reqAbertos.filter(q => q.placa === e.placa).length;
    return { e, ult, hj, os, nao: ult && ult.liberado === 'NÃO' };
  });
  const feitos = linhas.filter(l => l.hj).length, nao = linhas.filter(l => l.nao).length;
  const kpi = (lbl, val, sub, alert) => '<div class="kpi' + (alert ? ' alert' : '') + '"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="sub">' + sub + '</span></div>';
  $('#diaKpis').innerHTML =
    kpi('Equipamentos', linhas.length, 'cadastrados') +
    kpi('Checklist hoje', feitos, 'de ' + linhas.length + ' feitos em ' + fmtData(hoje)) +
    kpi('Sem checklist', linhas.length - feitos, 'ainda não conferidos hoje', linhas.length - feitos > 0) +
    kpi('Não liberados', nao, 'pelo último checklist', nao > 0) +
    (S.prev.length ? (() => {
      const al = S.equip.flatMap(e => alertasPrev(e)), venc = al.filter(a => a.st === 'vencida').length;
      return kpi('Preventivas vencidas', venc, (al.length - venc) + ' chegando perto', venc > 0);
    })() : '');
  $('#diaBadge').hidden = !nao; $('#diaBadge').textContent = nao;
  const q = $('#dBusca').value.trim().toLowerCase(), f = $('#dFiltro').value;
  const ordem = l => (l.nao ? 0 : l.hj ? 2 : 1);
  const lista = linhas.filter(l => (!f || (f === 'falta' && !l.hj) || (f === 'nao' && l.nao) || (f === 'os' && l.os)) &&
    (!q || [l.e.placa, l.e.equipamento, l.e.equipe].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => ordem(a) - ordem(b) || String(a.e.placa).localeCompare(b.e.placa));
  $('#diaCont').textContent = lista.length + ' equipamento(s)';
  $('#diaTbody').innerHTML = lista.length ? lista.map(l => {
    const a = leituraAtual(l.e);
    return '<tr' + (l.ult ? ' class="click" data-insp="' + esc(l.ult.id) + '"' : '') + '>' +
      '<td class="mono">' + esc(l.e.placa) + '</td><td>' + esc(l.e.equipamento) + '</td><td>' + (esc(l.e.equipe) || '<span class="dim">—</span>') + '</td>' +
      '<td>' + (l.hj ? '<span class="pill s-sim">Feito</span>' + (l.hj.pend ? ' <span class="tag-pend">a enviar</span>' : '') : '<span class="pill s-nao">Falta</span>') + '</td>' +
      '<td class="nw">' + (l.ult ? esc(fmtData(l.ult.dataInspecao)) + ' <span class="dim">' + esc(l.ult.avaliador) + '</span>' : '<span class="dim">Nenhum</span>') + '</td>' +
      '<td>' + (l.ult ? '<span class="pill s-' + slug(l.ult.liberado) + '">' + esc(l.ult.liberado) + '</span>' : '<span class="dim">—</span>') + '</td>' +
      '<td class="r mono"' + (l.os ? ' style="color:var(--accent)"' : '') + '>' + l.os + '</td>' +
      '<td class="r mono">' + (a ? fmtNum(a.valor) + ' ' + (UNID[l.e.tipoMedidor] || '') : '<span class="dim">—</span>') + '</td></tr>';
  }).join('') : '<tr><td colspan="8"><div class="empty"><h3>Nada por aqui</h3><p>' + (S.equip.length ? 'Nenhum equipamento neste filtro.' : 'Cadastre os equipamentos na aba Cadastros.') + '</p></div></td></tr>';
}
$('#diaTbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-insp]');
  const r = tr && S.insp.find(x => x.id === tr.dataset.insp);
  if (r) abrirInsp(r);
});

// ---------- Minhas OS (técnico) ----------
$('#mnFiltro').addEventListener('input', renderMinhas);
function renderMinhas() {
  const abertas = S.minhas.filter(r => STATUS_ABERTOS.includes(r.status));
  $('#minhasBadge').hidden = !abertas.length; $('#minhasBadge').textContent = abertas.length;
  const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
  const kpi = (lbl, val, sub, alert) => '<div class="kpi' + (alert ? ' alert' : '') + '"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="sub">' + sub + '</span></div>';
  $('#minhasKpis').innerHTML =
    kpi('Em aberto', abertas.length, 'comigo') +
    kpi('Prioridade alta', abertas.filter(r => r.prioridade === 'ALTA').length, 'MU ou item crítico', true) +
    kpi('Concluídas no mês', S.minhas.filter(r => r.status === 'Concluído' && (paraData(r.fechadoEm) || 0) >= ini).length, ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  const f = $('#mnFiltro').value;
  const lista = S.minhas.filter(r => !f || (f === 'abertas' ? STATUS_ABERTOS.includes(r.status) : r.status === f))
    .sort((a, b) => (a.prioridade === 'ALTA' ? 0 : 1) - (b.prioridade === 'ALTA' ? 0 : 1) || (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0));
  $('#minhasCont').textContent = lista.length + ' OS';
  $('#minhasTbody').innerHTML = lista.length ? lista.map(r =>
    '<tr class="click" data-id="' + esc(r.id) + '">' +
      '<td class="mono">' + esc(r.codigo) + (r.pend ? ' <span class="tag-pend">a enviar</span>' : '') + '</td>' +
      '<td class="nw dim">' + esc(fmt(r.criadoEm || r.criadoEmLocal)) + '</td>' +
      '<td class="mono">' + esc(r.placa) + '</td><td>' + esc(r.equipamento) + '</td>' +
      '<td><span class="dim">' + esc(r.itemNumero) + '</span> ' + esc(r.itemNome) + '</td>' +
      '<td><span class="prio-' + slug(r.prioridade) + '">' + esc(r.prioridade) + '</span></td>' +
      '<td class="mono">' + (esc(r.numeroOS) || '<span class="dim">—</span>') + '</td>' +
      '<td><span class="pill s-' + slug(r.status) + '">' + esc(r.status) + '</span></td></tr>').join('')
    : '<tr><td colspan="8"><div class="empty"><h3>Nenhuma OS ' + (f === 'abertas' ? 'em aberto ' : '') + 'com você</h3><p>Quando o gestor te colocar como responsável de uma OS, ela aparece aqui.</p></div></td></tr>';
}
$('#minhasTbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-id]');
  const r = tr && S.minhas.find(x => x.id === tr.dataset.id);
  if (r) abrirReq(r);
});

// ---------- Backup em planilha (gestor) ----------
// Gera um .xlsx no próprio navegador (zip sem compressão), sem biblioteca externa.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(arquivos) {
  const enc = new TextEncoder(), partes = [], central = [];
  let pos = 0;
  arquivos.forEach(([nome, texto]) => {
    const n = enc.encode(nome), d = enc.encode(texto), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, t]) => t === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, d.length, 4], [24, d.length, 4],
      [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, pos, 4]]
      .forEach(([o, v, t]) => t === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    partes.push(h, n, d); central.push(c, n);
    pos += 30 + n.length + d.length;
  });
  const tam = central.reduce((a, p) => a + p.byteLength, 0);
  const fim = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, arquivos.length, 2], [10, arquivos.length, 2], [12, tam, 4], [16, pos, 4]]
    .forEach(([o, v, t]) => t === 4 ? fim.setUint32(o, v, true) : fim.setUint16(o, v, true));
  return new Blob([...partes, ...central, fim], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function planilha(abas) {
  const x = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const col = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const celula = (v, ref, cab) => {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
    return '<c r="' + ref + '" t="inlineStr"' + (cab ? ' s="1"' : '') + '><is><t xml:space="preserve">' + x(String(v).slice(0, 32000)) + '</t></is></c>';
  };
  const folha = linhas => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' +
    linhas.map((l, r) => '<row r="' + (r + 1) + '">' + l.map((v, c) => celula(v, col(c) + (r + 1), r === 0)).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const ns = 'http://schemas.openxmlformats.org/', rel = ns + 'officeDocument/2006/relationships';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + ns + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + ns + 'spreadsheetml/2006/main" xmlns:r="' + rel + '"><sheets>' +
      abas.map(([nome], i) => '<sheet name="' + x(nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships">' +
      abas.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (abas.length + 1) + '" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + ns + 'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...abas.map(([, linhas], i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', folha(linhas)]),
  ]);
}
$('#btnBackup').addEventListener('click', async () => {
  if (!navigator.onLine) { toast('O backup precisa de internet para baixar tudo do servidor.', true); return; }
  const btn = $('#btnBackup'); btn.disabled = true; btn.textContent = 'Gerando backup…';
  try {
    const tudo = async col => (await getDocs(collection(db, col))).docs.map(d => ({ id: d.id, ...d.data() }));
    const [equip, insp, reqs, usuarios, prev] = await Promise.all(['equipamentos', 'inspecoes', 'requerimentos', 'usuarios', 'preventivas'].map(tudo));
    insp.sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0));
    reqs.sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0));
    const criticos = new Set(S.cfg.criticos || []), inativos = new Set(S.cfg.inativos || []);
    const respostasLinhas = [], hist = [];
    insp.forEach(i => (i.respostas || []).forEach(it => respostasLinhas.push([i.codigo, fmtData(i.dataInspecao), i.placa, it.numero, it.nome, it.status, it.obs, it.foto ? 'SIM' : ''])));
    reqs.forEach(r => (r.historico || []).forEach(h => hist.push([r.codigo, r.placa, fmt(h.em), h.por, h.de, h.status, h.os, h.resp, h.obs])));
    const blob = planilha([
      ['Inspeções', [['Código', 'Data', 'Dia', 'Placa', 'Equipamento', 'Avaliador', 'Equipe', 'Cabine fechada', 'KM / HR', 'Rodou', 'OK', 'MU', 'PR', 'NA', 'Liberado', 'Requerimentos', 'Registrado em', 'Registrado por']]
        .concat(insp.map(i => { const c = i.contagem || {}; return [i.codigo, fmtData(i.dataInspecao), i.diaSemana, i.placa, i.equipamento, i.avaliador, i.equipe, i.cabine, i.kmHrValor ?? i.kmHr, i.kmHrRodado, c.OK, c.MU, c.PR, c.NA, i.liberado, (i.requerimentos || []).join(', '), fmt(i.criadoEm || i.criadoEmLocal), i.criadoPorNome]; }))],
      ['Itens das inspeções', [['Inspeção', 'Data', 'Placa', 'Nº', 'Item', 'Situação', 'Observação', 'Foto']].concat(respostasLinhas)],
      ['Requerimentos', [['Código', 'Abertura', 'Placa', 'Equipamento', 'Nº item', 'Item', 'Classificação', 'Prioridade', 'Ocorrências', 'Status', 'Nº OS', 'Responsável', 'Fechamento', 'Divergência', 'Inspeção', 'Peças (R$)', 'Mão de obra (R$)']]
        .concat(reqs.map(r => [r.codigo, fmt(r.criadoEm || r.criadoEmLocal), r.placa, r.equipamento, r.itemNumero, r.itemNome, r.classificacao, r.prioridade, r.ocorrencias, r.status, r.numeroOS, r.responsavel, fmt(r.fechadoEm), r.descricao, r.inspecaoCodigo, r.custoPecas, r.custoMaoObra]))],
      ['Histórico das OS', [['Requerimento', 'Placa', 'Quando', 'Quem', 'Status anterior', 'Status', 'Nº OS', 'Responsável', 'Observação']].concat(hist)],
      ['Equipamentos', [['Placa', 'Equipamento', 'Equipe', 'Cabine fechada', 'Medidor', 'Leitura atual', 'Leitura em']]
        .concat(equip.map(e => [e.placa, e.equipamento, e.equipe, e.cabine, e.tipoMedidor === 'HR' ? 'Horímetro' : e.tipoMedidor === 'KM' ? 'KM' : '', e.medidorAtual, fmt(e.medidorEm)]))],
      ['Preventivas', [['Placa', 'Preventiva', 'A cada', 'Última feita (leitura)', 'Feita em', 'Feita por']]
        .concat(prev.map(p => { const e = equip.find(x => x.id === p.placaId) || {}; const un = UNID[e.tipoMedidor] || ''; return [p.placa, p.nome, p.intervalo + (un ? ' ' + un : ''), p.ultimaFeita, fmt(p.ultimaEm), p.feitaPor]; }))],
      ['Itens do checklist', [['Nº', 'Item', 'Crítico', 'Ativo', 'Adicionado']].concat(todosItens().map(it => [it.numero, it.nome, criticos.has(it.numero) ? 'SIM' : '', inativos.has(it.numero) ? 'NÃO' : 'SIM', it.extra ? 'SIM' : '']))],
      ['Usuários', [['Nome', 'E-mail', 'Cargo', 'Situação']].concat(usuarios.map(u => [u.nome, u.email, PAPEIS[u.papel] || u.papel, u.ativo ? 'Ativo' : 'Aguardando']))],
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'backup-checklist-' + hojeISO() + '.xlsx';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#backupInfo').textContent = 'Backup gerado: ' + insp.length + ' inspeções e ' + reqs.length + ' requerimentos.';
    toast('Backup baixado');
  } catch (ex) { toast('Não foi possível gerar o backup: ' + traduzErro(ex), true); }
  finally { btn.disabled = false; btn.textContent = 'Baixar backup (Excel)'; }
});

// ---------- Equipamentos ----------
// Um quadrado por equipamento, com a cor do checklist de hoje: verde aprovado, vermelho com MU,
// amarelo com PR e cinza sem checklist. O gestor cadastra e edita pelo modal.
const ST_EQ = {
  ok: { nome: 'Aprovado', ic: '<path d="M6 12.5l4 4 8-9" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  mu: { nome: 'MU', ic: '<path d="M12 6.5v7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.6" fill="currentColor"/>' },
  pr: { nome: 'PR', ic: '<circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M12 8.5V12l2.5 1.8" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>' },
  nada: { nome: 'Sem checklist hoje', curto: 'Sem checklist', ic: '<path d="M7 12h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' },
};
// Ícones de linha dos detalhes do card (equipe, KM / horímetro, quem fez o checklist) e do botão de editar.
const linha = d => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC_LINHA = {
  equipe: linha('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.2 3 4.4"/>'),
  medidor: linha('<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1"/>'),
  checklist: linha('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 12.5l2 2 4-4"/>'),
  lapis: linha('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  chave: linha('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
};
const icEq = st => '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' + ST_EQ[st].ic + '</svg>';
function statusHoje(e) {
  const i = S.insp.find(x => x.placaId === e.id && x.dataInspecao === hojeISO());
  if (!i) return { st: 'nada', insp: null };
  const c = i.contagem || {};
  return { st: c.MU ? 'mu' : c.PR ? 'pr' : 'ok', insp: i };
}
let filtroEq = '';
$('#eqBusca').addEventListener('input', renderEquip);
$('#eqResumo').addEventListener('click', e => {
  const b = e.target.closest('[data-st]'); if (!b) return;
  filtroEq = filtroEq === b.dataset.st ? '' : b.dataset.st; renderEquip();
});
function renderEquip() {
  const lista = S.equip.map(e => ({ e, ...statusHoje(e) }));
  const cont = { ok: 0, mu: 0, pr: 0, nada: 0 };
  lista.forEach(l => cont[l.st]++);
  $('#eqResumo').innerHTML = Object.keys(ST_EQ).map(k => '<button type="button" class="eq-chip st-' + k + '" data-st="' + k + '" aria-pressed="' + (filtroEq === k) + '"><i></i>' + ST_EQ[k].nome + ' <b>' + cont[k] + '</b></button>').join('');
  const q = $('#eqBusca').value.trim().toLowerCase();
  const vis = lista.filter(l => (!filtroEq || l.st === filtroEq) && (!q || [l.e.placa, l.e.equipamento, l.e.equipe].join(' ').toLowerCase().includes(q)));
  const g = gestor();
  const al = S.equip.flatMap(e => alertasPrev(e)), venc = al.filter(a => a.st === 'vencida').length;
  $('#eqPrev').hidden = !al.length;
  $('#eqPrev').innerHTML = IC_LINHA.chave + '<span>Preventivas: ' + [venc ? '<b>' + venc + (venc === 1 ? ' vencida' : ' vencidas') + '</b>' : '', al.length - venc ? (al.length - venc) + ' chegando perto' : ''].filter(Boolean).join(' e ') +
    '. Toque no equipamento para ver e marcar como feita.</span>';
  $('#eqPrev').className = 'callout eq-prev-aviso' + (venc ? ' err' : '');
  $('#eqGrid').innerHTML = vis.length ? vis.map(({ e, st, insp }) => {
    const a = leituraAtual(e), ap = alertasPrev(e);
    return '<div class="eq-card st-' + st + '" role="button" tabindex="0" data-eq="' + esc(e.id) + '" aria-label="' + esc((e.equipamento || e.placa) + ': ' + ST_EQ[st].nome) + '">' +
      '<span class="eq-selo"><span class="eq-sim">' + icEq(st) + '</span>' + (ST_EQ[st].curto || ST_EQ[st].nome) + '</span>' +
      (g ? '<button type="button" class="eq-lapis" data-edit-eq="' + esc(e.id) + '" aria-label="Editar ' + esc(e.placa) + '" title="Editar">' + IC_LINHA.lapis + '</button>' : '') +
      '<span class="eq-nome">' + (esc(e.equipamento) || esc(e.placa)) + '</span>' +
      '<span class="eq-placa">' + esc(e.placa) + '</span>' +
      '<span class="eq-meta">' +
        (e.equipe ? '<span>' + IC_LINHA.equipe + esc(e.equipe) + '</span>' : '') +
        (a ? '<span>' + IC_LINHA.medidor + fmtNum(a.valor) + ' ' + (UNID[e.tipoMedidor] || '') + '</span>' : '') +
        (insp ? '<span>' + IC_LINHA.checklist + esc(insp.avaliador || 'Checklist') + (insp.criadoEm || insp.criadoEmLocal ? ' · ' + fmt(insp.criadoEm || insp.criadoEmLocal).slice(-5) : '') + (insp.pend ? ' <span class="tag-pend">a enviar</span>' : '') + '</span>' : '') +
      '</span>' +
      (ap.length ? '<span class="eq-prev ' + (ap[0].st === 'vencida' ? 'st-mu' : 'st-pr') + '">' + IC_LINHA.chave + '<span>' + esc(ap[0].p.nome) + ' ' + txtPrev(ap[0], UNID[e.tipoMedidor] || '') + (ap.length > 1 ? ' · +' + (ap.length - 1) : '') + '</span></span>' : '') +
    '</div>';
  }).join('') : '<div class="block" style="grid-column:1/-1"><div class="empty"><h3>' + (S.equip.length ? 'Nenhum equipamento neste filtro' : 'Nenhum equipamento cadastrado') + '</h3><p>' +
    (S.equip.length ? 'Tente outra busca ou toque de novo na cor para tirar o filtro.' : g ? 'Use o botão "+ Novo equipamento" para cadastrar o primeiro.' : 'O gestor cadastra os equipamentos.') + '</p></div></div>';
}
function cliqueEquip(e) {
  const ed = e.target.closest('[data-edit-eq]');
  if (ed) { abrirEquip(S.equip.find(x => x.id === ed.dataset.editEq)); return; }
  const card = e.target.closest('[data-eq]'); if (!card) return;
  const eq = S.equip.find(x => x.id === card.dataset.eq); if (!eq) return;
  abrirRelatorio(eq);
}
$('#eqGrid').addEventListener('click', cliqueEquip);
$('#eqGrid').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-eq]')) { e.preventDefault(); cliqueEquip(e); } });
$('#btnNovoEq').addEventListener('click', () => abrirEquip(null));

// ---------- Preventivas por KM / horímetro ----------
// Cada preventiva tem um intervalo (ex.: troca de óleo a cada 10.000 km) e a leitura em que foi feita por último.
// Avisa quando falta 10% do intervalo ou menos; vence quando a leitura passa da próxima.
const AVISO_PREV = 0.1;
function situacaoPrev(p, eq, valor) {
  const a = valor == null ? leituraAtual(eq) : { valor };
  const atual = a ? a.valor : p.ultimaFeita, proxima = p.ultimaFeita + p.intervalo;
  const falta = Math.round((proxima - atual) * 10) / 10;
  return { st: falta <= 0 ? 'vencida' : falta <= p.intervalo * AVISO_PREV ? 'perto' : 'ok', proxima, falta, atual,
    usado: Math.min(1, Math.max(0, (atual - p.ultimaFeita) / p.intervalo)) };
}
const prevDoEq = eq => S.prev.filter(p => p.placaId === eq.id && typeof p.intervalo === 'number' && typeof p.ultimaFeita === 'number')
  .sort((a, b) => String(a.nome).localeCompare(b.nome));
/** Preventivas vencidas ou perto de vencer, a mais urgente primeiro. `valor`: leitura nova (opcional). */
const alertasPrev = (eq, valor) => eq.tipoMedidor ? prevDoEq(eq).map(p => ({ p, ...situacaoPrev(p, eq, valor) })).filter(x => x.st !== 'ok').sort((a, b) => a.falta - b.falta) : [];
const txtPrev = (s, un) => s.st === 'vencida' ? (s.falta < 0 ? 'vencida há ' + fmtNum(-s.falta) + ' ' + un : 'vence agora') : 'em ' + fmtNum(s.falta) + ' ' + un;

/** Bloco de preventivas dentro do relatório. Redesenha sozinho quando a lista muda no banco. */
function pintarPrev(eq) {
  const el = $('#relPrev');
  if (!el) { pintarPrev.eq = null; return; }
  pintarPrev.eq = eq = S.equip.find(x => x.id === eq.id) || eq;
  const un = UNID[eq.tipoMedidor] || '', g = gestor(), feita = g || tecnico();
  const a = leituraAtual(eq);
  const aberto = $('#prevForm') && !$('#prevForm').hidden;
  if (aberto) return; // não apaga o que o gestor está digitando
  const lista = prevDoEq(eq);
  el.innerHTML = '<div class="rel-prev-h"><p class="section-t">Preventivas</p>' + (g && un ? '<button type="button" class="btn sm" id="prevNova">+ Preventiva</button>' : '') + '</div>' +
    (!un ? '<p class="hint">Para usar preventivas, defina o medidor (KM ou horímetro) no cadastro do equipamento.</p>' :
    (g ? '<form class="prev-form" id="prevForm" hidden novalidate><div class="row">' +
      '<div class="field" style="flex:2 1 200px"><label for="pvNome">Serviço</label><input id="pvNome" class="inp" maxlength="80" placeholder="Ex.: Troca de óleo do motor"></div>' +
      '<div class="field"><label for="pvInt">A cada (' + un + ')</label><input id="pvInt" class="inp" inputmode="decimal" placeholder="' + (un === 'h' ? '250' : '10.000') + '"></div>' +
      '<div class="field"><label for="pvUlt">Feita por último em (' + un + ')</label><input id="pvUlt" class="inp" inputmode="decimal" value="' + (a ? esc(String(a.valor).replace('.', ',')) : '') + '"></div>' +
    '</div><div id="pvErro" class="callout err" hidden style="margin-top:8px"></div><div class="prev-form-f"><button type="button" class="btn" id="pvCancelar">Cancelar</button><button type="submit" class="btn primary" id="pvSalvar">Adicionar</button></div></form>' : '') +
    (lista.length ? '<ul class="prev-lista">' + lista.map(p => ({ p, s: situacaoPrev(p, eq) })).sort((a, b) => a.s.falta / a.p.intervalo - b.s.falta / b.p.intervalo).map(({ p, s }) => {
      const cls = s.st === 'vencida' ? 'st-mu' : s.st === 'perto' ? 'st-pr' : 'st-ok';
      return '<li class="' + cls + '" data-prev="' + esc(p.id) + '"><div class="prev-info"><b>' + esc(p.nome) + '</b>' +
        '<small>A cada ' + fmtNum(p.intervalo) + ' ' + un + ' · última em ' + fmtNum(p.ultimaFeita) + ' ' + un + (p.ultimaEm ? ' (' + fmt(p.ultimaEm).slice(0, 10) + ')' : '') + ' · próxima em ' + fmtNum(s.proxima) + ' ' + un + '</small>' +
        '<div class="track"><span style="width:' + Math.round(s.usado * 100) + '%"></span></div></div>' +
        '<span class="prev-st">' + (s.st === 'ok' ? 'Em dia · faltam ' + fmtNum(s.falta) + ' ' + un : txtPrev(s, un).replace(/^./, c => c.toUpperCase())) + '</span>' +
        '<span class="prev-acoes">' + (feita ? '<button type="button" class="btn sm" data-prev-feita="' + esc(p.id) + '">Feita</button>' : '') +
        (g ? '<button type="button" class="btn sm" data-prev-del="' + esc(p.id) + '" aria-label="Remover ' + esc(p.nome) + '" title="Remover">×</button>' : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="hint">Nenhuma preventiva cadastrada' + (g ? '. Use "+ Preventiva" para cadastrar, por exemplo, a troca de óleo a cada 10.000 ' + un + '.' : '.') + '</p>'));
  if (!un || !g) return;
  const form = $('#prevForm');
  const abrirForm = v => { form.hidden = !v; if ($('#prevNova')) $('#prevNova').hidden = v; if (v) $('#pvNome').focus(); else pintarPrev(eq); };
  if ($('#prevNova')) $('#prevNova').onclick = () => abrirForm(true);
  $('#pvCancelar').onclick = () => abrirForm(false);
  form.onsubmit = e => {
    e.preventDefault();
    const nome = $('#pvNome').value.trim(), intervalo = lerNum($('#pvInt').value), ult = lerNum($('#pvUlt').value);
    const erro = (msg, id) => { $('#pvErro').hidden = false; $('#pvErro').textContent = msg; $('#' + id).focus(); };
    if (!nome) return erro('Informe o serviço.', 'pvNome');
    if (!intervalo) return erro('Informe de quantos em quantos ' + un + ' a preventiva é feita.', 'pvInt');
    if (ult == null || Number.isNaN(ult)) return erro('Informe em quantos ' + un + ' ela foi feita por último.', 'pvUlt');
    setDoc(doc(collection(db, 'preventivas')), {
      placaId: eq.id, placa: eq.placa, nome, intervalo, ultimaFeita: ult, ultimaEm: serverTimestamp(),
      feitaPor: S.perfil.nome || '', feitaUid: S.user.uid, criadoEm: serverTimestamp(),
    }).then(() => toast('Preventiva cadastrada')).catch(ex => toast(traduzErro(ex), true));
    form.hidden = true;
    pintarPrev(eq);
  };
}
document.addEventListener('click', e => {
  const f = e.target.closest('#relPrev [data-prev-feita]'), d = e.target.closest('#relPrev [data-prev-del]');
  const p = (f || d) && S.prev.find(x => x.id === (f || d).dataset[f ? 'prevFeita' : 'prevDel']);
  if (!p) return;
  const eq = S.equip.find(x => x.id === p.placaId), un = UNID[eq && eq.tipoMedidor] || '';
  if (d) {
    if (confirm('Remover a preventiva "' + p.nome + '"?')) deleteDoc(doc(db, 'preventivas', p.id)).then(() => toast('Preventiva removida')).catch(ex => toast(traduzErro(ex), true));
    return;
  }
  const a = eq && leituraAtual(eq);
  const resp = prompt('Em quantos ' + un + ' estava o equipamento quando "' + p.nome + '" foi feita?', a ? fmtNum(a.valor) : '');
  if (resp == null) return;
  const v = lerNum(resp);
  if (v == null || Number.isNaN(v)) { toast('Informe um número.', true); return; }
  updateDoc(doc(db, 'preventivas', p.id), { ultimaFeita: v, ultimaEm: serverTimestamp(), feitaPor: S.perfil.nome || '', feitaUid: S.user.uid })
    .then(() => toast('Preventiva marcada como feita')).catch(ex => toast(traduzErro(ex), true));
});

// ---------- Impressão / PDF ----------
// Monta a folha no padrão do formulário em #printRoot e abre a impressão do aparelho,
// onde dá para imprimir, "Salvar como PDF" ou compartilhar.
async function imprimir(titulo, html) {
  const root = $('#printRoot');
  root.innerHTML = html;
  await Promise.all([...root.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
  const antes = document.title;
  document.title = titulo; // vira o nome sugerido do arquivo PDF
  const limpar = () => { document.title = antes; root.innerHTML = ''; removeEventListener('afterprint', limpar); };
  addEventListener('afterprint', limpar);
  window.print();
}
const cabImp = (tit, cod, sub) => '<div class="pr-cab"><div class="pr-marca">CHK</div><div class="pr-tit"><b>' + tit + '</b><span>Manutenção e Controle · Revisão 003</span></div>' +
  '<div class="pr-cod"><b>' + esc(cod) + '</b><span>' + esc(sub) + '</span></div></div>';
const dadosImp = pares => '<div class="pr-dados">' + pares.map(([l, v, larga]) => '<div' + (larga ? ' class="larga"' : '') + '><span>' + l + '</span><b>' + (esc(v) || '&nbsp;') + '</b></div>').join('') + '</div>';
const assImp = nomes => '<div class="pr-ass">' + nomes.map(n => '<div><span></span>' + n + '</div>').join('') + '</div>';
const rodapeImp = () => '<div class="pr-rod">Impresso em ' + new Date().toLocaleString('pt-BR').slice(0, 17) + ' por ' + esc(S.perfil.nome || '') + ' · Check List de Averiguação</div>';

function imprimirInsp(r) {
  const c = r.contagem || {}, crit = new Set(S.cfg.criticos || []);
  const linhas = (r.respostas || []).map(it => '<tr class="pr-' + String(it.status || '').toLowerCase() + '"><td class="c">' + esc(it.numero) + '</td><td>' + esc(it.nome) + (crit.has(it.numero) ? ' (*)' : '') +
    (it.obs ? '<i>' + esc(it.obs) + '</i>' : '') + '</td>' + ['OK', 'MU', 'PR', 'NA'].map(s => '<td class="c x">' + (it.status === s ? 'X' : '') + '</td>').join('') + '</tr>').join('');
  imprimir('Checklist ' + r.placa + ' ' + fmtData(r.dataInspecao).replace(/\//g, '-'),
    '<div class="pr-folha">' + cabImp('CHECK-LIST AVERIGUAÇÃO P1', r.codigo, fmtData(r.dataInspecao) + (r.diaSemana ? ' · ' + r.diaSemana : '')) +
    dadosImp([['Placa / prefixo', r.placa], ['Equipamento', r.equipamento], ['KM / HR', r.kmHr], ['Data', fmtData(r.dataInspecao)],
      ['Avaliador', r.avaliador], ['Equipe', r.equipe], ['Cabine fechada', r.cabine], ['Liberado para atividades', r.liberado]]) +
    '<table class="pr-tab"><thead><tr><th class="c">Nº</th><th>Item verificado</th><th class="c">OK</th><th class="c">MU</th><th class="c">PR</th><th class="c">NA</th></tr></thead><tbody>' + linhas + '</tbody></table>' +
    '<div class="pr-tot">OK ' + (c.OK || 0) + ' · MU ' + (c.MU || 0) + ' · PR ' + (c.PR || 0) + ' · NA ' + (c.NA || 0) + (r.requerimentos && r.requerimentos.length ? ' · Requerimentos: ' + esc(r.requerimentos.join(', ')) : '') + '</div>' +
    '<p class="pr-nota">OK: conforme · MU: manutenção urgente · PR: programar revisão · NA: não se aplica. ' + (crit.size ? 'NOTA: (*) itens que impedem o veículo de trafegar e/ou ser operado.' : '') + '</p>' +
    assImp(['Avaliador: ' + esc(r.avaliador || ''), 'Responsável pela manutenção']) + rodapeImp() + '</div>');
}

async function imprimirReq(r) {
  const [antes, depois] = await Promise.all([carregarFotos(idsFotosReq(r)), carregarFotos(['servico_' + r.id])]);
  const fotos = (lista, tit) => '<div><p class="pr-sec">' + tit + '</p>' + (lista.length ? lista.map(f => '<img src="' + esc(f) + '" alt="' + tit + '">').join('') : '<div class="pr-vazio">Sem foto</div>') + '</div>';
  const ev = eventosHistorico(r);
  imprimir('OS ' + (r.numeroOS || r.codigo) + ' ' + r.placa,
    '<div class="pr-folha">' + cabImp('REQUERIMENTO DE ABERTURA DE OS', r.codigo, r.numeroOS ? 'Nº da OS: ' + r.numeroOS : r.status) +
    dadosImp([['Placa / prefixo', r.placa], ['Equipamento', r.equipamento], ['KM / HR', r.kmHr], ['Abertura', fmt(r.criadoEm || r.criadoEmLocal)],
      ['Item', [r.itemNumero, r.itemNome].filter(v => v != null && v !== '').join(' · '), true], ['Classificação', r.classificacao], ['Prioridade', r.prioridade],
      ['Status', r.status], ['Nº da OS', r.numeroOS], ['Responsável', r.responsavel], ['Fechamento', fmt(r.fechadoEm)],
      ['Inspeção', r.inspecaoCodigo], ['Avaliador', r.avaliador], ['Ocorrências', txtOcorr(r)],
      ['Custo das peças', temCusto(r) ? fmtReais(r.custoPecas) : ''], ['Custo da mão de obra', temCusto(r) ? fmtReais(r.custoMaoObra) : ''], ['Custo total', temCusto(r) ? fmtReais(custoReq(r)) : '']]) +
    '<p class="pr-sec">Divergência</p><div class="pr-texto">' + esc(r.descricao) + '</div>' +
    '<div class="pr-fotos">' + fotos(antes, 'Antes (divergência)') + fotos(depois, 'Depois (serviço pronto)') + '</div>' +
    '<p class="pr-sec">Histórico</p><table class="pr-tab"><thead><tr><th>Quando</th><th>Quem</th><th>O que aconteceu</th></tr></thead><tbody>' +
      ev.map(e => '<tr><td class="nw">' + esc(fmt(e.em)) + '</td><td>' + esc(e.por) + '</td><td>' + esc(e.txt) + (e.obs ? '<i>' + esc(e.obs) + '</i>' : '') + '</td></tr>').join('') + '</tbody></table>' +
    (r.status === 'Concluído' ? '' : '<p class="pr-sec">Serviço realizado</p><div class="pr-linhas"><span></span><span></span><span></span></div>') +
    assImp(['Técnico responsável' + (r.responsavel ? ': ' + esc(r.responsavel) : ''), 'Gestor da manutenção']) + rodapeImp() + '</div>');
}

// ---------- Relatórios (gestor) ----------
// Cada relatório vira uma folha para imprimir ou salvar em PDF. Os dados vêm do servidor na hora de gerar.
const RELATORIOS = [
  { id: 'resumo', nome: 'Resumo do período', desc: 'Checklists feitos, disponibilidade da frota, OS, custo, equipamentos parados, preventivas e os itens que mais deram problema. Bom para mandar para a diretoria.' },
  { id: 'ranking', nome: 'Ranking da frota', desc: 'Todos os equipamentos lado a lado: disponibilidade, dias parado, uso, checklists, OS e custo. Os que mais dão problema aparecem primeiro.' },
  { id: 'custos', nome: 'Custos de manutenção', desc: 'Quanto foi gasto em peças e mão de obra, por equipamento e por item do checklist, com a lista das OS.' },
  { id: 'falta', nome: 'Checklists em falta', desc: 'Dias em que cada equipamento ficou sem checklist no período, do que mais falhou para o que menos falhou.' },
  { id: 'abertas', nome: 'OS em aberto', desc: 'Situação atual: todas as OS em aberto, há quantos dias, prioridade, número da OS e responsável.', atual: true },
  { id: 'preventivas', nome: 'Preventivas', desc: 'Situação atual: todas as preventivas por equipamento, das vencidas para as em dia.', atual: true },
];
const isoDe = d => isoDia(d);
function periodoRapido(v) {
  const h = new Date(), y = h.getFullYear(), m = h.getMonth();
  if (v === 'mes') return [isoDe(new Date(y, m, 1)), hojeISO()];
  if (v === 'mespassado') return [isoDe(new Date(y, m - 1, 1)), isoDe(new Date(y, m, 0))];
  if (v === '30') return [isoMenos(29), hojeISO()];
  if (v === 'ano') return [isoDe(new Date(y, 0, 1)), hojeISO()];
  return null;
}
function renderRelatorios() {
  if (!$('#rlDe').value) { const p = periodoRapido('mes'); $('#rlDe').value = p[0]; $('#rlAte').value = p[1]; }
  $('#rlLista').innerHTML = RELATORIOS.map(r => '<div class="rl-card"><div><b>' + r.nome + '</b>' + (r.atual ? '<span class="rl-tag">situação atual</span>' : '') + '<p>' + r.desc + '</p></div>' +
    '<button type="button" class="btn dark" data-rel="' + r.id + '">Gerar PDF</button></div>').join('');
}
$('#rlRapido').addEventListener('change', () => {
  const p = periodoRapido($('#rlRapido').value);
  if (p) { $('#rlDe').value = p[0]; $('#rlAte').value = p[1]; }
});
['#rlDe', '#rlAte'].forEach(s => $(s).addEventListener('input', () => { $('#rlRapido').value = ''; }));
$('#rlLista').addEventListener('click', async e => {
  const b = e.target.closest('[data-rel]'); if (!b) return;
  const de = $('#rlDe').value, ate = $('#rlAte').value;
  if (!de || !ate || de > ate) { toast('Escolha um período válido: a data inicial não pode ser depois da final.', true); return; }
  if (!navigator.onLine) { toast('Os relatórios precisam de internet para buscar tudo do servidor.', true); return; }
  const txt = b.textContent; b.disabled = true; b.textContent = 'Gerando…';
  try { await gerarRelatorio(b.dataset.rel, de, ate); }
  catch (ex) { toast('Não foi possível gerar o relatório: ' + traduzErro(ex), true); }
  finally { b.disabled = false; b.textContent = txt; }
});

/** Números de cada equipamento no período [de, ate]. */
function numerosDoPeriodo(insps, reqs, de, ate) {
  const hoje = hojeISO(), fim = ate > hoje ? hoje : ate;
  const dias = Math.max(1, diffDias(de, fim) + 1);
  const dentro = d => d && d >= de && d <= ate;
  const diaDe = v => { const d = paraData(v); return d ? isoDia(d) : ''; };
  const porEq = S.equip.map(e => {
    const todas = insps.filter(i => i.placaId === e.id).sort((a, b) => a.dataInspecao.localeCompare(b.dataInspecao) || (a.criadoEmLocal || 0) - (b.criadoEmLocal || 0));
    const per = todas.filter(i => dentro(i.dataInspecao));
    const datas = new Set(per.map(i => i.dataInspecao));
    const liberados = per.filter(i => i.liberado === 'SIM').length;
    // Paradas que tocam o período, contando só os dias de dentro.
    const pars = paradas(todas).filter(p => p.ini <= fim && (p.fim || hoje) >= de);
    const diasParado = pars.reduce((s, p) => s + Math.max(1, diffDias(p.ini < de ? de : p.ini, (p.fim || hoje) > fim ? fim : (p.fim || hoje))), 0);
    const leit = per.filter(i => typeof i.kmHrValor === 'number');
    const uso = leit.length >= 2 ? Math.round((leit[leit.length - 1].kmHrValor - leit[0].kmHrValor) * 10) / 10 : null;
    const doEq = reqs.filter(r => r.placa === e.placa);
    const abertas = doEq.filter(r => dentro(diaDe(r.criadoEm || r.criadoEmLocal)));
    const concl = doEq.filter(r => r.status === 'Concluído' && dentro(diaDe(r.fechadoEm)));
    const comCusto = doEq.filter(r => temCusto(r) && dentro(diaDe(r.fechadoEm) || diaDe(r.criadoEm || r.criadoEmLocal)));
    const faltam = [];
    for (let k = 0; k < dias; k++) { const d = isoDia(new Date(Date.UTC(...de.split('-').map((v, i) => i === 1 ? v - 1 : +v)) + k * 864e5 + 12 * 36e5)); if (!datas.has(d)) faltam.push(d); }
    return {
      e, checklists: per.length, diasCom: datas.size, faltam, liberados, disp: per.length ? Math.round(liberados / per.length * 100) : null,
      paradas: pars.length, diasParado, paradoAgora: pars.find(p => p.aberta), uso, un: UNID[e.tipoMedidor] || '',
      osAbertas: abertas, osConcl: concl, comCusto, custo: comCusto.reduce((s, r) => s + custoReq(r), 0),
      pecas: comCusto.reduce((s, r) => s + (r.custoPecas || 0), 0), mo: comCusto.reduce((s, r) => s + (r.custoMaoObra || 0), 0),
    };
  });
  return { dias, fim, porEq, dentro, diaDe };
}

const kpisImp = l => '<div class="pr-kpis">' + l.map(([t, v, s]) => '<div><span>' + t + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>').join('') + '</div>';
const tabImp = (cab, linhas, vazio) => linhas.length
  ? '<table class="pr-tab"><thead><tr>' + cab.map(c => '<th' + (c.startsWith('>') ? ' class="r"' : '') + '>' + c.replace(/^>/, '') + '</th>').join('') + '</tr></thead><tbody>' +
    linhas.map(l => '<tr>' + l.map((v, i) => '<td' + (cab[i].startsWith('>') ? ' class="r"' : '') + '>' + v + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
  : '<div class="pr-vazio">' + vazio + '</div>';
const pct = v => v == null ? '—' : v + '%';
const nomeEq = e => esc(e.placa) + ' · ' + esc(e.equipamento || '');

async function gerarRelatorio(qual, de, ate) {
  const rel = RELATORIOS.find(r => r.id === qual);
  const precisa = qual !== 'preventivas';
  const [insps, reqs] = precisa ? await Promise.all([
    getDocs(query(collection(db, 'inspecoes'), where('dataInspecao', '>=', isoMenos(400) < de ? isoMenos(400) : de))).then(q => q.docs.map(d => ({ id: d.id, ...d.data() }))),
    getDocs(collection(db, 'requerimentos')).then(q => q.docs.map(d => ({ id: d.id, ...d.data() }))),
  ]) : [[], []];
  const n = numerosDoPeriodo(insps, reqs, de, ate);
  const sub = rel.atual ? 'Situação em ' + fmtData(hojeISO()) : fmtData(de) + ' a ' + fmtData(ate);
  let corpo = '';
  const tot = (f) => n.porEq.reduce((s, x) => s + f(x), 0);

  if (qual === 'resumo') {
    const nch = tot(x => x.checklists), lib = tot(x => x.liberados), diasCom = tot(x => x.diasCom), esperado = n.dias * S.equip.length;
    const osAb = reqs.filter(r => n.dentro(n.diaDe(r.criadoEm || r.criadoEmLocal)));
    const osCo = reqs.filter(r => r.status === 'Concluído' && n.dentro(n.diaDe(r.fechadoEm)));
    const dur = osCo.map(diasAteFechar).filter(d => d != null);
    const parados = n.porEq.filter(x => x.paradoAgora);
    const prevAl = S.equip.flatMap(e => alertasPrev(e));
    const top = itensMuPr(osAb).slice(0, 10);
    corpo = kpisImp([
      ['Checklists feitos', nch, diasCom + ' de ' + esperado + ' dias-equipamento (' + (esperado ? Math.round(diasCom / esperado * 100) : 0) + '%)'],
      ['Disponibilidade da frota', pct(nch ? Math.round(lib / nch * 100) : null), lib + ' checklists liberados'],
      ['OS abertas', osAb.length, 'MU ' + osAb.filter(r => String(r.classificacao).startsWith('MU')).length + ' · PR ' + osAb.filter(r => String(r.classificacao).startsWith('PR')).length],
      ['OS concluídas', osCo.length, 'tempo médio ' + (dur.length ? fmtDias(Math.round(dur.reduce((a, b) => a + b, 0) / dur.length * 10) / 10) : '—')],
      ['Custo de manutenção', fmtReais(tot(x => x.custo)), 'peças ' + fmtReais(tot(x => x.pecas)) + ' · mão de obra ' + fmtReais(tot(x => x.mo))],
      ['Em aberto agora', reqs.filter(r => STATUS_ABERTOS.includes(r.status)).length, 'OS aguardando ou em execução'],
      ['Parados agora', parados.length, 'último checklist não liberado'],
      ['Preventivas vencidas', prevAl.filter(a => a.st === 'vencida').length, prevAl.filter(a => a.st === 'perto').length + ' chegando perto'],
    ]) +
    '<p class="pr-sec">Equipamentos</p>' + tabImp(['Equipamento', '>Checklists', '>Disponib.', '>Dias parado', '>OS abertas', '>Custo'],
      n.porEq.slice().sort((a, b) => (a.disp ?? 101) - (b.disp ?? 101) || b.diasParado - a.diasParado)
        .map(x => [nomeEq(x.e), x.checklists, pct(x.disp), x.diasParado, x.osAbertas.length, x.comCusto.length ? fmtReais(x.custo) : '—']), 'Nenhum equipamento cadastrado.') +
    '<div class="pr-2col"><div><p class="pr-sec">Itens que mais deram problema</p>' + tabImp(['Item', '>MU', '>PR', '>Total'], top.map(([k, v, o]) => [esc(k), o.mu, o.pr, v]), 'Nenhuma divergência no período.') + '</div>' +
    '<div><p class="pr-sec">Parados agora</p>' + tabImp(['Equipamento', 'Desde', '>Dias'], parados.map(x => [nomeEq(x.e), fmtData(x.paradoAgora.ini), x.paradoAgora.dias]), 'Nenhum equipamento parado.') + '</div></div>' +
    assImp(['Gestor da manutenção', 'Diretoria']);
  }

  if (qual === 'ranking') {
    const l = n.porEq.slice().sort((a, b) => (a.disp ?? 101) - (b.disp ?? 101) || b.diasParado - a.diasParado || b.custo - a.custo);
    corpo = '<p class="pr-nota" style="margin-bottom:6px">Ordenado pela menor disponibilidade. Disponibilidade = checklists liberados ÷ checklists feitos. Uso = diferença entre a primeira e a última leitura do período.</p>' +
      tabImp(['#', 'Equipamento', 'Equipe', '>Checklists', '>Disponib.', '>Paradas', '>Dias parado', '>Uso', '>OS', '>Concluídas', '>Custo'],
        l.map((x, i) => [i + 1, nomeEq(x.e), esc(x.e.equipe || ''), x.diasCom + '/' + n.dias, pct(x.disp), x.paradas, x.diasParado,
          x.uso == null ? '—' : fmtNum(x.uso) + ' ' + x.un, x.osAbertas.length, x.osConcl.length, x.comCusto.length ? fmtReais(x.custo) : '—']), 'Nenhum equipamento cadastrado.');
  }

  if (qual === 'custos') {
    const os = n.porEq.flatMap(x => x.comCusto);
    const itens = {};
    os.forEach(r => { const k = r.itemNumero + ' · ' + r.itemNome; const v = itens[k] || (itens[k] = { n: 0, t: 0 }); v.n++; v.t += custoReq(r); });
    corpo = kpisImp([
      ['Custo total', fmtReais(tot(x => x.custo)), os.length + ' OS com custo'],
      ['Peças', fmtReais(tot(x => x.pecas)), ''], ['Mão de obra', fmtReais(tot(x => x.mo)), ''],
      ['Média por OS', os.length ? fmtReais(tot(x => x.custo) / os.length) : '—', ''],
    ]) +
    '<p class="pr-sec">Por equipamento</p>' + tabImp(['Equipamento', '>OS', '>Peças', '>Mão de obra', '>Total'],
      n.porEq.filter(x => x.comCusto.length).sort((a, b) => b.custo - a.custo).map(x => [nomeEq(x.e), x.comCusto.length, fmtReais(x.pecas), fmtReais(x.mo), '<b>' + fmtReais(x.custo) + '</b>']), 'Nenhuma OS com custo no período.') +
    '<p class="pr-sec">Por item do checklist</p>' + tabImp(['Item', '>OS', '>Total'], Object.entries(itens).sort((a, b) => b[1].t - a[1].t).map(([k, v]) => [esc(k), v.n, fmtReais(v.t)]), 'Nenhuma OS com custo no período.') +
    '<p class="pr-sec">OS com custo</p>' + tabImp(['Requerimento', 'Nº OS', 'Placa', 'Item', 'Fechamento', '>Peças', '>Mão de obra', '>Total'],
      os.sort((a, b) => custoReq(b) - custoReq(a)).map(r => [esc(r.codigo), esc(r.numeroOS || '—'), esc(r.placa), esc(r.itemNumero + ' · ' + r.itemNome), esc(fmt(r.fechadoEm).slice(0, 10) || 'em aberto'),
        fmtReais(r.custoPecas), fmtReais(r.custoMaoObra), fmtReais(custoReq(r))]), 'Nenhuma OS com custo no período.');
  }

  if (qual === 'falta') {
    const l = n.porEq.slice().sort((a, b) => b.faltam.length - a.faltam.length);
    const falt = tot(x => x.faltam.length), esperado = n.dias * S.equip.length;
    corpo = kpisImp([
      ['Dias no período', n.dias, 'até ' + fmtData(n.fim)], ['Checklists esperados', esperado, '1 por equipamento por dia'],
      ['Dias sem checklist', falt, esperado ? Math.round(falt / esperado * 100) + '% do esperado' : ''],
      ['Equipamentos em dia', l.filter(x => !x.faltam.length).length, 'de ' + l.length],
    ]) +
    tabImp(['Equipamento', 'Equipe', '>Feitos', '>Faltaram', 'Dias sem checklist'],
      l.map(x => [nomeEq(x.e), esc(x.e.equipe || ''), x.diasCom, '<b>' + x.faltam.length + '</b>',
        '<i class="pr-datas">' + (x.faltam.length ? x.faltam.map(d => fmtData(d).slice(0, 5)).join(', ') : 'nenhum') + '</i>']), 'Nenhum equipamento cadastrado.');
  }

  if (qual === 'abertas') {
    const ab = reqs.filter(r => STATUS_ABERTOS.includes(r.status)).map(r => ({ r, d: Math.max(0, Math.floor((Date.now() - (paraData(r.criadoEm || r.criadoEmLocal) || new Date())) / 864e5)) }))
      .sort((a, b) => (a.r.prioridade === 'ALTA' ? 0 : 1) - (b.r.prioridade === 'ALTA' ? 0 : 1) || b.d - a.d);
    corpo = kpisImp([
      ['Em aberto', ab.length, ''], ['Prioridade alta', ab.filter(x => x.r.prioridade === 'ALTA').length, 'MU ou item crítico'],
      ['Sem responsável', ab.filter(x => !x.r.responsavel).length, ''], ['Há mais de 7 dias', ab.filter(x => x.d > 7).length, ''],
    ]) +
    tabImp(['Requerimento', 'Abertura', '>Dias', 'Placa', 'Item', 'Prioridade', 'Status', 'Nº OS', 'Responsável'],
      ab.map(({ r, d }) => [esc(r.codigo), esc(fmt(r.criadoEm || r.criadoEmLocal).slice(0, 10)), '<b>' + d + '</b>', esc(r.placa), esc(r.itemNumero + ' · ' + r.itemNome),
        esc(r.prioridade), esc(r.status), esc(r.numeroOS || '—'), esc(r.responsavel || '—')]), 'Nenhuma OS em aberto.');
  }

  if (qual === 'preventivas') {
    const l = S.equip.flatMap(e => prevDoEq(e).map(p => ({ e, p, s: situacaoPrev(p, e), un: UNID[e.tipoMedidor] || '' }))).filter(x => x.un)
      .sort((a, b) => a.s.falta / a.p.intervalo - b.s.falta / b.p.intervalo);
    const rot = { vencida: 'Vencida', perto: 'Chegando', ok: 'Em dia' };
    corpo = kpisImp([
      ['Preventivas', l.length, ''], ['Vencidas', l.filter(x => x.s.st === 'vencida').length, ''],
      ['Chegando perto', l.filter(x => x.s.st === 'perto').length, 'faltam 10% ou menos'], ['Em dia', l.filter(x => x.s.st === 'ok').length, ''],
    ]) +
    tabImp(['Equipamento', 'Serviço', '>A cada', '>Última', '>Próxima', '>Atual', '>Falta', 'Situação'],
      l.map(x => [nomeEq(x.e), esc(x.p.nome), fmtNum(x.p.intervalo) + ' ' + x.un, fmtNum(x.p.ultimaFeita), fmtNum(x.s.proxima), fmtNum(x.s.atual),
        (x.s.falta < 0 ? '−' + fmtNum(-x.s.falta) : fmtNum(x.s.falta)) + ' ' + x.un, '<b class="pr-st-' + x.s.st + '">' + rot[x.s.st] + '</b>']), 'Nenhuma preventiva cadastrada.');
  }

  await imprimir(rel.nome + ' ' + (rel.atual ? fmtData(hojeISO()) : fmtData(de) + ' a ' + fmtData(ate)).replace(/\//g, '-'),
    '<div class="pr-folha pr-rel" data-rel="' + qual + '">' + cabImp(rel.nome.toUpperCase(), 'RELATÓRIO', sub) + corpo + rodapeImp() + '</div>');
}

// ---------- QR code do equipamento ----------
// A etiqueta leva o endereço do app com ?placa=...: a câmera do celular abre o checklist com a placa preenchida.
let placaDoQR = new URLSearchParams(location.search).get('placa') || '';
if (placaDoQR) history.replaceState(null, '', location.pathname);
function usarPlacaDoQR() {
  if (!placaDoQR || !S.equip.length) return;
  const e = S.equip.find(x => String(x.placa).toUpperCase() === placaDoQR.trim().toUpperCase());
  if (e) { $('#placa').value = e.placa; $('#placa').dispatchEvent(new Event('change')); }
  else toast('A placa ' + placaDoQR + ' da etiqueta não está cadastrada.', true);
  placaDoQR = '';
}
const linkQR = e => location.origin + location.pathname.replace(/index\.html$/, '') + '?placa=' + encodeURIComponent(e.placa);
function svgQR(texto) {
  const q = qrcode(0, 'M'); q.addData(texto); q.make();
  const n = q.getModuleCount(), m = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
  return '<svg class="qr" viewBox="' + -m + ' ' + -m + ' ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" shape-rendering="crispEdges" role="img" aria-label="QR code para ' + esc(texto) + '">' +
    '<rect x="' + -m + '" y="' + -m + '" width="' + (n + 2 * m) + '" height="' + (n + 2 * m) + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
const etiquetaQR = e => '<div class="pr-etq" data-placa="' + esc(e.placa) + '"><div class="pr-etq-cab"><span class="pr-marca">CHK</span><b>Checklist de Averiguação</b></div>' +
  svgQR(linkQR(e)) + '<b class="pr-etq-placa">' + esc(e.placa) + '</b><span class="pr-etq-nome">' + esc(e.equipamento || '') + '</span>' +
  '<small>Aponte a câmera do celular para abrir o checklist deste equipamento.</small></div>';
function imprimirEtiquetas(lista) {
  if (!lista.length) { toast('Nenhum equipamento cadastrado.', true); return; }
  imprimir(lista.length === 1 ? 'Etiqueta QR ' + lista[0].placa : 'Etiquetas QR', '<div class="pr-etiquetas">' + lista.map(etiquetaQR).join('') + '</div>');
}
$('#btnEtiquetas').addEventListener('click', () => imprimirEtiquetas(S.equip));

// ---------- Avisos no aparelho ----------
// Com o app aberto (ou em segundo plano), o técnico é avisado de OS nova com ele e o gestor de requerimento urgente.
// Aviso com o app totalmente fechado precisa de um servidor (plano Blaze do Firebase).
const podeAvisar = () => 'Notification' in window;
function atualizarBtnAvisos() {
  const mostrar = podeAvisar() && (gestor() || tecnico()) && Notification.permission === 'default';
  $$('[data-avisos-btn]').forEach(b => { b.hidden = !mostrar; });
}
$$('[data-avisos-btn]').forEach(b => b.addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch (e) {}
  atualizarBtnAvisos();
  if (Notification.permission === 'granted') toast('Avisos ativados neste aparelho');
  else if (Notification.permission === 'denied') toast('Avisos bloqueados. Libere nas configurações do navegador.', true);
}));
async function avisar(titulo, corpo, tag) {
  if (!podeAvisar() || Notification.permission !== 'granted') return;
  const op = { body: corpo, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    // No Android o aviso precisa sair pelo service worker.
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(titulo, op); return; }
  } catch (e) {}
  try { new Notification(titulo, op); } catch (e) {}
}
/** Documentos que apareceram desde a última leitura. A primeira leitura do servidor só marca o que já existe. */
function novidades(chave, snap) {
  const v = novidades.vistos[chave] || (novidades.vistos[chave] = { pronto: false, ids: new Set() });
  const novos = snap.docs.filter(d => !v.ids.has(d.id));
  snap.docs.forEach(d => v.ids.add(d.id));
  if (!v.pronto) { if (!snap.metadata.fromCache) v.pronto = true; return []; }
  return novos.map(d => ({ id: d.id, ...d.data() }));
}
novidades.vistos = {};

// ---------- Relatório do equipamento ----------
// Ao tocar num quadrado: disponibilidade, tempo parado, uso do KM / horímetro, OS e itens que mais dão problema,
// calculados no aparelho a partir de todos os checklists e requerimentos do equipamento.
const isoDia = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const isoMenos = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoDia(d); };
const diffDias = (a, b) => Math.round((Date.UTC(...b.split('-').map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...a.split('-').map((v, i) => i === 1 ? v - 1 : +v))) / 864e5);
const fmtDias = n => n == null ? '—' : (n < 1 ? 'menos de 1 dia' : fmtNum(n) + (n === 1 ? ' dia' : ' dias'));

/** Paradas: de um checklist "NÃO liberado" até o próximo "SIM". A que ainda não terminou conta até hoje. */
function paradas(insps) {
  const hoje = hojeISO(), lista = [];
  let ini = null;
  insps.forEach(i => {
    if (i.liberado === 'NÃO' && !ini) ini = i.dataInspecao;
    else if (i.liberado === 'SIM' && ini) { lista.push({ ini, fim: i.dataInspecao, dias: Math.max(1, diffDias(ini, i.dataInspecao)) }); ini = null; }
  });
  if (ini) lista.push({ ini, fim: null, dias: Math.max(1, diffDias(ini, hoje)), aberta: true });
  return lista;
}

function calcRelatorio(eq, todasInsp, todosReqs, periodo) {
  const hoje = hojeISO();
  const insps = todasInsp.slice().sort((a, b) => a.dataInspecao.localeCompare(b.dataInspecao) || (a.criadoEmLocal || 0) - (b.criadoEmLocal || 0));
  const primeira = insps[0] && insps[0].dataInspecao;
  const ini = periodo ? isoMenos(periodo - 1) : (primeira || hoje);
  const dias = Math.max(1, diffDias(ini, hoje) + 1);
  const noPer = insps.filter(i => i.dataInspecao >= ini);
  const diasCom = new Set(noPer.map(i => i.dataInspecao)).size;
  const liberados = noPer.filter(i => i.liberado === 'SIM').length;
  const pars = paradas(insps).filter(p => (p.fim || hoje) >= ini);
  const parAtual = pars.find(p => p.aberta);
  const fechadas = pars.filter(p => !p.aberta);
  // Uso: diferença entre a primeira e a última leitura do período, dividida pelos dias entre elas.
  const leit = noPer.filter(i => typeof i.kmHrValor === 'number');
  let uso = null;
  if (leit.length >= 2) {
    const a = leit[0], b = leit[leit.length - 1], d = diffDias(a.dataInspecao, b.dataInspecao);
    const total = Math.round((b.kmHrValor - a.kmHrValor) * 10) / 10;
    uso = { total, porDia: d > 0 ? Math.round(total / d * 10) / 10 : null, porChecklist: Math.round(total / (leit.length - 1) * 10) / 10 };
  }
  const tempo = r => paraData(r.criadoEm || r.criadoEmLocal);
  const reqsPer = todosReqs.filter(r => { const d = tempo(r); return d && isoDia(d) >= ini; });
  const concluidos = todosReqs.filter(r => r.status === 'Concluído' && r.fechadoEm && isoDia(paraData(r.fechadoEm)) >= ini);
  const durOS = concluidos.map(diasAteFechar).filter(d => d != null);
  // Custo: OS com custo informado, contadas pela data de fechamento (ou de abertura, se ainda abertas).
  const comCusto = todosReqs.filter(r => { const d = paraData(r.fechadoEm) || tempo(r); return temCusto(r) && d && isoDia(d) >= ini; });
  const custo = {
    total: comCusto.reduce((s, r) => s + custoReq(r), 0), pecas: comCusto.reduce((s, r) => s + (r.custoPecas || 0), 0),
    mo: comCusto.reduce((s, r) => s + (r.custoMaoObra || 0), 0), os: comCusto.length,
  };
  custo.porMes = custo.total / Math.max(1, dias / 30);
  return {
    ini, dias, total: noPer.length, diasCom, liberados, custo,
    disponibilidade: noPer.length ? Math.round(liberados / noPer.length * 100) : null,
    paradas: pars.length, parAtual,
    mediaParado: fechadas.length ? Math.round(fechadas.reduce((s, p) => s + p.dias, 0) / fechadas.length * 10) / 10 : (parAtual ? null : 0),
    // Dias parados dentro do período (uma parada que começou antes conta só a parte de dentro).
    diasParado: pars.reduce((s, p) => s + Math.max(1, diffDias(p.ini < ini ? ini : p.ini, p.fim || hoje)), 0),
    uso, leituras: leit.map(i => ({ d: i.dataInspecao, v: i.kmHrValor })),
    osPer: reqsPer.length, osMU: reqsPer.filter(r => String(r.classificacao).startsWith('MU')).length, osPR: reqsPer.filter(r => String(r.classificacao).startsWith('PR')).length,
    osAbertas: todosReqs.filter(r => STATUS_ABERTOS.includes(r.status)).sort((a, b) => (b.criadoEmLocal || 0) - (a.criadoEmLocal || 0)),
    osConcluidas: concluidos.length, mediaOS: durOS.length ? Math.round(durOS.reduce((s, d) => s + d, 0) / durOS.length * 10) / 10 : null,
    topItens: itensMuPr(reqsPer).slice(0, 5),
    // Últimos 30 dias, um quadradinho por dia com a cor do checklist daquele dia.
    faixa: Array.from({ length: 30 }, (_, k) => {
      const d = isoMenos(29 - k), i = insps.findLast(x => x.dataInspecao === d), c = i && (i.contagem || {});
      return { d, st: !i ? 'nada' : c.MU ? 'mu' : c.PR ? 'pr' : 'ok', insp: i };
    }),
  };
}

function graficoLeituras(pts, un) {
  if (pts.length < 2) return '<p class="hint">Precisa de pelo menos duas leituras de ' + (un === 'h' ? 'horímetro' : 'KM') + ' no período.</p>';
  const W = 600, H = 120, P = 6;
  const t0 = Date.parse(pts[0].d), t1 = Date.parse(pts[pts.length - 1].d) || t0 + 1;
  const v0 = Math.min(...pts.map(p => p.v)), v1 = Math.max(...pts.map(p => p.v)) || v0 + 1;
  const x = p => P + (Date.parse(p.d) - t0) / Math.max(1, t1 - t0) * (W - 2 * P);
  const y = p => H - P - (p.v - v0) / Math.max(1, v1 - v0) * (H - 2 * P);
  const linha = pts.map((p, i) => (i ? 'L' : 'M') + x(p).toFixed(1) + ' ' + y(p).toFixed(1)).join(' ');
  return '<svg class="rel-graf" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Leituras de ' + fmtNum(v0) + ' a ' + fmtNum(v1) + ' ' + un + '">' +
    '<path d="' + linha + ' L' + x(pts[pts.length - 1]).toFixed(1) + ' ' + H + ' L' + x(pts[0]).toFixed(1) + ' ' + H + 'Z" class="area"/><path d="' + linha + '" class="linha"/></svg>' +
    '<div class="rel-graf-leg"><span>' + fmtData(pts[0].d) + ' · ' + fmtNum(v0) + ' ' + un + '</span><span>' + fmtData(pts[pts.length - 1].d) + ' · ' + fmtNum(v1) + ' ' + un + '</span></div>';
}

async function abrirRelatorio(eq) {
  const { st, insp: hoje } = statusHoje(eq);
  const un = UNID[eq.tipoMedidor] || '';
  $('#modalRoot').innerHTML =
    '<div class="ov" id="ov"><div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="relTit">' +
      '<div class="block-h"><h2 id="relTit">' + esc(eq.equipamento || eq.placa) + ' · ' + esc(eq.placa) + '</h2><button class="modal-x" id="mX" aria-label="Fechar">×</button></div>' +
      '<div class="modal-b" id="relCorpo"><div class="rel-topo"><span class="eq-selo st-' + st + '"><span class="eq-sim">' + icEq(st) + '</span>' + ST_EQ[st].nome + '</span>' +
        '<select class="inp" id="relPer" aria-label="Período"><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Último ano</option><option value="0">Desde o primeiro checklist</option></select></div>' +
        '<div id="relDados"><p class="dim">Carregando o histórico…</p></div></div>' +
      '<div class="modal-f">' + (gestor() ? '<button class="btn" id="relEditar">Editar cadastro</button><button class="btn" id="relQR" style="margin-right:auto">Etiqueta QR</button>' : '') +
        (hoje ? '<button class="btn dark" id="relHoje">Ver checklist de hoje</button>' : '') + '<button class="btn" id="mCancelar">Fechar</button></div>' +
    '</div></div>';
  const fechar = () => { $('#modalRoot').innerHTML = ''; };
  $('#mX').onclick = fechar; $('#mCancelar').onclick = fechar;
  $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') fechar(); });
  if ($('#relEditar')) $('#relEditar').onclick = () => abrirEquip(eq);
  if ($('#relQR')) $('#relQR').onclick = () => imprimirEtiquetas([eq]);
  if (hoje) $('#relHoje').onclick = () => abrirInsp(hoje);

  // Abre na hora com o que o app já tem na memória; o histórico completo vem do servidor e redesenha em seguida.
  const doEq = l => [...new Map(l.filter(r => r.placa === eq.placa).map(r => [r.id, r])).values()];
  let insps = S.insp.filter(i => i.placaId === eq.id), reqs = doEq([...S.reqAbertos, ...S.reqRecentes]);

  const pintar = () => {
    const r = calcRelatorio(eq, insps, reqs, Number($('#relPer').value));
    const kpi = (lbl, val, sub, alerta) => '<div class="kpi' + (alerta ? ' alert' : '') + '"><span class="lbl">' + lbl + '</span><span class="val">' + val + '</span><span class="sub">' + sub + '</span></div>';
    const pct = r.disponibilidade == null ? '—' : r.disponibilidade + '%';
    $('#relDados').innerHTML = !insps.length ? '<div class="empty"><h3>Ainda sem checklist</h3><p>O relatório aparece depois do primeiro checklist deste equipamento.</p></div><div id="relPrev"></div>' :
      (r.parAtual ? '<div class="callout err">Parado há <b>' + fmtDias(r.parAtual.dias) + '</b>, desde ' + fmtData(r.parAtual.ini) + ' (último checklist não liberado).</div>' : '') +
      '<div class="kpis rel-kpis">' +
        kpi('Disponibilidade', pct, r.liberados + ' de ' + r.total + ' checklists liberados', r.disponibilidade != null && r.disponibilidade < 80) +
        kpi('Tempo médio parado', r.mediaParado == null ? '—' : fmtDias(r.mediaParado), r.paradas + (r.paradas === 1 ? ' parada' : ' paradas') + ' · ' + fmtDias(r.diasParado) + ' no total', r.paradas > 0) +
        kpi('Uso médio', r.uso && r.uso.porDia != null ? fmtNum(r.uso.porDia) + ' ' + un + '/dia' : '—', r.uso ? fmtNum(r.uso.total) + ' ' + un + ' no período · ' + fmtNum(r.uso.porChecklist) + ' ' + un + ' por checklist' : (un ? 'sem leituras suficientes' : 'equipamento sem medidor')) +
        kpi('Checklists feitos', r.diasCom + ' de ' + r.dias, 'dias com checklist (' + Math.round(r.diasCom / r.dias * 100) + '%)', r.diasCom / r.dias < 0.5) +
        kpi('OS no período', r.osPer, 'MU ' + r.osMU + ' · PR ' + r.osPR + ' · ' + r.osAbertas.length + ' em aberto agora', r.osAbertas.length > 0) +
        kpi('Tempo médio da OS', r.mediaOS == null ? '—' : fmtDias(r.mediaOS), r.osConcluidas + ' concluída(s) no período') +
        kpi('Custo de manutenção', r.custo.os ? fmtReais(r.custo.total) : '—', r.custo.os ? 'peças ' + fmtReais(r.custo.pecas) + ' · mão de obra ' + fmtReais(r.custo.mo) + ' · ' + fmtReais(r.custo.porMes) + ' por mês' : 'nenhuma OS com custo no período') +
      '</div>' +
      '<div id="relPrev"></div>' +
      '<div><p class="section-t">Últimos 30 dias</p><div class="rel-faixa">' + r.faixa.map(f => '<span class="st-' + f.st + (f.insp ? ' tem' : '') + '" data-dia="' + f.d + '" title="' + fmtData(f.d) + ': ' + ST_EQ[f.st].nome.replace(' hoje', '') + '"></span>').join('') + '</div>' +
        '<div class="rel-faixa-leg"><span>' + fmtData(r.faixa[0].d).slice(0, 5) + '</span><span class="chart-leg">' + ['ok', 'mu', 'pr', 'nada'].map(k => '<span><i class="st-' + k + '" style="background:var(--st)"></i>' + ST_EQ[k].nome.replace(' hoje', '') + '</span>').join('') + '</span><span>hoje</span></div></div>' +
      (un ? '<div><p class="section-t">' + (un === 'h' ? 'Horímetro' : 'KM') + ' no período</p>' + graficoLeituras(r.leituras, un) + '</div>' : '') +
      '<div class="rel-2col"><div><p class="section-t">Itens que mais deram problema</p>' + (r.topItens.length ? '<div class="hbars">' + r.topItens.map(([k, v, o]) =>
          '<div class="hbar"><span class="t" title="' + esc(k) + '">' + esc(k) + '</span><span class="v">' + v + ' <small>' + txtMuPr(o) + '</small></span><div class="track"><span style="width:' + (v / r.topItens[0][1] * 100) + '%"></span></div></div>').join('') + '</div>' : '<p class="hint">Nenhuma divergência no período.</p>') + '</div>' +
        '<div><p class="section-t">OS em aberto</p>' + (r.osAbertas.length ? '<ul class="rel-os">' + r.osAbertas.map(o => '<li data-req="' + esc(o.id) + '"><span><b>' + esc(o.itemNome) + '</b><small>' + esc(o.codigo) + ' · ' + fmt(o.criadoEm || o.criadoEmLocal).slice(0, 10) + (o.responsavel ? ' · ' + esc(o.responsavel) : '') + '</small></span><span class="pill s-' + slug(o.status) + '">' + esc(o.status) + '</span></li>').join('') + '</ul>' : '<p class="hint">Nenhuma OS em aberto.</p>') + '</div></div>';
  };
  $('#relPer').onchange = () => { pintar(); pintarPrev(eq); };
  // Sem nada na memória, espera o servidor em vez de mostrar "Ainda sem checklist" por engano.
  if (insps.length) { pintar(); pintarPrev(eq); }
  const dados = $('#relDados');
  dados.addEventListener('click', e => {
    const dia = e.target.closest('.rel-faixa .tem');
    if (dia) { const i = insps.filter(x => x.dataInspecao === dia.dataset.dia).sort((a, b) => (a.criadoEmLocal || 0) - (b.criadoEmLocal || 0)).pop(); if (i) abrirInsp(i); return; }
    const li = e.target.closest('[data-req]');
    const o = li && reqs.find(x => x.id === li.dataset.req);
    if (o) abrirReq(o);
  });

  try {
    const [qi, qr] = await Promise.all([
      getDocs(query(collection(db, 'inspecoes'), where('placaId', '==', eq.id))),
      getDocs(query(collection(db, 'requerimentos'), where('placa', '==', eq.placa))),
    ]);
    if (!dados.isConnected) return; // fechou enquanto carregava
    insps = qi.docs.map(d => ({ id: d.id, ...d.data() }));
    reqs = doEq([...qr.docs.map(d => ({ id: d.id, ...d.data() })), ...S.reqAbertos]);
    pintar(); pintarPrev(eq);
  } catch (ex) {
    // Sem internet: fica com o que já estava na memória.
    if (dados.isConnected && !insps.length) { pintar(); pintarPrev(eq); }
  }
}

/** Modal de cadastro: `eq` nulo cria um novo; senão edita (a placa não muda, porque é o ID). */
function abrirEquip(eq) {
  const novo = !eq, v = eq || {};
  const a = eq && leituraAtual(eq);
  const sel = (id, ops, atual) => '<select id="' + id + '" class="inp">' + ops.map(([val, txt]) => '<option value="' + val + '"' + (val === (atual || '') ? ' selected' : '') + '>' + txt + '</option>').join('') + '</select>';
  $('#modalRoot').innerHTML =
    '<div class="ov" id="ov"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="eqTit" id="formEq" novalidate>' +
      '<div class="block-h"><h2 id="eqTit">' + (novo ? 'Novo equipamento' : 'Editar ' + esc(v.placa)) + '</h2><button type="button" class="modal-x" id="mX" aria-label="Fechar">×</button></div>' +
      '<div class="modal-b"><div class="row">' +
        '<div class="field"><label for="eqPlaca">Placa / prefixo *</label><input id="eqPlaca" class="inp" autocomplete="off" value="' + esc(v.placa) + '"' + (novo ? '' : ' readonly') + '></div>' +
        '<div class="field" style="flex:2 1 220px"><label for="eqNome">Equipamento *</label><input id="eqNome" class="inp" placeholder="Ex.: Caminhão basculante" value="' + esc(v.equipamento) + '"></div>' +
        '<div class="field"><label for="eqEquipe">Equipe</label><input id="eqEquipe" class="inp" value="' + esc(v.equipe) + '"></div>' +
        '<div class="field"><label for="eqCabine">Cabine fechada</label>' + sel('eqCabine', [['', '—'], ['SIM', 'SIM'], ['NÃO', 'NÃO']], v.cabine) + '</div>' +
        '<div class="field"><label for="eqTipo">Medidor</label>' + sel('eqTipo', [['', 'Sem medidor'], ['KM', 'KM'], ['HR', 'Horímetro']], v.tipoMedidor) + '</div>' +
        '<div class="field"><label for="eqMedidor">KM / horímetro atual</label><input id="eqMedidor" class="inp" inputmode="decimal" autocomplete="off" value="' + (a ? esc(String(a.valor).replace('.', ',')) : '') + '"></div>' +
      '</div><div id="eqErro" class="callout err" hidden style="margin-top:12px"></div></div>' +
      '<div class="modal-f">' + (novo ? '' : '<button type="button" class="btn" id="eqRemover" style="margin-right:auto">Remover</button>') +
        '<button type="button" class="btn" id="mCancelar">Cancelar</button><button type="submit" class="btn primary" id="eqBtn">' + (novo ? 'Adicionar' : 'Salvar') + '</button></div>' +
    '</form></div>';
  const fechar = () => { $('#modalRoot').innerHTML = ''; };
  $('#mX').onclick = fechar; $('#mCancelar').onclick = fechar;
  $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') fechar(); });
  $(novo ? '#eqPlaca' : '#eqNome').focus();
  const erro = msg => { $('#eqErro').hidden = false; $('#eqErro').textContent = msg; };
  if (!novo) $('#eqRemover').onclick = () => {
    if (!confirm('Remover ' + (v.equipamento || v.placa) + ' do cadastro?\n\nOs checklists e requerimentos antigos dele continuam no histórico.')) return;
    deleteDoc(doc(db, 'equipamentos', eq.id)).then(() => toast('Equipamento removido')).catch(ex => toast(traduzErro(ex), true));
    fechar();
  };
  $('#formEq').addEventListener('submit', e => {
    e.preventDefault();
    const placa = $('#eqPlaca').value.trim().toUpperCase(), nome = $('#eqNome').value.trim();
    if (!placa) { $('#eqPlaca').focus(); return erro('Informe a placa ou prefixo.'); }
    if (!nome) { $('#eqNome').focus(); return erro('Informe o nome do equipamento.'); }
    if (novo && S.equip.some(x => x.id === idPlaca(placa))) return erro('Já existe um equipamento com a placa ' + placa + '. Use "Editar" no quadrado dele.');
    const leitura = lerNum($('#eqMedidor').value);
    if (Number.isNaN(leitura)) { $('#eqMedidor').focus(); return erro('O KM / horímetro atual precisa ser um número.'); }
    const dados = { placa: novo ? placa : v.placa, equipamento: nome, equipe: $('#eqEquipe').value.trim(), cabine: $('#eqCabine').value, tipoMedidor: $('#eqTipo').value };
    // O gestor pode corrigir a leitura para qualquer valor; vazio mantém a atual.
    if (leitura != null) Object.assign(dados, { medidorAtual: leitura, medidorEm: serverTimestamp(), medidorPor: S.user.uid });
    setDoc(doc(db, 'equipamentos', novo ? idPlaca(placa) : eq.id), dados, { merge: true })
      .then(() => toast(novo ? 'Equipamento adicionado' : 'Equipamento salvo')).catch(ex => toast(traduzErro(ex), true));
    fechar();
  });
}

// ---------- Cadastros (gestor) ----------
function renderCadastros() {
  if (!gestor()) return;
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
      Object.entries(PAPEIS).map(([p, nome]) => '<option value="' + p + '"' + (u.papel === p ? ' selected' : '') + '>' + nome + '</option>').join('') + '</select></td>' +
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

// ---------- Tabelas no celular ----------
// Na tela estreita cada linha vira um cartão; cada célula recebe o nome da sua coluna (data-l) para o CSS mostrar.
$$('.tbl-wrap').forEach(w => {
  const cab = w.querySelector('thead'), corpo = w.querySelector('tbody');
  if (!cab || !corpo) return;
  w.classList.add('cartoes');
  const nomes = [...cab.querySelectorAll('th')].map(th => th.textContent.trim());
  const rotular = () => corpo.querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('colspan')) td.dataset.l = nomes[i] || ''; }));
  new MutationObserver(rotular).observe(corpo, { childList: true });
  rotular();
});

// ---------- Service worker (abre sem internet) ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
