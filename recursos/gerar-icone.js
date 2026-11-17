'use strict';

// Gera recursos/icone.ico, icone.png e icone.icns sem nenhuma dependencia:
// monta o PNG a mao (chunks + zlib, ambos do proprio Node) e embrulha nos dois
// containers, ICO para o Windows e ICNS para o macOS.
//
// O ICO aceita PNG embutido em vez de bitmap cru desde o Windows Vista, e o
// ICNS aceita PNG nos tipos `ic08`/`ic09` desde o Mac OS X 10.5. Por isso da
// para fazer tudo aqui sem ImageMagick, sem `iconutil` (que so existe no Mac) e
// sem biblioteca grafica -- o mesmo comando roda nos dois sistemas.
//
// O tamanho e PARAMETRO, e nao mais uma constante de modulo: o macOS usa 512 no
// Dock e no Finder, e um 256 esticado ali aparece borrado. Todas as medidas do
// desenho sao multiplicadas pela escala, entao 256 continua saindo exatamente
// como saia antes.
//
// Uso: node recursos/gerar-icone.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// O desenho e o icone "C" do redesign premium: tres janelas de terminal
// empilhadas, a da frente com o prompt verde e a bolinha ambar de "esperando
// voce". Coordenadas num quadrado de 200 unidades, levadas a N pixels.
//
// Abaixo de 64px as tres janelas viram mingau, entao existe uma VARIANTE
// SIMPLIFICADA (uma janela so, traco grosso) -- e o ICO passa a carregar as
// duas: o Windows escolhe a entrada do tamanho que vai desenhar (16 na barra de
// titulo, 32 na barra de tarefas, 48 no Explorer) em vez de reduzir o 256.
//
// Agora com anti-aliasing: cada pixel e amostrado 4x4 vezes e as formas sao
// funcoes de distancia (SDF). Sem isso as bordas arredondadas saiam serrilhadas.

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// --- funcoes de distancia: negativo = dentro
function dRet(px, py, x, y, w, h, r) {
  const dx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const dy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
function dSeg(px, py, ax, ay, bx, by, larg) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) - larg / 2;
}
const dCirc = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

// Uma camada: { d(px,py) -> distancia, cor(px,py) -> [r,g,b], a }.
const solida = (c) => () => hex(c);
function janela(x, y, w, h, r, fundo, borda, traco) {
  return [
    { d: (px, py) => dRet(px, py, x, y, w, h, r), cor: solida(fundo), a: 1 },
    { d: (px, py) => Math.abs(dRet(px, py, x, y, w, h, r)) - traco / 2, cor: solida(borda), a: 1 },
  ];
}
function gradienteV(y0, y1, c0, c1) {
  const a = hex(c0), b = hex(c1);
  return (px, py) => {
    const t = Math.max(0, Math.min(1, (py - y0) / (y1 - y0)));
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  };
}

const CAMADAS_COMPLETO = [
  { d: (x, y) => dRet(x, y, 8, 8, 184, 184, 44), cor: gradienteV(8, 192, '#1f262f', '#0b0d10'), a: 1 },
  { d: (x, y) => Math.abs(dRet(x, y, 8.5, 8.5, 183, 183, 43.5)) - 0.5, cor: solida('#ffffff'), a: 0.08 },
  ...janela(58, 40, 104, 76, 14, '#151a20', '#2b323c', 2.5),
  ...janela(48, 58, 104, 76, 14, '#181d24', '#323a45', 2.5),
  ...janela(38, 78, 112, 84, 15, '#0b0e12', '#3d4652', 2.5),
  { d: (x, y) => dCirc(x, y, 138, 72, 5), cor: solida('#3ddc97'), a: 1 },
  { d: (x, y) => dCirc(x, y, 148, 54, 5), cor: solida('#7aa2f7'), a: 1 },
  { d: (x, y) => dCirc(x, y, 55, 95, 6), cor: solida('#ffb454'), a: 1 },
  { d: (x, y) => Math.min(dSeg(x, y, 58, 122, 72, 134, 8), dSeg(x, y, 72, 134, 58, 146, 8)), cor: solida('#3ddc97'), a: 1 },
  { d: (x, y) => dSeg(x, y, 84, 146, 118, 146, 8), cor: solida('#c8d3e0'), a: 1 },
];

const CAMADAS_SIMPLES = [
  { d: (x, y) => dRet(x, y, 4, 4, 192, 192, 44), cor: solida('#171c22'), a: 1 },
  { d: (x, y) => dRet(x, y, 62, 34, 104, 70, 14), cor: solida('#262d36'), a: 1 },
  ...janela(34, 64, 132, 102, 18, '#0b0e12', '#3d4652', 8),
  { d: (x, y) => Math.min(dSeg(x, y, 62, 98, 82, 116, 14), dSeg(x, y, 82, 116, 62, 134, 14)), cor: solida('#3ddc97'), a: 1 },
  { d: (x, y) => dSeg(x, y, 96, 136, 126, 136, 14), cor: solida('#c8d3e0'), a: 1 },
  { d: (x, y) => dCirc(x, y, 142, 88, 11), cor: solida('#ffb454'), a: 1 },
];

