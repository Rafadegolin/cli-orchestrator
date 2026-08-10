'use strict';

// Gera recursos/icone.ico sem nenhuma dependencia: monta um PNG 256x256 a mao
// (chunks + zlib, ambos do proprio Node) e embrulha num container ICO.
//
// O ICO aceita PNG embutido em vez de bitmap cru desde o Windows Vista, e o
// electron-builder so exige que exista um tamanho >= 256. Por isso da para
// fazer tudo aqui sem ImageMagick nem biblioteca grafica.
//
// O desenho e a propria ideia do app: quatro painéis numa grade, cada um com a
// bolinha de status no cabecalho.
//
// Uso: node recursos/gerar-icone.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256;

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

// RGBA, 4 bytes por pixel.
const tela = Buffer.alloc(N * N * 4);

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

function desenhar() {
  // Fundo com canto arredondado, no tom do app.
  retanguloRedondo(0, 0, N, N, 44, COR.fundo);

  const margem = 26;
  const vao = 12;
  const larg = Math.floor((N - margem * 2 - vao) / 2);
  const alt = larg;
  const topo = Math.floor((N - (alt * 2 + vao)) / 2);

  const status = [COR.esperando, COR.rodando, COR.terminou, COR.parado];

  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const lin = Math.floor(i / 2);
    const x = margem + col * (larg + vao);
    const y = topo + lin * (alt + vao);

    retanguloRedondo(x, y, larg, alt, 10, COR.borda);
    retanguloRedondo(x + 2, y + 2, larg - 4, alt - 4, 9, COR.painel);

    // Cabecalho do painel com a bolinha de status.
    retanguloRedondo(x + 2, y + 2, larg - 4, 22, 9, COR.cabecalho);
    retangulo(x + 2, y + 16, larg - 4, 8, COR.cabecalho);
    circulo(x + 15, y + 13, 5, status[i]);

    // Linhas de "texto" no corpo, sugerindo saida de terminal.
    const larguras = [0.62, 0.44, 0.74, 0.36];
    for (let l = 0; l < 4; l++) {
      const ly = y + 36 + l * 13;
      if (ly + 5 > y + alt - 8) break;
      retangulo(x + 12, ly, Math.floor((larg - 24) * larguras[l]), 5, COR.texto);
    }
  }
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

function montarPng() {
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

desenhar();
const png = montarPng();
const ico = montarIco(png);

const saida = path.join(__dirname, 'icone.ico');
fs.writeFileSync(saida, ico);
fs.writeFileSync(path.join(__dirname, 'icone.png'), png);

console.log(`icone.ico gerado: ${ico.length} bytes (PNG interno ${png.length} bytes, ${N}x${N})`);
