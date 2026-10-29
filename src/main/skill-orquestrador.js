'use strict';

// A skill que ensina uma sessao do Claude a usar as rotas /orq/* (Fase 10.6).
//
// Mora no ~/.claude do USUARIO (`skills/orquestrador/SKILL.md`), como os hooks:
// escopo de projeto nao sobreviveria a worktree, que e um checkout limpo. E,
// como os hooks, so e escrita depois de perguntar (o dialogo esta no index.js).
//
// O texto saiu do spike (`testes/spike-orquestracao.js`, parte B), que mediu o
// modelo seguindo-o nas duas rodadas: 3 `criar` validos, 3 `esperar`, zero rota
// inventada. Mudou o que o app de verdade exige a mais -- o `X-Orq-Id` em toda
// chamada, e o resumo do diff antes do arquivo.
//
// Nunca apaga o que nao e nosso: sem a MARCA no arquivo, instalar recusa e
// remover nao toca.

const fs = require('fs');
const path = require('path');

const claudeDados = require('./claude-dados');
const { PORTA, ENDERECO } = require('./eventos');
const orq = require('./orquestracao');

const MARCA = '<!-- orquestrador-de-clis: skill gerada pelo app; reinstalar sobrescreve -->';

function pasta() {
  return path.join(claudeDados.raiz(), 'skills', 'orquestrador');
}

function arquivo() {
  return path.join(pasta(), 'SKILL.md');
}

function texto() {
  const base = `http://${ENDERECO}:${PORTA}`;
  const id = '-H "X-Orq-Id: $ORQ_ID"';
  const json = '-H "content-type: application/json"';
  return `---
name: orquestrador
description: Despacha workers (outras sessoes do Claude Code, cada uma num painel do Orquestrador de CLIs, na propria worktree e no proprio branch) e acompanha cada um ate o fim. Use quando pedirem para dividir uma tarefa em partes independentes e entregar cada parte a um worker.
---

${MARCA}

# Orquestrador de CLIs

Esta sessao roda dentro do Orquestrador de CLIs, que atende em ${base}. Cada worker e uma
sessao nova do Claude Code, aberta num painel que a pessoa ve, numa worktree propria e
num branch que nasce do commit ATUAL desta sessao -- entao commite antes de criar
workers o que eles precisam enxergar.

Fale com o orquestrador so por \`curl\`, sempre com \`-s\` e SEMPRE com
\`${id}\` (e o que diz ao app que os workers sao seus; sem isso tudo e recusado).

## Rotas

- Criar um worker (nome curto, vira o branch \`worktree-<nome>\`; prompt de ate ${orq.MAX_PROMPT} caracteres):
  \`\`\`
  curl -s -X POST ${base}/orq/criar ${id} ${json} --data-binary @- <<'JSON'
  {"nome":"<nome-curto>","prompt":"<o que o worker deve fazer, completo e independente>"}
  JSON
  \`\`\`
  Responde \`{"worker":{"id","nome","branch","status"}}\`. Guarde o \`id\`. O worker comeca
  a trabalhar sozinho alguns segundos depois.
- Ver os seus workers: \`curl -s ${id} ${base}/orq/status\`
- Esperar um worker (long-poll, no maximo ${orq.ESPERAR_MAX_S}s por chamada):
  \`curl -s ${id} "${base}/orq/esperar?id=<id>&timeout=${orq.ESPERAR_MAX_S}"\`
  Se voltar \`"expirou": true\`, chame de novo. Pare quando \`status\` for \`terminou\`,
  \`parada\` ou \`encerrada\`.
- Mandar mais uma instrucao a um worker (ele recebe e envia):
  \`\`\`
  curl -s -X POST ${base}/orq/enviar ${id} ${json} --data-binary @- <<'JSON'
  {"id":"<id>","texto":"..."}
  JSON
  \`\`\`
- O que um worker mudou, em dois passos: primeiro a lista de arquivos
  \`curl -s ${id} "${base}/orq/diff?id=<id>"\`, depois o diff de cada arquivo que interessa
  \`curl -s ${id} "${base}/orq/diff?id=<id>&arquivo=<caminho/relativo>"\`.

## Regras

- Um worker por parte INDEPENDENTE, no maximo ${orq.MAX_FILHOS} vivos. Nao crie worker para o
  que voce faria em um passo.
- O prompt do worker tem de se bastar: ele nao ve esta conversa.
- Workers nao criam workers.
- Se o status for \`esperando\`, o worker esta pedindo permissao ou fazendo uma pergunta,
  e quem responde e a PESSOA, no painel dele. Nao tente responder por \`enviar\` (e
  recusado); avise a pessoa e espere de novo.
- Espere cada worker terminar antes de ler o diff dele, e leia o diff de verdade antes
  de dizer que ficou certo.
- Para integrar, mescle o branch do worker no seu: \`git merge <branch>\`.
- Nao invente rotas alem destas.
`;
}

function situacao() {
  let atual = '';
  try { atual = fs.readFileSync(arquivo(), 'utf8'); } catch { return { instalada: false, nossa: false, atual: false, arquivo: arquivo() }; }
  const nossa = atual.includes(MARCA);
  return { instalada: nossa, nossa, atual: nossa && atual === texto(), arquivo: arquivo(), alheia: !nossa };
}

function instalar() {
  const s = situacao();
  // Uma skill `orquestrador` escrita pela pessoa NAO e sobrescrita.
  if (s.alheia) {
    return { ok: false, texto: `ja existe uma skill propria em ${arquivo()}; renomeie-a para o app instalar a dele` };
  }
  fs.mkdirSync(pasta(), { recursive: true });
  const tmp = `${arquivo()}.tmp`;
  fs.writeFileSync(tmp, texto(), 'utf8');
  fs.renameSync(tmp, arquivo());
  return { ok: true, arquivo: arquivo() };
}

function remover() {
  const s = situacao();
  if (!s.nossa) return { ok: true, removida: false };
  fs.rmSync(arquivo(), { force: true });
  // A pasta so sai se ficou vazia: algo que a pessoa pos ali fica.
  try { fs.rmdirSync(pasta()); } catch { /* nao vazia, ou ja foi */ }
  return { ok: true, removida: true };
}

module.exports = { MARCA, arquivo, texto, situacao, instalar, remover };
