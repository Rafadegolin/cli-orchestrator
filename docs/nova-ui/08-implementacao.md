# 08 — Guia de implementação

## Modelo de dados

```ts
type Status = 'running' | 'waiting' | 'idle' | 'suspended';

interface Session {
  id: string;
  name: string;          // slug da feature; vira nome de branch
  project: string;       // nome do projeto dono
  port: string;          // ':3100'
  status: Status;
  waitMin: number;       // minutos desde que entrou em waiting (0 fora dele)
  ask: string;           // pergunta pendente; '' quando não há
  link: string;          // nome da sessão de origem; '' quando não ligada
  lines: TermLine[];     // buffer do terminal
}

interface TermLine { text: string; tone: 'cmd' | 'out' | 'dim' | 'warn' | 'info'; }

interface Project {
  id: string;
  name: string;
  hasGit: boolean;
  tint: string;          // cor de identidade
  portRange: [number, number];
  worktrees: { branch: string; port: string }[];
}

interface UIState {
  theme: 'dark' | 'light';
  density: 1 | 2 | 3;
  sort: 'urgencia' | 'projeto';
  hooks: boolean;
  focused: string | null;   // session id
  feature: string;          // campo da toolbar
}
```

`theme`, `density`, `sort` e `hooks` devem persistir entre execuções.

## Regras derivadas (não guarde em estado)

```ts
const RANK = { waiting: 0, running: 1, idle: 2, suspended: 3 };

// ordem da grade
sessions.sort((a, b) =>
  sort === 'urgencia'
    ? (RANK[a.status] - RANK[b.status]) || (b.waitMin - a.waitMin)
    : a.project.localeCompare(b.project) || a.name.localeCompare(b.name));

// fila de atenção
const queue = sessions.filter(s => s.status === 'waiting')
                      .sort((a, b) => b.waitMin - a.waitMin);

// alvo do Ctrl+Enter
const next = queue[0];

// slug de feature
const slug = feature.trim().replace(/\s+/g, '-').toLowerCase();
```

`waitMin` deve ser recalculado a partir de um timestamp (`waitingSince`), não incrementado
por timer, para sobreviver a suspensão da máquina.

## Contratos com o backend

| Evento / chamada | Efeito na UI |
|---|---|
| hook `stop` / pergunta pendente | `status = waiting`, grava `ask` e `waitingSince` |
| hook `resume` / início de turno | `status = running`, limpa `ask` |
| hook de fim de tarefa | `status = idle` |
| `createSession(project, feature)` | Cria worktree, aloca porta da faixa, sobe o Claude, devolve `Session` |
| `resumeSession(id)` | `suspended → running` |
| `closePanel(id)` | Encerra processo e remove da lista (worktree permanece) |
| `linkSessions(from, to)` | Encaminha a saída de `from` como contexto de `to` |
| stream do PTY | Anexa `TermLine` ao buffer da sessão |

## Ordem sugerida de entrega

1. **Tokens e tema** — variáveis CSS, alternador claro/escuro, fontes. Base de todo o resto.
2. **Shell** — barra de título, sidebar, toolbar, grade com densidade.
3. **Painel de sessão** — cabeçalho com regras de compressão, terminal, foco.
4. **Status e fila de atenção** — ordenação por urgência, Ctrl+Enter, rótulos textuais.
5. **Barra de aprovação inline** — a maior mudança de comportamento; exige o canal de escrita
   no PTY.
6. **Sessões salvas** — estado Retomar e Retomar todas.
7. **Modais** — cadastro de projeto e ajuda seccionada.
8. **Paleta de comandos** — depende das ações dos passos anteriores.
9. **Vazios, toasts e polimento** — animações, `prefers-reduced-motion`.

## Checklist de aceite

- [ ] Nenhum scroll horizontal em qualquer largura ≥ 924px.
- [ ] Nome da sessão sempre legível por inteiro; botão fechar sempre clicável.
- [ ] Toda cor de status acompanhada de texto (exceto densidade 3, onde o cabeçalho encolhe).
- [ ] Contraste AA para texto em ambos os temas; terminal permanece escuro nos dois.
- [ ] Atalhos funcionam com foco em qualquer lugar, exceto dígitos dentro de inputs.
- [ ] Esc fecha qualquer overlay; clique fora também.
- [ ] Preferências (tema, densidade, ordenação, hooks) persistem.
- [ ] Com hooks desligados, a UI comunica que os status não vão mudar.
- [ ] `prefers-reduced-motion` desliga pulsos e cursor piscante.
