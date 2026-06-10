# @arvoretech/pi-bee-context

PI extension that injects your confirmed personal facts from the [Bee](https://bee.computer) wearable assistant into the system prompt, so the LLM can give more personalized responses.

## How it works

- On `session_start`, runs `bee facts list --json` and caches the confirmed facts in memory.
- On `before_agent_start`, appends the facts (grouped by tag) to the turn's system prompt. Facts never pollute the conversation history.
- Fails gracefully: if the `bee` CLI is missing, unauthenticated, or times out, the extension injects nothing and the agent runs normally.

## Requirements

The [`bee` CLI](https://bee.computer) must be installed and authenticated:

```bash
bee status
```

## Commands

| Command | Description |
|---------|-------------|
| `/bee-refresh` | Re-fetch facts from Bee and update the injected context (the cache is built at session start). |
| `/bee-show` | Show the facts currently injected. |

## Privacy

Bee facts can include sensitive personal information (health, beliefs, relationships). The injected block instructs the model to treat them as sensitive, but the content is sent to whichever model provider you use. Only enable this extension where you are comfortable with that.

## Usage

### Global (all projects)

```bash
ln -s $(pwd)/packages/bee-context/dist ~/.pi/agent/extensions/bee-context
```

### Project-local

```json
{
  "extensions": ["./path/to/arvore-pi-extensions/packages/bee-context"]
}
```
