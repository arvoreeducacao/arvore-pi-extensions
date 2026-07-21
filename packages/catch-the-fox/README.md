# catch-the-fox

Extensão do PI que mostra uma **personagem em pixel-art animada** (half-block truecolor) acima do editor. Você pode escolher entre a raposa original e uma capivara mais tranquila. A personagem muda de pose conforme o que o agente está fazendo — farejando, cavando, correndo, pulando, celebrando ou dormindo enquanto espera você. Durante execuções, ela atravessa o terminal, derrapa junto à borda, vira e corre de volta.

A raposa grande continua sendo o padrão. Os tamanhos `medium` e `small` reduzem largura e altura do sprite para ocupar menos espaço no terminal.

A capivara usa 81 quadros importados diretamente dos 11 spritesheets do pacote `8bit - Capibaras`: respirar, caminhar, nadar, agachar, dois ataques, correr, dano, morte e dois saltos. As sequências e durações vêm dos arquivos Aseprite; a conversão apenas recorta a transparência e reduz para a grade do terminal com nearest-neighbor. Os três tamanhos disponíveis são:

| Tamanho | Grade | Altura renderizada |
|---------|-------|--------------------|
| `large` | 24 × 20 | 10 linhas |
| `medium` | 18 × 16 | 8 linhas |
| `small` | 12 × 10 | 5 linhas |

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
| `sad` | 3+ erros seguidos no turno | reação triste; capivara reproduz a animação de morte e segura o último quadro |
| `swim` | acionado manualmente | capivara reproduz a animação original de nado |

A animação roda quadro a quadro via `setTimeout`, respeitando a duração original de cada quadro quando disponível. A factory do widget é registrada uma vez com `ctx.ui.setWidget`, e cada tick solicita uma nova renderização com `tui.requestRender()`. No estado `run`, `render(width)` fornece a largura real do terminal para calcular a trajetória. A personagem desacelera nos últimos passos, levanta poeira, para sem ultrapassar a borda, espelha o sprite e retoma a corrida. Resize e terminais mais estreitos que o sprite são limitados sem provocar quebra de linha.

## Como funciona

Widget persistente (`ctx.ui.setWidget`, array de linhas ANSI) dirigido pelos hooks de lifecycle:

- `session_start` → `sleep`
- `agent_start` → `sniff` (zera o contador de erros)
- `tool_execution_start` → estado derivado de `event.toolName`
- `tool_result` → incrementa `errorStreak` em `event.isError` (`error`, ou `sad` a partir de 3)
- `agent_end` → `jump` → `caught` → `sleep` (ou `sad` se a maré foi ruim)
- `session_shutdown` → limpa os timers

Cada sprite é uma grade de pixels (`grids`) com uma letra por cor da paleta da personagem. O renderer `gridToAnsi` junta 2 linhas de pixels em 1 linha de texto usando half-blocks (`▀` com cor de frente = pixel de cima, cor de fundo = pixel de baixo), dobrando a resolução vertical. A arte da raposa fica em `src/fox-art.ts`; a capivara importada fica em `src/capybara-art.ts`. Extensão e preview compartilham os mesmos módulos para impedir divergências.

## Comandos

- `/fox` — mostra personagem, tamanho e estados atuais
- `/fox <estado>` — força um estado (`sleep`, `sniff`, `dig`, `run`, `jump`, `caught`, `error`, `sad`, `swim`)
- `/fox character` ou `/fox characters` — alterna entre raposa e capivara
- `/fox character fox` — usa a raposa
- `/fox character capybara` — usa a capivara
- `/fox size large|medium|small` — troca o tamanho durante a sessão
- `/fox hide` — esconde a personagem
- `/fox show` — traz de volta
- `pi --fox-character capybara` — inicia com a capivara
- `pi --fox-size medium` — inicia no tamanho médio
- `pi --fox-reduced-motion` — mantém as mudanças de estado, mas usa quadros estáticos sem movimento contínuo

## Preview

Para percorrer todos os estados no terminal usando a configuração padrão:

```bash
pnpm preview
```

Para experimentar uma combinação específica:

```bash
pnpm preview -- --character capybara --size small --state run
```

Para comparar personagens e tamanhos lado a lado:

```bash
pnpm preview:compare
pnpm preview -- --compare --state sniff
```

Sem `--state`, o comparativo anima brevemente e termina sozinho. Com `--state`, ele permanece animado até `Ctrl+C`.

Para gerar `/tmp/catch-the-fox-frames.png` com **todos os quadros** de todos os estados nos três tamanhos:

```bash
pnpm preview:frames
```

Esse é o preview de regressão recomendado antes de abrir PR: ele expõe cortes, poses fundidas e mudanças de escala entre quadros.

Para gerar `fox-preview.png` com o primeiro quadro de cada estado:

```bash
pnpm preview:sheet
```

Todos os comandos compilam a extensão antes de renderizar, portanto o resultado sempre corresponde aos sprites executados pelo PI.

## Origem da capivara

Os sprites foram importados do pacote pago **8bit - Capibaras**, da 14 Collective. O arquivo de licença fornecido permite uso e modificação em projetos gratuitos e comerciais, mas proíbe reempacotar, redistribuir ou revender os assets, mesmo modificados.

O uso local e os previews estão prontos. Antes de publicar `src/capybara-art.ts` em PR ou npm, confirme por escrito com a 14 Collective que distribuir as grades convertidas dentro da extensão é permitido.

## Desenvolvimento

```bash
pnpm install
pnpm import:capybara -- "/caminho/para/8 bit Capibaras/Capibara"
pnpm build   # tsc → dist/
pnpm dev     # tsc --watch
pnpm test    # trajetória, resize, orientação e integração ANSI
```
