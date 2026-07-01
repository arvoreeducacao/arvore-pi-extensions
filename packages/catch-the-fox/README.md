# 🦊 catch-the-fox

Extensão do PI que mostra uma **raposa em pixel-art animada** (half-block truecolor) acima do editor. A raposa muda de humor conforme o que o agente está fazendo — farejando, cavando, correndo, pulando de alegria, ou dormindo enquanto espera você.

> Requer terminal com **truecolor** (Warp ✓, iTerm2 ✓, kitty ✓, ghostty ✓).

## Estados

| Estado | Quando | Visual |
|--------|--------|--------|
| `sleep` | ocioso (turno terminou) | raposa dormindo, `zzz` cinza |
| `sniff` | `read`, `grep`, `find`, `search`, `list` | raposa farejando, rastro cinza |
| `dig` | `edit`, `write`, `patch`, `replace` | raposa cavando, terra saindo |
| `run` | `bash`, `shell`, `fetch`, `web`, `curl` | raposa correndo, poeira atrás |
| `jump` | fim do turno (sucesso) | raposa pulando com brilhos amarelos |
| `caught` | após o pulo | raposa comemorando, 1.6s → volta pra `sleep` |
| `error` | uma tool retornou erro | flash vermelho, 1.2s |
| `sad` | 3+ erros seguidos no turno | orelhas caídas, olhos azuis tristes |

A animação roda quadro a quadro via `setInterval` no intervalo próprio de cada estado (de 140ms no `run` a 700ms no `sleep`), e o widget é atualizado com `ctx.ui.requestRender`.

## Como funciona

Widget persistente (`ctx.ui.setWidget`, array de linhas ANSI) dirigido pelos hooks de lifecycle:

- `session_start` → `sleep`
- `agent_start` → `sniff` (zera o contador de erros)
- `tool_execution_start` → estado derivado de `event.toolName`
- `tool_result` → incrementa `errorStreak` em `event.isError` (`error`, ou `sad` a partir de 3)
- `agent_end` → `jump` → `caught` → `sleep` (ou `sad` se a maré foi ruim)
- `session_shutdown` → limpa os timers

Cada sprite é uma grade de pixels (`grids`) com uma letra por cor da `PALETTE`. O renderer `gridToAnsi` junta 2 linhas de pixels em 1 linha de texto usando half-blocks (`▀` com cor de frente = pixel de cima, cor de fundo = pixel de baixo), dobrando a resolução vertical.

## Comandos

- `/fox` — lista os estados
- `/fox <estado>` — força um estado (`sleep`, `sniff`, `dig`, `run`, `jump`, `caught`, `error`, `sad`)
- `/fox hide` — esconde a raposa
- `/fox show` — traz de volta

## Preview

Para ver a animação colorida no seu terminal (sem instalar):

```bash
node preview.mjs
```

Passa por todos os estados, cada um animando por alguns ciclos.

## Desenvolvimento

```bash
pnpm install
pnpm build   # tsc → dist/
pnpm dev     # tsc --watch
```
