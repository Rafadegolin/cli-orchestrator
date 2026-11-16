'use strict';

// Imagem colada no terminal vira ARQUIVO, e o painel recebe o caminho.
//
// O Claude Code anexa uma imagem quando o caminho dela aparece no prompt -- e e
// exatamente o que o arrastar (`anexos.js`) ja fazia. Colar so pula o "salvar o
// print em algum lugar e arrastar": o app salva, e cola o caminho entre aspas.
//
// Node puro, sem Electron: quem le a area de transferencia e o `index.js`, que
// entrega os bytes PNG prontos. Assim o `teste:copiar` cobre gravar e podar sem
// abrir o app.
//
// Os arquivos ficam na pasta de dados (`~/.orquestrador/imagens`, ou
// `ORQ_DADOS`), e nao no %TEMP%: o caminho tem de continuar valido enquanto a
// sessao precisar reler a imagem, e o Windows limpa o %TEMP% quando quer.

const fs = require('fs');
const path = require('path');

const arquivo = require('./arquivo');

const PASTA = arquivo.caminho('imagens');
// Um print do dia a dia nao passa de uns poucos MB; 25 MB e uma recusa contra
// um bitmap absurdo virando arquivo, nao um limite que alguem encontre.
const MAX_BYTES = 25 * 1024 * 1024;
const DIAS_PODA = 30;

let seq = 0;

// `2026-11-16_14-03-27-1.png`: legivel, ordena por data, e o contador evita
// colisao de duas colagens no mesmo segundo.
function nomeNovo(agora = new Date()) {
  const d = (n) => String(n).padStart(2, '0');
  seq = (seq + 1) % 1000;
  return `${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}`
    + `_${d(agora.getHours())}-${d(agora.getMinutes())}-${d(agora.getSeconds())}-${seq}.png`;
}

// Devolve `{ caminho }` ou `{ erro }` -- erro de uso vira toast, nunca excecao.
function salvar(png, { pasta = PASTA, agora = new Date() } = {}) {
  if (!Buffer.isBuffer(png) || png.length === 0) return { erro: 'a área de transferência não tem imagem' };
  if (png.length > MAX_BYTES) return { erro: 'a imagem passa de 25 MB' };
  try {
    fs.mkdirSync(pasta, { recursive: true });
    let alvo = path.join(pasta, nomeNovo(agora));
    while (fs.existsSync(alvo)) alvo = path.join(pasta, nomeNovo(agora));
    fs.writeFileSync(alvo, png);
    return { caminho: alvo };
  } catch (err) {
    return { erro: `não consegui salvar a imagem: ${err.message}` };
  }
}

// Uma vez por arranque, como a das telas. So `.png` e so dentro da pasta: nada
// que a pessoa tenha posto ali a mao com outro nome some.
function podar({ pasta = PASTA, dias = DIAS_PODA, agora = Date.now() } = {}) {
  const limite = agora - dias * 86_400_000;
  let apagados = 0;
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch { return { apagados }; }
  for (const n of nomes) {
    if (!n.toLowerCase().endsWith('.png')) continue;
    const alvo = path.join(pasta, n);
    try {
      if (fs.statSync(alvo).mtimeMs < limite) {
        fs.rmSync(alvo, { force: true });
        apagados += 1;
      }
    } catch { /* segue */ }
  }
  return { apagados };
}

module.exports = { PASTA, MAX_BYTES, DIAS_PODA, nomeNovo, salvar, podar };
