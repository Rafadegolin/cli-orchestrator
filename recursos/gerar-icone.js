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
// O desenho e a propria ideia do app: quatro painéis numa grade, cada um com a
// bolinha de status no cabecalho.
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

const COR = {
  fundo: [0x14, 0x16, 0x1a],
  painel: [0x1b, 0x1e, 0x24],
  borda: [0x2c, 0x31, 0x3a],
  cabecalho: [0x22, 0x26, 0x2e],
  esperando: [0xe5, 0xc0, 0x7b],
  rodando: [0x98, 0xc3, 0x79],
  terminou: [0x61, 0xaf, 0xef],
  parado: [0x6b, 0x72, 0x80],
  texto: [0x3a, 0x41, 0x4d],
};

// ---------------------------------------------------------------- desenho

// Devolve a tela RGBA (4 bytes por pixel) de um icone NxN.
function desenharEm(N) {
  const tela = Buffer.alloc(N * N * 4);
  // Todas as medidas abaixo foram escolhidas para 256; `k` as leva para
  // qualquer tamanho sem mexer no desenho.
  const k = N / 256;
  const m = (v) => Math.round(v * k);

  function pintar(x, y, cor, alfa = 255) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    tela[i] = cor[0];
    tela[i + 1] = cor[1];
    tela[i + 2] = cor[2];
    tela[i + 3] = alfa;
  }

  function retangulo(x0, y0, w, h, cor) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) pintar(x, y, cor);
    }
  }

  // Cantos arredondados: fora do raio nos quatro cantos, nao pinta.
  function retanguloRedondo(x0, y0, w, h, r, cor) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.min(x - x0, x0 + w - 1 - x);
        const dy = Math.min(y - y0, y0 + h - 1 - y);
        if (dx < r && dy < r) {
          const d = Math.hypot(r - dx, r - dy);
          if (d > r) continue;
        }
        pintar(x, y, cor);
      }
    }
  }

  function circulo(cx, cy, r, cor) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) <= r) pintar(x, y, cor);
      }
    }
  }

  // Fundo com canto arredondado, no tom do app.
  retanguloRedondo(0, 0, N, N, m(44), COR.fundo);

  const margem = m(26);
  const vao = m(12);
  const larg = Math.floor((N - margem * 2 - vao) / 2);
  const alt = larg;
  const topo = Math.floor((N - (alt * 2 + vao)) / 2);

  const status = [COR.esperando, COR.rodando, COR.terminou, COR.parado];

  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const lin = Math.floor(i / 2);
    const x = margem + col * (larg + vao);
    const y = topo + lin * (alt + vao);

    retanguloRedondo(x, y, larg, alt, m(10), COR.borda);
    retanguloRedondo(x + m(2), y + m(2), larg - m(4), alt - m(4), m(9), COR.painel);

    // Cabecalho do painel com a bolinha de status.
    retanguloRedondo(x + m(2), y + m(2), larg - m(4), m(22), m(9), COR.cabecalho);
    retangulo(x + m(2), y + m(16), larg - m(4), m(8), COR.cabecalho);
    circulo(x + m(15), y + m(13), m(5), status[i]);

    // Linhas de "texto" no corpo, sugerindo saida de terminal.
    const larguras = [0.62, 0.44, 0.74, 0.36];
    for (let l = 0; l < 4; l++) {
      const ly = y + m(36) + l * m(13);
      if (ly + m(5) > y + alt - m(8)) break;
      retangulo(x + m(12), ly, Math.floor((larg - m(24)) * larguras[l]), m(5), COR.texto);
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

function montarIco(png) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // tipo 1 = icone
  cabecalho.writeUInt16LE(1, 4); // uma imagem

  const entrada = Buffer.alloc(16);
  entrada[0] = 0; // largura 0 significa 256
  entrada[1] = 0; // altura 0 significa 256
  entrada[2] = 0; // sem paleta
  entrada[3] = 0; // reservado
  entrada.writeUInt16LE(1, 4);  // planos
  entrada.writeUInt16LE(32, 6); // bits por pixel
  entrada.writeUInt32BE(0, 8);
  entrada.writeUInt32LE(png.length, 8);
  entrada.writeUInt32LE(6 + 16, 12); // offset dos dados

  return Buffer.concat([cabecalho, entrada, png]);
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

const png256 = montarPng(desenharEm(256), 256);
const png512 = montarPng(desenharEm(512), 512);

const ico = montarIco(png256);
const icns = montarIcns([['ic08', png256], ['ic09', png512]]);

fs.writeFileSync(path.join(__dirname, 'icone.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icone.png'), png256);
fs.writeFileSync(path.join(__dirname, 'icone.icns'), icns);

console.log(`icone.ico  ${ico.length} bytes (PNG 256x256 de ${png256.length})`);
console.log(`icone.icns ${icns.length} bytes (256 + 512)`);
