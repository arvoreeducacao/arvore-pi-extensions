# @arvoretech/pi-design-copilot

Extension do Pi que torna o modelo muito melhor em trabalho de UI da Árvore e do SuperAutor. Quatro capacidades que se reforçam.

> **Dois design systems, sem mistura.** As tools `find_icon`/`find_asset` exigem o parâmetro `designSystem: 'bonsai' | 'superautor'`. Cada valor resolve um registry **separado** — uma tela Bonsai (Árvore) nunca recebe asset/ícone do SuperAutor e vice-versa.

| designSystem | Projeto | Ícones | Assets |
|---|---|---|---|
| `bonsai` | Árvore (frontend-arvore-nextjs) | React, `@/components/icons` | `design/design-system/assets` |
| `superautor` | SuperAutor (superautor-sistema) | Rails SVG, `render_svg 'icones/...'` | `design/superautor-design-system/assets` |

## 1. `find_icon` — índice pesquisável de ícones
Busca por conceito (PT **ou** EN) no design system indicado e devolve o nome exato + snippet de uso pronto.

```
find_icon({ designSystem: "bonsai", concept: "adicionar aluno" })
→ AddIcon, ... + import { AddIcon } from '@/components/icons'

find_icon({ designSystem: "superautor", concept: "troféu" })
→ trophy + <%= render_svg 'icones/trophy' %>
```

**Os dados vivem no workspace consumidor, não neste pacote OSS.** A tool resolve o manifest:

1. Env var (`ARVORE_ICONS_MANIFEST` para bonsai, `SUPERAUTOR_ICONS_MANIFEST` para superautor) — override explícito.
2. Fallback: sobe a árvore de diretórios procurando `design/design-system/icons.manifest.json` (bonsai) ou `design/superautor-design-system/icons.manifest.json` (superautor).

No `arvore-hub` os manifests são gerados por scripts e commitados. Assim o pacote publicado não carrega dados proprietários.

## 2. `find_asset` — registry de assets de marca
Busca no registry curado do design system indicado por intenção. Quando existe thumbnail local leve, devolve o `path` para o modelo **ver a imagem** com a tool `read`; senão devolve `source_url` + descrição.

```
find_asset({ designSystem: "bonsai", intent: "otto celebração" })
find_asset({ designSystem: "superautor", intent: "sticker campeão" })
```

Resolução análoga à dos ícones (env `ARVORE_ASSETS_MANIFEST` / `SUPERAUTOR_ASSETS_MANIFEST`, ou walk-up).

## 3. `/design-brief` — brief obrigatório com hard gate
Antes de gerar UI, `edit`/`write` em `.tsx/.jsx/.css/.scss/.vue` ficam **bloqueados** até o brief ser definido. `/design-brief` pergunta persona, UX infantil, alvos responsivos, cobertura de estados e necessidade de assets, e injeta o resultado no contexto. Escape: `/skip-brief`.

## 4. `/design-review` — gate de heurísticas
Audita a UI gerada contra `guidelines.md §8` (tokens, shadcn-first, ícones, tipografia, responsivo, estados, acessibilidade WCAG AA, 10 heurísticas de Nielsen + UX infantil), preferindo um sub-agent de contexto fresco. Oferecido automaticamente no fim de sessões que tocaram UI.

## Instalação

Adicionar em `.pi/settings.json` (workspace `arvore-hub`):

```json
"npm:@arvoretech/pi-design-copilot"
```

Requer publicação prévia no registry interno (`pnpm publish` no pacote) ou referência local durante desenvolvimento.
