# Contributing

Thanks for helping out. Issues and pull requests are both welcome.

## Setup

```sh
bun install
bun link
```

There is no build step. The `bin` entry points at `src/cli.ts` and Bun runs it directly.

## Tests

```sh
bun test
```

The suite is pure. It uses injected ports and temporary directories, so it never opens a dialog and never touches your real `~/.nag` store. Keep it that way.

## Code style

- No code comments. Names carry the intent.
- One return at the end. No early return and no guard clause.
- One line per declaration, argument, type and call.
- `if` statements over ternaries.
- Explicit braces and explicit parentheses always.
- Plain checks over clever operators.

## Proposing a change

- Open an issue first for anything larger than a small fix.
- Write the failing test before the fix.
- Keep the diff to what the change needs.
- Update `README.md`, `AGENTS.md` and the skill when a command or flag changes.
- Run `bun test` and paste the summary line in the pull request.
