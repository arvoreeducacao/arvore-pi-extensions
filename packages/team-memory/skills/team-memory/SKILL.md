---
name: team-memory
description: Team knowledge base with decisions, conventions, incidents, domain knowledge, and gotchas. Use before starting any task to search for relevant context, past decisions, and known gotchas.
---

# Team Memory

## When to Use

Before starting any task, search for relevant memories that might contain:
- Past decisions that affect the current approach
- Conventions to follow
- Known gotchas that could save debugging time
- Domain knowledge about the area you're working in
- Incident history with root causes

## Tools

- `search_memories(query, category?, status?, limit?)` — keyword search across all memories
- `get_memory(id)` — read full content of a specific memory
- `add_memory(title, category, content, tags?, author?)` — capture new knowledge
- `list_memories(category?, status?, limit?)` — browse memories by category
- `archive_memory(id)` — soft-delete a memory

## Workflow

1. **Before starting work**: search for memories related to the task area
2. **During work**: if you discover a decision, gotcha, convention, or domain insight worth preserving, capture it with `add_memory`
3. **Categories**: decisions, conventions, incidents, domain, gotchas

## Memory Storage

Memories are stored as markdown files in `./memories/{category}/` with YAML frontmatter containing metadata (title, date, tags, status).

## Steering Index

A `team-memories-index.md` file is auto-generated in steering directories (`.kiro/steering/`, `.cursor/rules/`) listing all active memories with their IDs. Use this index to quickly find relevant memory IDs without searching.
