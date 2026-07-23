# catch-the-fox

Extensão do PI que mostra uma **personagem em pixel-art animada** (half-block truecolor) acima do editor. Você pode escolher entre a raposa original, uma capivara mais tranquila, uma raposa guerreira de espada e um gato. A personagem muda de pose conforme o que o agente está fazendo — farejando, cavando, correndo, pulando, celebrando ou dormindo enquanto espera você. Durante execuções, ela atravessa o terminal, derrapa junto à borda, vira e corre de volta.

A raposa grande continua sendo o padrão. Os tamanhos `medium` e `small` reduzem largura e altura do sprite para ocupar menos espaço no terminal.

A capivara usa 81 quadros distribuídos em 11 animações: respirar, caminhar, nadar, agachar, dois ataques, correr, dano, morte e dois saltos. Os quadros são extraídos pixel a pixel dos spritesheets do pack **8bit Capibaras** (14 Collective) e renderizados 1:1 no tamanho `large`, sem rescale. Cada personagem tem sua própria grade nativa:

A raposa guerreira usa 46 quadros em 7 animações (idle, caminhar, correr, corte rápido, dash, corte com arco e dano), extraídas de um spritesheet externo: cada animação foi recortada na bounding box unida dos seus quadros, reamostrada por bloco dominante (bordas pixel-art preservadas), quantizada numa paleta de 24 cores e alinhada pelos pés numa grade uniforme.

O gato usa 69 quadros em 8 animações do pack **CatPack** (dormir, sentado, comendo, dançando, animado, caixa de papelão, susto e choro), recortados quadro a quadro dos strips individuais 32×32 e renderizados 1:1 em todos os tamanhos — o gato não tem downscale propositalmente, para preservar a qualidade nativa da arte.

| Tamanho | Raposa | Capivara | Guerreira | Gato | Altura renderizada |
|---------|--------|----------|-----------|------|--------------------|
| `large` | 24 × 20 | 26 × 24 | 28 × 24 | 32 × 32 | 10–16 linhas |
| `medium` | 18 × 16 | 20 × 18 | 21 × 18 | 32 × 32 | 8–16 linhas |
| `small` | 12 × 10 | 13 × 12 | 14 × 12 | 32 × 32 | 5–16 linhas |

> Requer terminal com **truecolor** (Warp ✓, iTerm2 ✓, kitty ✓, ghostty ✓).

## Estados

| Estado | Quando | Visual |
|--------|--------|--------|
| `sleep` | ocioso (turno terminou) | raposa dormindo, `zzz` cinza |
| `sniff` | `read`, `grep`, `find`, `search`, `list` | raposa farejando, rastro cinza; capivara passeia de um lado para o outro do terminal; guerreira patrulha com a espada |
| `dig` | `edit`, `write`, `patch`, `replace` | raposa de costas cavando, terra saindo; guerreira desfere cortes rápidos; gato devora um pote de ração |
| `run` | `bash`, `shell`, `fetch`, `web`, `curl` | raposa corre entre as bordas, derrapa e volta na direção oposta; gato saltita dançando atrás do laser |
| `jump` | fim do turno (sucesso) | raposa pulando com brilhos amarelos; guerreira avança num dash; gato comemora na pata traseira |
| `caught` | após o pulo | raposa de frente celebrando com brilhos, 1.6s → `sleep`; guerreira desfere o corte com arco; gato brinca na caixa de papelão |
| `error` | uma tool retornou erro | flash vermelho, 1.2s; guerreira toma um contra-ataque; gato toma um susto |
| `sad` | 3+ erros seguidos no turno | reação triste; capivara reproduz a animação de morte e segura o último quadro; gato chora |
| `swim` | acionado manualmente | capivara faz a jornada da água: caminha até a margem que surge à frente, mergulha com o salto e atravessa nadando até a borda direita enquanto a água preenche o terminal atrás dela; volta nadando sobre a água completa e, ao chegar à esquerda, submerge — resta apenas a água ondulando |

A animação roda quadro a quadro via `setTimeout`, respeitando a duração original de cada quadro quando disponível. A factory do widget é registrada uma vez com `ctx.ui.setWidget`, e cada tick solicita uma nova renderização com `tui.requestRender()`. No estado `run`, `render(width)` fornece a largura real do terminal para calcular a trajetória. A personagem desacelera nos últimos passos, levanta poeira, para sem ultrapassar a borda, espelha o sprite e retoma a corrida. Resize e terminais mais estreitos que o sprite são limitados sem provocar quebra de linha.

## Como funciona

Widget persistente (`ctx.ui.setWidget`, array de linhas ANSI) dirigido pelos hooks de lifecycle:

- `session_start` → `sleep`
- `agent_start` → `sniff` (zera o contador de erros)
- `tool_execution_start` → estado derivado de `event.toolName`
- `tool_result` → incrementa `errorStreak` em `event.isError` (`error`, ou `sad` a partir de 3)
- `agent_end` → `jump` → `caught` → `sleep` (ou `sad` se a maré foi ruim)
- `session_shutdown` → limpa os timers

Cada sprite é uma grade de pixels (`grids`) com uma letra por cor da paleta da personagem. O renderer `gridToAnsi` junta 2 linhas de pixels em 1 linha de texto usando half-blocks (`▀` com cor de frente = pixel de cima, cor de fundo = pixel de baixo), dobrando a resolução vertical. A arte da raposa fica em `src/fox-art.ts`; a capivara fica em `src/capybara-art.ts`; a guerreira fica em `src/warrior-art.ts`; o gato fica em `src/cat-art.ts`. Extensão e preview compartilham os mesmos módulos para impedir divergências.

## Comandos

- `/fox` — mostra personagem, tamanho e estados atuais
- `/fox <estado>` — força um estado (`sleep`, `sniff`, `dig`, `run`, `jump`, `caught`, `error`, `sad`, `swim`)
- `/fox character` ou `/fox characters` — alterna entre raposa, capivara, guerreira e gato e salva a escolha
- `/fox character fox` — usa a raposa e salva a escolha
- `/fox character capybara` — usa a capivara e salva a escolha
- `/fox character warrior` — usa a raposa guerreira e salva a escolha
- `/fox character cat` — usa o gato e salva a escolha
- `/fox size large|medium|small` — troca o tamanho e salva a escolha para próximas sessões
- `/fox hide` — esconde a personagem
- `/fox show` — traz de volta
- `pi --fox-character capybara` — inicia com a capivara
- `pi --fox-character warrior` — inicia com a raposa guerreira
- `pi --fox-character cat` — inicia com o gato
- `pi --fox-size medium` — inicia no tamanho médio
- `pi --fox-reduced-motion` — mantém as mudanças de estado, mas usa quadros estáticos sem movimento contínuo

Personagem e tamanho são persistidos globalmente em `~/.config/pi/catch-the-fox.json`. Flags de CLI têm prioridade somente enquanto aquele processo do Pi estiver aberto e não substituem as preferências salvas. `hide` e `show` continuam valendo apenas para a sessão atual.

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

Para gerar `/tmp/catch-the-fox-preview.png` com o primeiro quadro de cada estado:

```bash
pnpm preview:sheet
```

Todos os comandos compilam a extensão antes de renderizar, portanto o resultado sempre corresponde aos sprites executados pelo PI.

## Desenvolvimento

```bash
pnpm install
pnpm build   # tsc → dist/
pnpm dev     # tsc --watch
pnpm test    # trajetória, resize, orientação e integração ANSI
```
