'use strict';

// Devolve o bit de execucao ao `spawn-helper` do node-pty.
//
// O PACOTE PUBLICADO NO NPM TRAZ ESSE BINARIO COM MODO 644, e nada no node-pty
// conserta: `scripts/prebuild.js` so confere se a pasta existe, e
// `scripts/post-install.js` mexe apenas no `build/Release` e no conpty.dll do
// Windows. Conferido no tarball de `node-pty@1.1.0`:
//
//     -rw-r--r--  package/prebuilds/darwin-arm64/spawn-helper
//
// Sem o `+x`, `pty.spawn` falha com EACCES e **nenhum terminal abre** -- a
// janela sobe inteira e normal, e so os painéis ficam mortos. E exatamente o
// mesmo sintoma da armadilha nº 1 do empacotamento (modulo nativo dentro do
// asar), por outra causa, e por isso ele engana do mesmo jeito.
//
// No Windows nao ha o que fazer: o `spawn-helper` nem e usado (la o caminho e o
// ConPTY), e permissao de arquivo funciona de outro jeito.
//
// Roda em tres lugares, que sao os tres caminhos ate um app que abre:
//   - `npm run empacotar:mac` (o pacote local)
//   - o job `macos` do release.yml (o pacote publicado)
//   - `testes/subir.js` (rodar do codigo-fonte num Mac)
//
// Uso: node recursos/preparar-mac.js

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function preparar() {
  if (process.platform !== 'darwin') {
    return { aplicado: false, motivo: 'so faz sentido no macOS' };
  }

  const alvo = path.join(
    RAIZ, 'node_modules', 'node-pty', 'prebuilds',
    `darwin-${process.arch}`, 'spawn-helper',
  );

  if (!fs.existsSync(alvo)) {
    return { aplicado: false, motivo: `nao achei ${alvo}` };
  }

  const antes = fs.statSync(alvo).mode;
  // 0o111 = execucao para dono, grupo e outros. Preserva o resto do modo em vez
  // de fixar 0o755: se um dia o pacote vier com algo diferente, nao se perde.
  fs.chmodSync(alvo, antes | 0o111);
  const depois = fs.statSync(alvo).mode;

  return {
    aplicado: true,
    caminho: alvo,
    antes: (antes & 0o777).toString(8),
    depois: (depois & 0o777).toString(8),
    executavel: (depois & 0o111) !== 0,
  };
}

if (require.main === module) {
  const r = preparar();
  if (!r.aplicado) {
    console.log(`spawn-helper: ${r.motivo}`);
    // Nao e erro: no Windows este script simplesmente nao tem trabalho.
    process.exit(process.platform === 'darwin' ? 1 : 0);
  }
  console.log(`spawn-helper: ${r.antes} -> ${r.depois}  (${r.caminho})`);
  if (!r.executavel) {
    console.error('ERRO: o chmod nao pegou -- sem isto nenhum terminal abre');
    process.exit(1);
  }
}

module.exports = { preparar };
