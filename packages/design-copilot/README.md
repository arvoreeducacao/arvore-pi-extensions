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

## 3. `/design-review` — segunda vista sobre a tela

Olha a tela alterada e devolve **no máximo 3 achados** — ou nada, quando não há o que apontar. Infere a intenção da conversa em vez de pedir formulário, e nunca reporta item mecânico (hex cru, `lucide-react`, emoji, `h-screen`): isso é lint.

O protocolo não vive aqui: a extensão resolve `design/design-review.md` no workspace por walk-up e manda o modelo segui-lo, preferindo um sub-agent de contexto fresco. Não achou o arquivo, ela diz para atualizar o `arvore-hub` em vez de improvisar. Assim a política muda com um commit no hub, sem republicar o pacote.

O acionamento é manual; o gatilho automático fica na abertura do PR, e sempre pergunta antes de rodar.

## Instalação

Adicionar em `.pi/settings.json` (workspace `arvore-hub`):

```json
"npm:@arvoretech/pi-design-copilot"
```

Requer publicação prévia no registry interno (`pnpm publish` no pacote) ou referência local durante desenvolvimento.
