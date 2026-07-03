# @arvoretech/pi-design-copilot

Extension do Pi que torna o modelo muito melhor em trabalho de UI da Árvore. Quatro capacidades que se reforçam:

## 1. `find_icon` — índice pesquisável de ícones
O modelo não consegue "ver" centenas de arquivos de ícone. Esta tool busca por conceito (PT **ou** EN) e devolve o nome exato do componente + a linha de import pronta.

```
find_icon({ concept: "adicionar aluno" })
→ AddIcon, ... + import { AddIcon } from '@/components/icons'
```

**Os dados vivem no workspace consumidor, não neste pacote OSS.** A tool resolve o manifest nesta ordem:

1. Env var `ARVORE_ICONS_MANIFEST` apontando pro arquivo `icons.manifest.json` (override explícito).
2. Fallback: sobe a árvore de diretórios a partir do cwd procurando `design/design-system/icons.manifest.json`.

No `arvore-hub` o manifest é gerado por `scripts/build-icon-manifest.mjs` (varre `frontend-arvore-nextjs/src/components/icons`) e commitado em `design/design-system/icons.manifest.json`. Assim o pacote publicado não carrega dados proprietários.

## 2. `find_asset` — registry de assets de marca
Busca no registry curado (`design/design-system/assets/assets.manifest.json` no hub) por intenção. Quando existe thumbnail local leve, devolve o `path` para o modelo **ver a imagem** com a tool `read`; senão devolve `source_url` (Figma/Drive) + descrição. Ver `design/design-system/assets/README.md` para curar.

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