// ---------------------------------------------------------------- desenho

// Devolve a tela RGBA (4 bytes por pixel) de um icone NxN.
function desenharEm(N) {
  const camadas = N < 64 ? CAMADAS_SIMPLES : CAMADAS_COMPLETO;
  const tela = Buffer.alloc(N * N * 4);
  const k = 200 / N;
  const S = 4;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) * k;
          const y = (py + (sy + 0.5) / S) * k;
          // Composicao "over" em premultiplicado, de tras para frente.
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const c of camadas) {
            if (c.d(x, y) > 0) continue;
            const [lr, lg, lb] = c.cor(x, y);
            cr = lr * c.a + cr * (1 - c.a);
            cg = lg * c.a + cg * (1 - c.a);
            cb = lb * c.a + cb * (1 - c.a);
            ca = c.a + ca * (1 - c.a);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = S * S;
      const i = (py * N + px) * 4;
      const alfa = a / n;
      // De premultiplicado para direto, que e o que o PNG guarda.
      tela[i] = alfa ? Math.round(r / n / alfa) : 0;
      tela[i + 1] = alfa ? Math.round(g / n / alfa) : 0;
      tela[i + 2] = alfa ? Math.round(b / n / alfa) : 0;
      tela[i + 3] = Math.round(alfa * 255);
    }
  }
  return tela;
}

// ------------------------------------------------------------------ PNG

function crc32(buf) {
  let c;
  const tabela = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabela[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

function montarPng(tela, N) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8;  // 8 bits por canal
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro padrao
  ihdr[12] = 0; // sem entrelacamento

  // Cada linha do PNG comeca com o byte de filtro (0 = nenhum).
  const bruto = Buffer.alloc(N * (1 + N * 4));
  for (let y = 0; y < N; y++) {
    const destino = y * (1 + N * 4);
    bruto[destino] = 0;
    tela.copy(bruto, destino + 1, y * N * 4, (y + 1) * N * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ ICO

// Varias entradas PNG num ICO so: [[tamanho, png], ...]. Largura e altura 0
// no diretorio significam 256.
function montarIco(entradas) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // tipo 1 = icone
  cabecalho.writeUInt16LE(entradas.length, 4);

  let offset = 6 + 16 * entradas.length;
  const diretorio = entradas.map(([n, png]) => {
    const e = Buffer.alloc(16);
    e[0] = n >= 256 ? 0 : n;
    e[1] = n >= 256 ? 0 : n;
    e[2] = 0; // sem paleta
    e[3] = 0; // reservado
    e.writeUInt16LE(1, 4);  // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([cabecalho, ...diretorio, ...entradas.map(([, png]) => png)]);
}

// ----------------------------------------------------------------- ICNS

// Container ICNS: cabecalho `icns` + tamanho total, e depois um bloco por
// imagem (tipo de 4 letras + tamanho + dados). O tamanho de cada bloco INCLUI
// os proprios 8 bytes de cabecalho, e o do arquivo inclui os 8 dele -- errar
// isso produz um arquivo que o Finder abre e o electron-builder rejeita.
//
// `ic08` e 256x256 e `ic09` e 512x512, os dois em PNG. O 512 e o que o Dock e o
// Finder usam de verdade em tela Retina.
function montarIcns(entradas) {
  const blocos = entradas.map(([tipo, png]) => {
    const cabecalho = Buffer.alloc(8);
    cabecalho.write(tipo, 0, 4, 'ascii');
    cabecalho.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([cabecalho, png]);
  });

  const corpo = Buffer.concat(blocos);
  const cabecalho = Buffer.alloc(8);
  cabecalho.write('icns', 0, 4, 'ascii');
  cabecalho.writeUInt32BE(corpo.length + 8, 4);
  return Buffer.concat([cabecalho, corpo]);
}

// ------------------------------------------------------------------ saida

const png = (n) => montarPng(desenharEm(n), n);
const png256 = png(256);
const png512 = png(512);

const ico = montarIco([16, 24, 32, 48, 64, 128].map((n) => [n, png(n)]).concat([[256, png256]]));
const icns = montarIcns([['ic08', png256], ['ic09', png512]]);

fs.writeFileSync(path.join(__dirname, 'icone.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icone.png'), png256);
fs.writeFileSync(path.join(__dirname, 'icone.icns'), icns);

console.log(`icone.ico  ${ico.length} bytes (16 a 256; abaixo de 64 a variante simplificada)`);
console.log(`icone.icns ${icns.length} bytes (256 + 512)`);
