'use strict';
// A atualizacao que troca so o app.asar, provada END TO END.
//
// E a parte que da medo do projeto inteiro: um .bat troca o CODIGO do app por
// baixo dele e o reabre. Falhar no meio deixa a pessoa sem app -- e o erro
// apareceria na maquina dela, nao aqui. Entao a prova nao pode ser "a funcao
// devolveu ok": tem de ser o app REABRINDO na versao nova.
//
// Sem internet e sem release: um servidor local serve o sac.json e o asar, com
// a env ORQ_META_ATUALIZACAO reapontando a origem. Assim o que se testa e o
// caminho completo -- checar, baixar, conferir o sha256, trocar e reabrir --
// sem depender do GitHub estar no ar nem de qual versao esta publicada.
//
// O truque para ter "versao velha" e "versao nova" sem dois builds: o app do
// campo de testes recebe um asar com a versao rebaixada por dentro, e o asar de
// verdade e servido como se fosse a novidade.
//
// Uso: npm run empacotar && npm run empacotar:sac && npm run teste:atualizacao-leve

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync, execSync } = require('child_process');
const { conectar, checar, encerrar, esperar, exigirPortaLivre } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const VERSAO = require(path.join(RAIZ, 'package.json')).version;
const PACOTE = path.join(RAIZ, 'dist', `Orquestrador-${VERSAO}-sac`);
const CAMPO = path.join(os.tmpdir(), 'orq-teste-leve');
const UDATA = path.join(CAMPO, 'udata');
const EXTRAIDO = path.join(os.tmpdir(), 'orq-teste-leve-asar');
const VELHA = '0.0.1';
const PORTA = 47616;

