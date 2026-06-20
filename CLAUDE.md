# Kodo VSIX — Claude Code Guidelines

## Memory discipline (do this unprompted)

Whenever you add a new feature or make a non-trivial behavioral change — in **either** repo (`kodo-vsix` or `kodo`) — update memory **as part of the same task**, before declaring it done. Do not wait to be asked.

- Update the relevant memory file under the project memory dir (architecture/features → `project_kodo.md`) and refresh its `MEMORY.md` pointer.
- Record what the diff alone won't tell the next session: the cross-file wiring, event/protocol names, the *why*, and any guard rails.
- Prefer updating an existing memory over creating a duplicate; delete memories a change makes wrong.

See the `feedback-update-memory-on-features` memory for the rationale.

## Running scripts on Windows

Node.js is managed by **mise**. All `npm` commands must be run via mise from `e:\source\kodo-vsix`:

```powershell
cd e:\source\kodo-vsix
mise exec node -- npm run check-types   # TypeScript type check (no emit)
mise exec node -- npm run lint          # ESLint
mise exec node -- npm run compile       # type-check + lint + esbuild (dev build)
mise exec node -- npm run package       # type-check + lint + esbuild (production build)
mise exec node -- npm run watch         # watch mode (esbuild + tsc)
```

**Always use PowerShell** for these commands — `mise` is not on the Bash tool's PATH.

## Check command on Windows

Before marking work complete, run:

```powershell
cd e:\source\kodo-vsix && mise exec node -- npm run check-types && mise exec node -- npm run lint
```
