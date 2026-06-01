# Kodo VSIX — Claude Code Guidelines

## Running scripts

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

## Check command

Before marking work complete, run:

```powershell
cd e:\source\kodo-vsix && mise exec node -- npm run check-types && mise exec node -- npm run lint
```