const asarCli = path.join(RAIZ, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
const versaoDe = (m) => require(path.join(RAIZ, 'node_modules', m, 'package.json')).version;
const matar = () => {
  try {
    execSync('powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | '
      + 'Where-Object { $_.Path -like \'*orq-teste-leve*\' } | Stop-Process -Force"');
  } catch { /* nao havia */ }
};

(async () => {
  if (!fs.existsSync(path.join(PACOTE, 'electron.exe'))) {
    console.error(`nao achei ${PACOTE}\nrode antes: npm run empacotar && npm run empacotar:sac`);
    process.exit(2);
  }
  if (!fs.existsSync(asarCli)) {
    console.error('nao achei o @electron/asar (dependencia do electron-builder)');
    process.exit(2);
  }

  matar();
  await esperar(800);
  await exigirPortaLivre();

  // --- o campo de testes: uma copia do pacote, com o asar rebaixado ---------
  if (fs.existsSync(CAMPO)) fs.rmSync(CAMPO, { recursive: true, force: true });
  if (fs.existsSync(EXTRAIDO)) fs.rmSync(EXTRAIDO, { recursive: true, force: true });
  fs.cpSync(PACOTE, CAMPO, { recursive: true });

  const ASAR_REAL = path.join(PACOTE, 'resources', 'app.asar');
  execFileSync(process.execPath, [asarCli, 'extract', ASAR_REAL, EXTRAIDO]);
  const pkg = path.join(EXTRAIDO, 'package.json');
  const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  j.version = VELHA;
  fs.writeFileSync(pkg, JSON.stringify(j, null, 2));
  execFileSync(process.execPath, [asarCli, 'pack', EXTRAIDO,
    path.join(CAMPO, 'resources', 'app.asar'), '--unpack', '{**/node_modules/node-pty/**}']);

  // --- a "release", servida daqui mesmo ------------------------------------
  const bytes = fs.readFileSync(ASAR_REAL);
  const meta = {
    versao: VERSAO,
    asar: {
      url: `http://127.0.0.1:${PORTA}/app.asar`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
    runtime: { electron: versaoDe('electron'), nodePty: versaoDe('node-pty') },
  };
  const servidor = http.createServer((req, res) => {
    if (req.url.startsWith('/app.asar')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(bytes);
    } else if (req.url.startsWith('/sac.json')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(meta));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => servidor.listen(PORTA, '127.0.0.1', ok));

  // --- sobe o app velho ----------------------------------------------------
  const EXE = path.join(CAMPO, 'electron.exe');
  fs.mkdirSync(UDATA, { recursive: true });
  const subir = () => {
    const p = spawn(EXE, ['--remote-debugging-port=9222', `--user-data-dir=${UDATA}`], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ORQ_DADOS: path.join(UDATA, 'dados'),
        ORQ_META_ATUALIZACAO: `http://127.0.0.1:${PORTA}/sac.json`,
      },
    });
    p.unref();
  };

  subir();
  let cdp = await conectar();

  const situacao = async () => JSON.parse(await cdp.avaliar(
    '(async () => JSON.stringify(await window.orq.atualizacaoSituacao()))()'));

  let s = {};
  for (let i = 0; i < 40; i++) {
    s = await situacao().catch(() => ({}));
    if (s.versaoAtual) break;
    await esperar(250);
  }
  checar('o app subiu na versao rebaixada', s.versaoAtual === VELHA, String(s.versaoAtual));
  checar('e se reconhece como layout em pasta', s.portatil === true, JSON.stringify(s));

  // A primeira checagem so acontece 10s depois do arranque, de proposito: rede
  // no arranque competiria com a meta de 1,5s ate o primeiro terminal.
  for (let i = 0; i < 100; i++) {
    s = await situacao().catch(() => ({}));
    if (s.baixada) break;
    await esperar(500);
  }
  checar('a checagem achou a versao nova', s.disponivel === VERSAO, JSON.stringify(s));
  checar('e decidiu que da para trocar so o asar', s.leve === true, JSON.stringify(s));
  checar('o asar chegou e passou no sha256',
    s.baixada === true && fs.existsSync(path.join(CAMPO, 'resources', 'app.asar.novo')),
    JSON.stringify(s));

  // --- a troca -------------------------------------------------------------
  //
  // O app que VOLTA nao pode ser observado pelo CDP, e isso e artefato do
  // teste, nao defeito do produto: ele reabre cerca de um segundo depois de o
  // anterior morrer, e nesse instante o socket da porta 9222 ainda esta preso
  // pelo processo que acabou de sair -- o Chromium nao consegue bindar e sobe
  // sem depuracao. Em uso real ninguem passa porta de depuracao.
  //
  // Entao a prova de que ele voltou VIVO e por fatos que nao dependem do
  // depurador: o atalho no menu Iniciar e recriado pelo nosso codigo no
  // arranque (atalho.garantir), entao ele reaparecendo prova que o processo
  // novo executou o nosso main -- lido do asar que acabou de ser trocado.
  const LNK = path.join(process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Orquestrador.lnk');
  const lnkAntes = fs.existsSync(LNK);
  if (lnkAntes) fs.rmSync(LNK);

  // `confirmar: false` pela mesma razao de sempre: o CDP nao dirige dialogo
  // nativo. O caminho executado e o mesmo do botao.
  await cdp.avaliar('window.orq.atualizacaoAplicar({ confirmar: false })').catch(() => {});

  // Espera pela CONDICAO: o .bat so troca depois que o Windows solta o arquivo,
  // e isso nao tem tempo fixo.
  const vivo = () => Number(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process '
    + '-Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.ExecutablePath -like '
    + `'*orq-teste-leve*' } | Measure-Object).Count"`, { encoding: 'utf8' }).trim()) || 0;

  let voltou = false;
  for (let i = 0; i < 60; i++) {
    await esperar(1000);
    if (vivo() > 0 && fs.existsSync(LNK)) { voltou = true; break; }
  }

  const log = path.join(CAMPO, 'resources', 'troca.log');
  if (!voltou && fs.existsSync(log)) console.log(`--- troca.log ---\n${fs.readFileSync(log, 'utf8')}`);
  else if (!voltou) console.log('--- o script de troca nem chegou a rodar (sem troca.log) ---');

  checar('o app reabriu sozinho depois da troca', voltou, `${vivo()} processos`);
  // O atalho so reaparece porque o main do app RODOU -- e o main que voltou e o
  // do asar recem-trocado.
  checar('e quem voltou executou o nosso codigo, do asar novo', fs.existsSync(LNK), LNK);

  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  checar('o app.asar em uso e o da versao nova',
    fs.existsSync(path.join(CAMPO, 'resources', 'app.asar'))
    && sha(path.join(CAMPO, 'resources', 'app.asar')) === meta.asar.sha256,
    meta.asar.sha256.slice(0, 12));
  // O .bat nunca apaga o antigo antes de ter o novo no lugar: o pior caso e
  // continuar na versao velha, nunca ficar sem app.
  checar('e o antigo ficou guardado como .bak',
    fs.existsSync(path.join(CAMPO, 'resources', 'app.asar.bak')), 'app.asar.bak');
  checar('com o .novo fora do caminho',
    !fs.existsSync(path.join(CAMPO, 'resources', 'app.asar.novo')), '');

  // Devolve o menu Iniciar ao que era: o atalho que sobrou aponta para uma
  // pasta temporaria que esta prestes a sumir.
  try { fs.rmSync(LNK); } catch { /* ja nao estava la */ }

  matar();
  await esperar(1200);
  servidor.close();
  try { fs.rmSync(CAMPO, { recursive: true, force: true }); } catch { /* fica para a proxima */ }
  try { fs.rmSync(EXTRAIDO, { recursive: true, force: true }); } catch { /* idem */ }

  encerrar('ATUALIZACAO_LEVE');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
