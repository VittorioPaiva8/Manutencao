// Regras do banco (firestore.rules): o que cada pessoa NÃO pode fazer, mesmo mexendo no código
// do navegador. Grava direto na API do banco "como" o usuário; 403 = recusado.
const { test, expect, criarConta, equipamento, gravar, como, hojeISO, diasAtras } = require('./ajuda');

const OK = 200, NEGADO = 403;

/** Lote igual ao que o app envia: inspeção nova + requerimento + foto. */
function loteChecklist(conta, { placaId = 'ABC1D23', data = hojeISO(), item = 23, foto = false, inspId } = {}) {
  const id = inspId || placaId + '_' + data;
  const lote = [
    { caminho: 'inspecoes/' + id, novo: true, horaServidor: ['criadoEm'], dados: { criadoPor: conta.uid, placaId, dataInspecao: data, respostas: [] } },
    { caminho: 'requerimentos/' + id + '_' + item, novo: true, dados: { criadoPor: conta.uid, status: 'Aberto', ocorrencias: 1, itemNumero: item, inspecaoId: id, descricao: 'x' } },
  ];
  if (foto) lote.push({ caminho: 'fotos/' + id + '_' + item, novo: true, dados: { criadoPor: conta.uid, itemNumero: item, inspecaoId: id, dados: 'data:image/jpeg;base64,AAAA' } });
  return lote;
}

test.beforeEach(async () => { await equipamento('ABC1D23', 'Caminhão'); });

test('checklist válido passa; repetido no mesmo dia, de equipamento inexistente ou data antiga não', async () => {
  const op = await criarConta('Op', 'op@teste.com');
  expect(await como(op).lote(loteChecklist(op, { foto: true }))).toBe(OK);
  expect(await como(op).lote(loteChecklist(op))).not.toBe(OK);
  expect(await como(op).lote(loteChecklist(op, { placaId: 'NAOEXISTE' }))).toBe(NEGADO);
  expect(await como(op).lote(loteChecklist(op, { data: diasAtras(40) }))).toBe(NEGADO);
  // ID da inspeção tem que ser <placa>_<data>.
  expect(await como(op).lote(loteChecklist(op, { data: diasAtras(1), inspId: 'qualquer' }))).toBe(NEGADO);
});

test('segundo checklist do dia ("_2") só depois do primeiro; terceiro não', async () => {
  const op = await criarConta('Op', 'op@teste.com');
  const dia = diasAtras(2), base = 'ABC1D23_' + dia;
  expect(await como(op).lote(loteChecklist(op, { data: dia, inspId: base + '_2' }))).toBe(NEGADO);
  expect(await como(op).lote(loteChecklist(op, { data: dia }))).toBe(OK);
  expect(await como(op).lote(loteChecklist(op, { data: dia, inspId: base + '_2' }))).toBe(OK);
  expect(await como(op).lote(loteChecklist(op, { data: dia, inspId: base + '_2' }))).not.toBe(OK);
  expect(await como(op).lote(loteChecklist(op, { data: dia, inspId: base + '_3' }))).toBe(NEGADO);
});

test('requerimento ou foto sozinhos (sem checklist novo no mesmo envio) são recusados', async () => {
  const op = await criarConta('Op', 'op@teste.com');
  expect(await como(op).lote(loteChecklist(op))).toBe(OK);
  const id = 'ABC1D23_' + hojeISO();
  expect(await como(op).criar('requerimentos/' + id + '_5', { criadoPor: op.uid, status: 'Aberto', ocorrencias: 1, itemNumero: 5, inspecaoId: id, descricao: 'spam' })).toBe(NEGADO);
  expect(await como(op).criar('fotos/' + id + '_5', { criadoPor: op.uid, itemNumero: 5, inspecaoId: id, dados: 'data:image/jpeg;base64,AAAA' })).toBe(NEGADO);
});

