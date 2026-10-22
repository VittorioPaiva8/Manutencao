// Publicação no GitHub: a versão do Firebase CLI fica fixa, para uma versão nova não travar o deploy.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./ajuda');

test('deploy usa uma versão fixa do Firebase CLI (não "latest")', async () => {
  for (const f of ['firebase-hosting-merge.yml', 'firebase-hosting-pull-request.yml']) {
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
    expect(yml, f).toMatch(/firebaseToolsVersion:\s*\d+\.\d+\.\d+\s*$/m);
  }
});
