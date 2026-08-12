'use strict';
// Atualizar sem instalador: trocar SO o app.asar.
//
// O problema: nos layouts em pasta (o zip portatil e o pacote `-sac`) o
// electron-updater nao serve, porque aplicar significa rodar o instalador NSIS
// -- que e justamente o que o Smart App Control bloqueia. Ate agora a saida era
// mandar a pessoa baixar 142 MB e substituir a pasta na mao, a cada versao.
//
// A observacao que resolve: entre duas versoes nossas, quase sempre **so o
// app.asar muda**. O `electron.exe` e todo o runtime do Electron sao os mesmos
// de uma versao para outra; o nosso codigo tem 4 MB. Entao a atualizacao pode
// ser trocar um arquivo, e nao repor a pasta inteira.
//
// O "quase sempre" e o que este modulo leva a serio. Se o Electron ou o
// node-pty mudarem de versao, o asar novo nao casa com o runtime que esta no
// disco -- e ai NAO ha atualizacao leve: volta a ser o download completo, dito
// com todas as letras. E o que o campo `runtime` do sac.json existe para
// decidir.
//
// A troca em si nao pode ser feita por este processo: o app.asar esta mapeado
// em memoria enquanto o app roda, e o Windows recusa sobrescreve-lo. Por isso a
// ultima etapa e um .bat que espera este PID morrer, troca os arquivos e reabre
// o app -- `cmd.exe` e binario do sistema, entao o SAC nao tem nada a dizer.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net } = require('electron');

// A env reaponta a origem, como o ORQ_DADOS faz com a pasta de dados: e o que
// deixa o teste provar a troca inteira sem depender de release publicada nem de
// internet -- e testar troca de codigo contra a rede de verdade seria testar o
// GitHub, nao o app.
const URL_META = process.env.ORQ_META_ATUALIZACAO
  || 'https://github.com/Rafadegolin/cli-orchestrator/releases/latest/download/sac.json';

// Nome fixo, para o .bat nao precisar saber de versao nenhuma.
const NOVO = 'app.asar.novo';
const BACKUP = 'app.asar.bak';

function pastaRecursos() {
  // getAppPath() aponta para .../resources/app.asar
  return path.dirname(app.getAppPath());
}

function versaoNodePty() {
  try {
    return require('node-pty/package.json').version;
  } catch {
    return null;
  }
}

// Compara "0.1.21" com "0.1.9" sem tratar isso como texto -- '9' > '2' daria a
// resposta errada em toda casa de dezena.
function maiorQue(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// A pasta do app e gravavel? Extraida em C:\Ferramentas sim; em "Arquivos de
// Programas" nao, e ai a troca exigiria elevacao -- que este app nao pede.
function podeGravar() {
  try {
    const teste = path.join(pastaRecursos(), '.orq-teste-escrita');
    fs.writeFileSync(teste, 'x');
    fs.rmSync(teste);
    return true;
  } catch {
    return false;
  }
}

async function baixar(url) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// O que a release nova diz de si mesma. Devolve tambem POR QUE nao da, quando
// nao da: "atualize pelo site" sem motivo e o tipo de aviso que a pessoa
// aprende a ignorar.
async function verificar() {
  const meta = JSON.parse((await baixar(URL_META)).toString('utf8'));

  const disponivel = maiorQue(meta.versao, app.getVersion());
  const mesmoRuntime = meta.runtime?.electron === process.versions.electron
    && meta.runtime?.nodePty === versaoNodePty();

  return {
    versao: meta.versao,
    disponivel,
    // Leve = da para trocar so o asar.
    leve: disponivel && mesmoRuntime && podeGravar(),
    motivo: !disponivel ? null
      : !mesmoRuntime ? 'o Electron ou o node-pty mudaram de versao'
        : !podeGravar() ? 'a pasta do app nao e gravavel'
          : null,
    url: meta.asar?.url,
    sha256: meta.asar?.sha256,
  };
}

// Baixa e deixa PRONTO ao lado do atual, sem tocar no que esta em uso. Nada e
// trocado agora: quem decide reiniciar e o usuario.
async function preparar(info) {
  if (!info?.url || !info?.sha256) throw new Error('release sem metadados do asar');

  const bytes = await baixar(info.url);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== info.sha256) {
    throw new Error(`sha256 nao confere (esperado ${info.sha256.slice(0, 12)}, veio ${sha.slice(0, 12)})`);
  }
  // Um asar de 4 MB que chega com 200 bytes e uma pagina de erro do GitHub que
  // passou como 200. O hash ja pegaria, mas o tamanho diz melhor o que houve.
  if (bytes.length < 1024 * 1024) throw new Error(`asar pequeno demais (${bytes.length} bytes)`);

  const destino = path.join(pastaRecursos(), NOVO);
  fs.writeFileSync(destino, bytes);
  return { pronto: true, bytes: bytes.length, caminho: destino };
}