test('ninguém se cadastra como gestor nem já ativo', async () => {
  const r = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=teste', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'esperto@teste.com', password: 'senha123', returnSecureToken: true }),
  })).json();
  const conta = { uid: r.localId, token: r.idToken };
  expect(await como(conta).criar('usuarios/' + conta.uid, { nome: 'Esperto', email: 'esperto@teste.com', papel: 'gestor', ativo: false })).toBe(NEGADO);
  expect(await como(conta).criar('usuarios/' + conta.uid, { nome: 'Esperto', email: 'esperto@teste.com', papel: 'operador', ativo: true })).toBe(NEGADO);
  expect(await como(conta).criar('usuarios/' + conta.uid, { nome: 'Esperto', email: 'esperto@teste.com', papel: 'operador', ativo: false })).toBe(OK);
  // Inativo não lê nada.
  expect(await como(conta).ler('equipamentos/ABC1D23')).toBe(NEGADO);
  // E não se aprova sozinho.
  expect(await como(conta).alterar('usuarios/' + conta.uid, { ativo: true })).toBe(NEGADO);
});

test('operador não mexe em cadastros, usuários nem no tratamento das OS', async () => {
  const op = await criarConta('Op', 'op@teste.com');
  await gravar('requerimentos/R1', { status: 'Aberto', ocorrencias: 1, numeroOS: '' });
  expect(await como(op).alterar('requerimentos/R1', { status: 'Concluído' })).toBe(NEGADO);
  expect(await como(op).alterar('requerimentos/R1', { numeroOS: '99' })).toBe(NEGADO);
  expect(await como(op).apagar('requerimentos/R1')).toBe(NEGADO);
  expect(await como(op).alterar('equipamentos/ABC1D23', { equipamento: 'Outro' })).toBe(NEGADO);
  expect(await como(op).criar('config/checklist', { criticos: [] })).toBe(NEGADO);
  expect(await como(op).alterar('usuarios/' + op.uid, { papel: 'gestor' })).toBe(NEGADO);
});

test('KM do cadastro: operador não diminui a leitura', async () => {
  const op = await criarConta('Op', 'op@teste.com');
  await gravar('equipamentos/KM1', { placa: 'KM1', medidorAtual: 1000 });
  expect(await como(op).alterar('equipamentos/KM1', { medidorAtual: 900, medidorPor: op.uid, medidorEm: new Date() })).toBe(NEGADO);
  expect(await como(op).alterar('equipamentos/KM1', { medidorAtual: 'muito', medidorPor: op.uid })).toBe(NEGADO);
});

test('técnico: só muda o status da OS dele, sem cancelar nem trocar número ou responsável', async () => {
  const tec = await criarConta('Téc', 'tec@teste.com', 'tecnico');
  const base = { status: 'OS aberta', numeroOS: '7', responsavel: 'Téc', responsavelUid: tec.uid, fechadoEm: null, historico: [] };
  await gravar('requerimentos/R1', base);
  await gravar('requerimentos/R2', { ...base, responsavelUid: 'outro' });
  const h = (status, obs = '') => [{ em: Date.now(), uid: tec.uid, por: 'Téc', de: 'OS aberta', status, obs }];
  expect(await como(tec).alterar('requerimentos/R1', { status: 'Em análise', historico: h('Em análise') })).toBe(OK);
  expect(await como(tec).alterar('requerimentos/R1', { status: 'Cancelado', historico: [...h('Em análise'), ...h('Cancelado')] })).toBe(NEGADO);
  expect(await como(tec).alterar('requerimentos/R1', { numeroOS: '999' })).toBe(NEGADO);
  expect(await como(tec).alterar('requerimentos/R1', { responsavelUid: 'outro' })).toBe(NEGADO);
  // Sem linha nova no histórico, não passa.
  expect(await como(tec).alterar('requerimentos/R1', { status: 'OS aberta' })).toBe(NEGADO);
  // OS de outro técnico.
  expect(await como(tec).alterar('requerimentos/R2', { status: 'Em análise', historico: h('Em análise') })).toBe(NEGADO);
});
