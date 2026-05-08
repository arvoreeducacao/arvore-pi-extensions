# Arvore PI Extensions

Monorepo for custom PI extensions used across Arvore projects.

## Extensions

| Package | Description |
|---------|-------------|
| `@arvoretech/pi-team-memory` | Team memory with proactive capture hooks |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Using Extensions

### Global (all projects)
Link to `~/.pi/agent/extensions/`:
```bash
ln -s $(pwd)/packages/team-memory/dist ~/.pi/agent/extensions/team-memory
```

### Project-local
Reference in `.pi/settings.json`:
```json
{
  "extensions": ["./path/to/arvore-pi-extensions/packages/team-memory"]
}
```
