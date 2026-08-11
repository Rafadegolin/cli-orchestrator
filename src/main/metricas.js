'use strict';

// O medidor de CPU do placar da lateral.
//
// Tres cuidados, todos por causa da meta de consumo parado (0,06-0,1% com oito
// painéis -- um medidor mal feito sozinho comeria isso):
//
//  1. So mede com a JANELA VISIVEL. Minimizado ou escondido, ninguem esta
//     olhando o placar e nao ha por que acordar a CPU de 2 em 2 segundos.
//  2. So EMITE quando o numero arredondado muda. Mandar o mesmo valor a cada
//     tique faria a lateral re-renderizar a toa.
//  3. `getAppMetrics()` percorre os processos do app; 2s e devagar o bastante
//     para o custo sumir e rapido o bastante para o placar parecer vivo.

const { app } = require('electron');
const os = require('os');

const MS_INTERVALO = 2000;

const NUCLEOS = Math.max(1, os.cpus().length);

let janela = null;
let timer = null;
let ultimo = -1;

// percentCPUUsage e por processo e relativo a UM nucleo -- somar os processos
// de um app pesado passa de 100 facilmente. Dividir pelos nucleos devolve a
// porcentagem DA MAQUINA, que e o vocabulario usado em todas as medidas deste
// projeto (13,3% sob carga, e nao 160% de um nucleo).
function medir() {
  let soma = 0;
  try {
    for (const p of app.getAppMetrics()) soma += p.cpu?.percentCPUUsage || 0;
  } catch {
    return null;
  }
  return Math.min(100, Math.round(soma / NUCLEOS));
}

function tique() {
  if (!janela || janela.isDestroyed() || !janela.isVisible() || janela.isMinimized()) return;

  const cpu = medir();
  if (cpu === null || cpu === ultimo) return;
  ultimo = cpu;

  if (!janela.webContents.isDestroyed()) {
    janela.webContents.send('app:metricas', { cpu, nucleos: NUCLEOS });
  }
}

function iniciar(j) {
  janela = j;
  parar();
  timer = setInterval(tique, MS_INTERVALO);
  // A primeira leitura do Electron e sempre 0 (nao ha intervalo anterior para
  // comparar), entao o placar so ganha valor util no segundo tique.
  tique();
}

function parar() {
  clearInterval(timer);
  timer = null;
  ultimo = -1;
}

function agora() {
  return { cpu: medir() ?? 0, nucleos: NUCLEOS };
}

module.exports = { iniciar, parar, agora, MS_INTERVALO, NUCLEOS };
