// Paginação da aba Inspeções: aparece a partir de 21 checklists, com 20 / 50 / 100 por página.
const { test, expect, criarConta, gravarVarios, entrar, aba, hojeISO } = require('./ajuda');

const insps = n => Array.from({ length: n }, (_, i) => ['inspecoes/I' + i, {
  codigo: 'CHK-' + String(i).padStart(3, '0'), dataInspecao: hojeISO(), placa: 'AAA1111', placaId: 'AAA1111', equipamento: 'Caminhão',
  avaliador: 'Op', liberado: 'SIM', contagem: { OK: 50, MU: 0, PR: 0, NA: 0 }, respostas: [], criadoEmLocal: Date.now() - i * 1000, criadoPor: 'x',
}]);

test('com 20 checklists ou menos não mostra paginação; com 25 mostra 2 páginas', async ({ page }) => {
  await gravarVarios(insps(20));
  await entrar(page, await criarConta('Op', 'op@teste.com'));
  await aba(page, 'insp');
  await expect(page.locator('#inspTbody tr[data-id]')).toHaveCount(20);
  await expect(page.locator('#pg-insp')).toBeHidden();

  await gravarVarios(insps(25));
  await expect(page.locator('#inspCont')).toHaveText('25 registro(s)');
  await expect(page.locator('#pg-insp')).toBeVisible();
  await expect(page.locator('#pg-insp')).toContainText('Página 1 de 2');
  await page.click('#pg-insp [data-pg="1"]');
  await expect(page.locator('#inspTbody tr[data-id]')).toHaveCount(5);
  // Trocar o tamanho volta para a primeira página.
  await page.selectOption('#pg-insp [data-tam]', '100');
  await expect(page.locator('#inspTbody tr[data-id]')).toHaveCount(25);
  await expect(page.locator('#pg-insp')).toContainText('1–25 de 25');
});
