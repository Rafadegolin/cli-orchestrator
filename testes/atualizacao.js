'use strict';
// Ciclo real de atualizacao: sobe o app EMPACOTADO (versao antiga) e confere
// que ele enxerga a release publicada no GitHub, comeca a baixar sozinho e
// mostra o aviso na lateral.
//
// Nao da para testar isso com mock: o valor esta justamente em provar que o
// latest.yml publicado e legivel e que o updater o encontra.
//
// Uso: npm run empacotar numa versao MENOR que a publicada, depois este teste.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { conectar, checar, encerrar, esperar } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const EXE = path.join(RAIZ, 'dist', 'win-unpacked', 'Orquestrador.exe');
const UDATA = path.join(RAIZ, '.dev-udata', 'atualizacao');

function matarApp() {
  try {
    execSync('powershell -NoProfile -Command "Get-Process Orquestrador -ErrorAction SilentlyContinue | Stop-Process -Force"');
  } catch { /* nao havia nenhuma */ }
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error(`nao achei ${EXE}\nrode antes: npm run empacotar`);
    process.exit(2);
  }

  matarApp();
  await esperar(1200);
  fs.mkdirSync(UDATA, { recursive: true });

  const app = spawn(EXE, ['--remote-debugging-port=9222', `--user-data-dir=${UDATA}`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ORQ_DADOS: path.join(UDATA, 'dados') },
  });
  app.unref();

  const cdp = await conectar();

  const versaoLocal = await cdp.avaliar(`window.orq.versao()`);
  console.log(`versao instalada localmente: ${versaoLocal}`);

  // Qual e a versao publicada agora?
  const remoto = await fetch('https://api.github.com/repos/Rafadegolin/cli-orchestrator/releases/latest')
    .then((r) => r.json()).catch(() => null);
  const versaoRemota = (remoto?.tag_name || '').replace(/^v/, '');
  console.log(`versao publicada no GitHub: ${versaoRemota}`);

  checar('a versao publicada e mais nova que a local',
    versaoRemota && versaoRemota !== versaoLocal, `${versaoLocal} -> ${versaoRemota}`);

  checar('updater ativo',
    JSON.parse(await cdp.avaliar(`(async () => JSON.stringify(await window.orq.atualizacaoSituacao()))()`)).ativo === true);

  // Nao espera os 10s do arranque: dispara a checagem na hora.
  await cdp.avaliar(`window.orq.atualizacaoVerificar()`);

  let s = null;
  for (let i = 0; i < 40; i++) {
    await esperar(1500);
    s = JSON.parse(await cdp.avaliar(`(async () => JSON.stringify(await window.orq.atualizacaoSituacao()))()`));
    if (s.disponivel) break;
  }
  checar('o app detectou a versao nova lendo o latest.yml publicado',
    s?.disponivel === versaoRemota, JSON.stringify(s));

  // O botao tem de aparecer sozinho, sem interromper o trabalho com dialogo.
  const botao = JSON.parse(await cdp.avaliar(`(() => { const b = document.getElementById('btn-atualizar');
    return JSON.stringify({ escondido: b.hidden, texto: b.textContent, desabilitado: b.disabled }); })()`));
  checar('o aviso apareceu na lateral', botao.escondido === false, JSON.stringify(botao));
  checar('o aviso cita a versao nova', botao.texto.includes(versaoRemota), botao.texto);

  // Acompanha o download (sao ~100 MB; nao espera terminar para dar o veredito).
  console.log('acompanhando o download em segundo plano...');
  let baixou = false;
  for (let i = 0; i < 80; i++) {
    await esperar(3000);
    s = JSON.parse(await cdp.avaliar(`(async () => JSON.stringify(await window.orq.atualizacaoSituacao()))()`));
    if (i % 5 === 0) console.log(`   ${s.percentual}%`);
    if (s.baixada) { baixou = true; break; }
  }

  checar('o download comecou sozinho', (s?.percentual || 0) > 0 || baixou, `${s?.percentual}%`);

  if (baixou) {
    const pronto = JSON.parse(await cdp.avaliar(`(() => { const b = document.getElementById('btn-atualizar');
      return JSON.stringify({ texto: b.textContent, classe: b.className, desabilitado: b.disabled }); })()`));
    checar('terminado o download, o botao fica clicavel',
      pronto.desabilitado === false && pronto.classe.includes('atualizar-pronta'), JSON.stringify(pronto));
    checar('o botao convida a reiniciar', /reiniciar/i.test(pronto.texto), pronto.texto);
  } else {
    console.log('AVISO: o download nao terminou no tempo do teste; a deteccao e o inicio foram verificados');
  }

  matarApp();
  encerrar('ATUALIZACAO');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