// O .bat que faz a troca depois que este processo morrer.
//
// Ele nunca apaga o asar antigo antes de ter o novo no lugar: renomeia para
// .bak, poe o novo, e se o novo nao aparecer devolve o .bak. O pior caso e
// continuar na versao velha -- nunca ficar sem app.
// Os argumentos com que ESTE processo foi aberto, prontos para a linha do
// `start`. Aspas em volta de cada um porque caminho com espaco e a regra, nao a
// excecao (`--user-data-dir=C:\Meus Dados\...`).
function argumentos() {
  const args = process.argv.slice(1).filter(Boolean);
  if (!args.length) return '';
  // Aspas dentro do argumento sao removidas em vez de escapadas: o cmd nao tem
  // um escape confiavel para isso, e nenhuma flag legitima do app precisa.
  return ` ${args.map((a) => `"${a.replace(/"/g, '')}"`).join(' ')}`;
}

function scriptDeTroca() {
  const res = pastaRecursos();
  // O log nao e enfeite: se a troca falhar, ela falha DEPOIS de o app morrer --
  // nao ha console para ver, nem quem pergunte. Este arquivo e a unica pista
  // que sobra, e fica ao lado do app.
  const log = path.join(res, 'troca.log');
  return [
    '@echo off',
    'setlocal',
    `set "RES=${res}"`,
    `set "EXE=${process.execPath}"`,
    `set "LOG=${log}"`,
    'echo [%DATE% %TIME%] troca iniciada > "%LOG%"',
    `if not exist "%RES%\\${NOVO}" (`,
    '  echo [%TIME%] sem asar novo, nada a trocar >> "%LOG%"',
    '  goto abrir',
    ')',
    `if exist "%RES%\\${BACKUP}" del /q "%RES%\\${BACKUP}"`,
    // A ESPERA E PELA CONDICAO REAL: tentar renomear ate conseguir.
    //
    // A primeira versao esperava o PID do app sumir do `tasklist`, e isso
    // dependia de casar texto numa saida traduzida pelo Windows -- alem de
    // apostar que o PID nao seria reaproveitado. O que importa de verdade nao e
    // o processo ter morrido, e sim o ARQUIVO ter sido solto: enquanto o
    // app.asar estiver mapeado em memoria, o `move` falha, e e exatamente essa
    // falha que serve de sinal.
    'set /a T=0',
    ':esperar',
    'set /a T+=1',
    'if %T% GTR 150 (',
    '  echo [%TIME%] o app nao soltou o app.asar; nada foi trocado >> "%LOG%"',
    '  goto abrir',
    ')',
    `move /y "%RES%\\app.asar" "%RES%\\${BACKUP}" >nul 2>&1`,
    'if errorlevel 1 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto esperar',
    ')',
    `move /y "%RES%\\${NOVO}" "%RES%\\app.asar" >nul 2>&1`,
    'if errorlevel 1 (',
    '  echo [%TIME%] a troca falhou; devolvendo o antigo >> "%LOG%"',
    `  move /y "%RES%\\${BACKUP}" "%RES%\\app.asar" >nul 2>&1`,
    ') else (',
    '  echo [%TIME%] troca concluida >> "%LOG%"',
    ')',
    ':abrir',
    'echo [%TIME%] reabrindo o app >> "%LOG%"',
    // Reabre COM OS MESMOS ARGUMENTOS. Numa abertura normal nao ha nenhum, mas
    // quem subiu o app com alguma flag espera continuar com ela depois de
    // atualizar -- e e o que permite testar isto de ponta a ponta, ja que a
    // suite sobe o app com a porta de depuracao.
    //
    // O par de aspas vazio depois do `start` e obrigatorio: sem ele, o cmd le a
    // primeira coisa entre aspas como TITULO DA JANELA e nao executa nada.
    `start "" "%EXE%"${argumentos()}`,
  ].join('\r\n');
}

// Dispara a troca e devolve -- quem chama e que fecha o app. O processo do cmd
// e destacado de proposito: ele precisa sobreviver a morte deste aqui.
function aplicar() {
  const bat = path.join(os.tmpdir(), `orq-troca-${process.pid}.bat`);
  fs.writeFileSync(bat, scriptDeTroca(), 'latin1');

  const p = spawn('cmd.exe', ['/c', bat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  p.unref();
  return { disparado: true, script: bat };
}

function temPreparado() {
  try { return fs.existsSync(path.join(pastaRecursos(), NOVO)); } catch { return false; }
}

module.exports = { verificar, preparar, aplicar, temPreparado, pastaRecursos, maiorQue };
