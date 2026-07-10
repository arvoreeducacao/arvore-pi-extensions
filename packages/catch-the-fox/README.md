# 🦊 catch-the-fox

Extensão do PI que mostra uma **raposa em pixel-art animada** (half-block truecolor) acima do editor. A raposa muda de pose conforme o que o agente está fazendo — farejando, cavando, correndo, pulando, celebrando ou dormindo enquanto espera você. Durante execuções, ela atravessa o terminal, derrapa junto à borda, vira e corre de volta.

Os 32 quadros usam a mesma personagem, uma grade fixa de 24 × 20 pixels e a paleta compacta da folha de referência: contorno roxo-escuro, pelagem laranja, focinho e peito brancos, sombras azul-acinzentadas e poucas cores de efeito por estado.

> Requer terminal com **truecolor** (Warp ✓, iTerm2 ✓, kitty ✓, ghostty ✓).

## Estados

| Estado | Quando | Visual |
|--------|--------|--------|
| `sleep` | ocioso (turno terminou) | raposa dormindo, `zzz` cinza |
| `sniff` | `read`, `grep`, `find`, `search`, `list` | raposa farejando, rastro cinza |
| `dig` | `edit`, `write`, `patch`, `replace` | raposa de costas cavando, terra saindo |
| `run` | `bash`, `shell`, `fetch`, `web`, `curl` | raposa corre entre as bordas, derrapa e volta na direção oposta |
| `jump` | fim do turno (sucesso) | raposa pulando com brilhos amarelos |
| `caught` | após o pulo | raposa de frente celebrando com brilhos, 1.6s → `sleep` |
| `error` | uma tool retornou erro | flash vermelho, 1.2s |
| `sad` | 3+ erros seguidos no turno | orelhas caídas e lágrimas azuis |

A animação roda quadro a quadro via `setInterval` no intervalo próprio de cada estado (de 130ms no `run` a 700ms no `sleep`). A factory do widget é registrada uma vez com `ctx.ui.setWidget`, e cada tick solicita uma nova renderização com `tui.requestRender()`. No estado `run`, `render(width)` fornece a largura real do terminal para calcular a trajetória. A raposa desacelera nos últimos passos, levanta poeira, para sem ultrapassar a borda, espelha o sprite e retoma a corrida. Resize e terminais mais estreitos que os 24 pixels do sprite são limitados sem provocar quebra de linha.

## Como funciona

Widget persistente (`ctx.ui.setWidget`, array de linhas ANSI) dirigido pelos hooks de lifecycle:

- `session_start` → `sleep`
- `agent_start` → `sniff` (zera o contador de erros)
- `tool_execution_start` → estado derivado de `event.toolName`
- `tool_result` → incrementa `errorStreak` em `event.isError` (`error`, ou `sad` a partir de 3)
- `agent_end` → `jump` → `caught` → `sleep` (ou `sad` se a maré foi ruim)
- `session_shutdown` → limpa os timers

Cada sprite é uma grade de pixels (`grids`) com uma letra por cor da `PALETTE`. O renderer `gridToAnsi` junta 2 linhas de pixels em 1 linha de texto usando half-blocks (`▀` com cor de frente = pixel de cima, cor de fundo = pixel de baixo), dobrando a resolução vertical. A arte fica em `src/fox-art.ts`, compartilhada pela extensão e pelo preview para impedir divergências.

## Comandos

- `/fox` — lista os estados
- `/fox <estado>` — força um estado (`sleep`, `sniff`, `dig`, `run`, `jump`, `caught`, `error`, `sad`)
- `/fox hide` — esconde a raposa
- `/fox show` — traz de volta
- `pi --fox-reduced-motion` — mantém as mudanças de estado, mas usa quadros estáticos sem movimento contínuo

## Preview

Para percorrer todos os estados no terminal:

```bash
pnpm preview
```

Para deixar um único estado animando até `Ctrl+C`:

```bash
pnpm preview -- --state run
```

O preview de `run` usa a largura atual do terminal e mostra o percurso completo com derrapagem e retorno.

Para gerar `fox-preview.png` com todos os quadros lado a lado:

```bash
pnpm preview:sheet
```

Os dois comandos compilam a extensão antes de renderizar, portanto o resultado sempre corresponde aos sprites executados pelo PI.

## Desenvolvimento

```bash
pnpm install
pnpm build   # tsc → dist/
pnpm dev     # tsc --watch
pnpm test    # trajetória, resize, orientação e integração ANSI
```
