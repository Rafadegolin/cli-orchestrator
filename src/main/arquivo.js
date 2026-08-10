'use strict';

// Leitura e gravacao dos arquivos de estado do app.
//
// Extraido porque projetos.js e sessao.js precisam exatamente do mesmo cuidado,
// e duplicar gravacao atomica em dois lugares e o tipo de coisa que diverge em
// silencio -- um dos dois ganha um conserto e o outro nao.

const fs = require('fs');
const os = require('os');
const path = require('path');

// ORQ_DADOS existe para os testes apontarem para uma pasta descartavel em vez
// de sujar os dados reais do usuario.
const PASTA = process.env.ORQ_DADOS || path.join(os.homedir(), '.orquestrador');

function caminho(nome) {
  return path.join(PASTA, nome);
}

function lerJson(nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(caminho(nome), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // JSON corrompido nao pode derrubar o app nem apagar o resto: segue com o
      // padrao e PRESERVA o arquivo para inspecao.
      console.error(`[arquivo] ${nome} ilegivel, ignorando:`, err.message);
    }
    return padrao;
  }
}

// Grava ao lado e renomeia. Sem isso, o app morrer no meio de um writeFile
// deixa o arquivo truncado e o estado inteiro se perde.
function gravarJson(nome, dados) {
  fs.mkdirSync(PASTA, { recursive: true });
  const alvo = caminho(nome);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, alvo);
  return alvo;
}

module.exports = { PASTA, caminho, lerJson, gravarJson };
