'use strict';
// Fechar um painel tem de matar a arvore inteira, nao so o shell.
//
// O caso real: um painel roda `claude`, que roda `npm run dev`. Se so o shell
// morrer, o servidor fica girando orfao segurando a porta -- e o proximo
// worktree nao sobe.

const path = require('path');
const { execSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');
const cmd = require('./comandos');
const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

// Conta ping.exe vivos. Nao adianta marcar pela linha de comando: o proprio
// powershell que faz a contagem carrega a marca no comando dele e se conta.
function contaPings() {
  return Number(execSync(
    'powershell -NoProfile -Command "(Get-Process ping -ErrorAction SilentlyContinue | Measure-Object).Count"',
    { encoding: 'utf8' }
  ).trim()) || 0;
}

function limparPings() {
  try {
    execSync('powershell -NoProfile -Command "Get-Process ping -ErrorAction SilentlyContinue | Stop-Process -Force"');
  } catch { /* nada a limpar */ }
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  limparPings();
  checar('nenhum ping sobrando antes de comecar', contaPings() === 0, String(contaPings()));

  const id = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'arvore' }); return p.id; })()`);
  await esperar(2000);

  // DESTACADO de proposito, que e o caso dificil: o ConPTY, ao fechar, ja
  // derruba os processos anexados ao console, mas um servidor solto -- o
  // `npm run dev` de dentro de uma sessao -- sobrevive e fica segurando a
  // porta. A escrita muda por shell (`start "" /b` no Windows, `&` fora dele) e
  // sai do `comandos.js`; as aspas vazias do `start` sao obrigatorias, senao
  // ele consome o primeiro argumento entre aspas como titulo da janela.
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '${cmd.filhoLongo()}\\r')`);
  await esperar(3500);

  const antes = contaPings();
  checar('o processo filho nasceu', antes >= 1, String(antes));

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).destruir()`);
  await esperar(3500);

  const depois = contaPings();
  checar('fechar o painel matou a arvore junto', depois === 0, `${antes} -> ${depois}`);

  // Limpeza defensiva se o teste falhou, para nao deixar lixo na maquina.
  if (depois > 0) limparPings();

  encerrar('ARVORE');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
