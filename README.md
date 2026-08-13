# Kōdo

<p align="center">
    <img src="images/kodo256px.png" width="256px" height="256px" alt="Kodo"/>
</p>

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version/StanislavMorozov.vs-kodo.svg)](https://marketplace.visualstudio.com/items?itemName=StanislavMorozov.vs-kodo)

**Kōdo** (コード) turns natural language into working code through a multi-agent LLM workflow — and it's built from the ground up to run that workflow on your own hardware, model included. No subscription, no API key, no round trip to someone else's datacenter.

That's the pitch. How much of it holds up today is spelled out in [Honest status](#honest-status), and you should read that section before you decide this is going to solve your afternoon.

<!-- SCREENSHOT SLOT 1 — the money shot. A Problem Solver session mid-flight: streaming agent output, a tool call card with its checkpoint links, the usage panel visible. This is the one image most people will actually look at.
<img src="https://raw.githubusercontent.com/thehiddenone/kodo-vsix/main/images/screenshot-session.png" alt="A Kōdo session running in VS Code" width="900">
-->

## What this is

Most AI coding tools live or die by your prompt. Know exactly what you want and how to ask, and they shine. Don't, and you get something plausible that misses. Kōdo is built on the idea that the bar shouldn't be that high — so instead of expecting you to front-load every right detail, it asks. Agents interview you, probe the goal, and surface the decisions you didn't know you had to make.

The second idea, and the one this project actually organises itself around: none of that should require a subscription. Kōdo is a VS Code extension talking to a local Python server, and that server drives an open-weight GGUF on your own GPU exactly as readily as it drives a hosted API. With a cloud model, nothing leaves your machine except the API call. With a local model, nothing leaves your machine at all.

Scope, stated plainly rather than discovered later: Kōdo currently targets **backend software** — logic, APIs, data pipelines — where "did it work" is a question tests can answer. Frontend work is on the roadmap and is not here yet.

## Install and first run

Install [Kōdo from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=StanislavMorozov.vs-kodo), open a folder, click the **Kōdo** icon in the activity bar. That's the whole prerequisite list — you do **not** need Python, Node, or a clone of anything.

On first activation Kōdo provisions itself, with a progress notification tracking it:

- downloads `uv` into `~/.kodo/bin/`,
- creates a Python 3.12 venv at `~/.kodo/venv/` (uv fetches the interpreter if you don't have one),
- installs the [`py-kodo`](https://pypi.org/project/py-kodo/) server package from PyPI, pinned to this extension's exact version,
- starts the server and connects.

This part is quick — a couple of minutes on a normal connection. It is not the slow part. The slow part comes next, and it's measured in tens of gigabytes.

On every later activation — including after the extension auto-updates itself — Kōdo re-checks the installed `py-kodo` version against its own and upgrades it to match if the extension is now ahead. Because a running server can't have its own Python package replaced underneath it (on Windows it holds the files locked outright), the upgrade first shuts the shared background server down, then upgrades, then starts a fresh one; other open windows reconnect on their own. Each `uv` command is retried a couple of times if it fails, and the upgrade is confirmed by re-reading the installed version rather than trusting the exit code. If it still fails, Kōdo launches on whatever version is already installed rather than blocking startup.

Then pick how you want to drive it.

### Path A — a local model (the point of the project)

1. **Kōdo: Settings** → **Local Inference**.
2. Install **llama.cpp** from the panel — Kōdo fetches a prebuilt release, keeps it in `~/.kodo/llama.cpp/`, and can pin, update, or uninstall it later.
3. Pick a model from the catalogue and download it. Kōdo checks the build against your machine's real VRAM and RAM *before* the download starts: red if it won't run, yellow if it'll crawl. Downloads pause, resume, survive restarts, and handle split-shard GGUFs without you thinking about it.
4. Activate it (**Kōdo: Use Local LLM via llama.cpp**, or the sidebar card) and start a session.

**Which models are actually worth your bandwidth.** The catalogue carries 57 ready-to-install builds across nine families, but "in the catalogue" means "curated and sized," not "personally vouched for." The ones that have been driven through real Kōdo sessions and behaved:

| Model | Verdict |
| --- | --- |
| **Qwen 3.6 27B** (dense) | Works, and a reasonable first download — but noticeably slower than the MoE below, since a dense model runs every weight on every token instead of only the sliver an MoE wakes up. |
| **Qwen 3.6 35B-A3B** (MoE) | Works, and out-paces the 27B dense above despite being the bigger download. |
| **Ornith 1.0 35B-A3B** | Works, and is very good. |
| **Laguna XS 2.1** | Works, and holds its own as a third option alongside Qwen and Ornith above. |
| **Gemma 4 26B-A4B** | Works, but noticeably less stable than the four above. |
| **Ornith 1.0 9B** | Punches well above its size class — reach for this one when the 35B-ish builds don't fit your VRAM. |
| **Nanbeige 4.2 3B** | About a third the size of Ornith 1.0 9B and trails it by a lot less than the size gap suggests — worth trying first if your hardware is tight. |
| **Laguna S 2.1** | Works, and rocks — the stronger of these two big quants, being the more sophisticated model with more parameters. Needs the serious hardware below. |
| **Qwen3 Coder 80B** | Works, and rocks, though Laguna above edges it out. Needs the serious hardware below. |
| Everything else in the catalogue | Sized and curated. Not yet driven hard enough to make a claim. |

**The hardware answer you actually want.** Roughly: **16GB of VRAM** on a PC, **48GB of unified memory** on a Mac. Some models run in less; the panel checks *your* machine per build and is more trustworthy than any number in a README. One asymmetry worth knowing: the per-model Mac guidance is grounded and reliable, the discrete-GPU guidance is hand-wavier. And most of these models would run better with hand-tuned llama.cpp arguments than with the defaults Kōdo ships — that tuning pass hasn't been done yet.

**If your hardware clears that by a wide margin.** Large quants of **Laguna S 2.1** and **Qwen3 Coder 80B** — both confirmed, both worth it — are sized for Macs with 64–96–128GB of unified memory, or RTX Pro cards with 48–72–96GB of VRAM.

### Path B — a cloud model

**Kōdo: Settings** → **Anthropic**, **OpenAI**, **Meta**, or **Google** → add an API key, assign models to the four effort tiers, done. Keys live in VS Code's encrypted secret storage, never in a file or an environment variable, and are handed to the local server over the loopback socket at runtime. Meta's tab additionally offers an opt-in "contributor" tier — heavily discounted pricing in exchange for permission to train future Meta models on your traffic — off by default and shown with a warning (availability is country-restricted) when turned on.

Anthropic, OpenAI, Meta, and Google are the four cloud vendors wired up today. The other tabs — Alibaba, DeepSeek, Kimi, OpenRouter — exist in the settings panel as honest "coming soon" placeholders rather than as working integrations pretending otherwise.

<!-- SCREENSHOT SLOT 2 — Kōdo Settings, Local Inference tab: the model catalogue with hardware-fit badges and a download in progress. Shows off the thing that took the longest to build.
<img src="https://raw.githubusercontent.com/thehiddenone/kodo-vsix/main/images/screenshot-local-inference.png" alt="Local Inference settings with the model catalogue" width="900">
-->

## Two ways to work

**The Problem Solver** is the everyday entrance and the mode carrying real weight. Point it at any codebase — Kōdo-built or not — and ask for a change, a fix, or a written investigation. It spawns dedicated Investigator, Planner, and Developer sub-agents for substantial work and just does small asks directly, without ceremony for a one-file change.

**Guided mode** takes a green-field idea to a tested system through staged specification and review: narrative → architecture → per-component requirements, design, and test plans → tests written *before* implementation → code that iterates until those tests pass. Author/critic pairs gate every stage, and you approve or send feedback at each gate. It is the more ambitious mode and, right now, the one to trust least. See [Honest status](#honest-status) — that's not modesty, it's a warning.

Worth stating outright, because it would otherwise read as "same rigor, smaller scope": the Problem Solver has **no test-first mandate and no critic gating its diff**. Guided mode's TDD-by-construction and adversarial review are specific to guided mode. That's a real capability gap, and it is a deliberate design choice rather than an unstarted task — the two modes are meant to converge from the guided side, not by bolting a critic onto the Problem Solver.

## What you get in the editor

- **Streamed agent output** with thinking blocks, tool-call cards, and subsession dividers when a sub-agent takes over.
- **A full undo history you can actually reach.** Every mutating step lands as a commit in a shadow git mirror inside `.kodo/checkpoints/` — without touching, or requiring, a repository of your own. Undo or redo an individual change, roll the whole workspace back to any point and forward again, diff between any two states. Nothing an agent does is beyond your reach to inspect or reverse.
- **File diffs in VS Code's native diff editor**, with an Edit Control review gate that can require your approval before a write lands. Select a line, right-click, **Kōdo: Add Feedback**.
- **A security layer on every tool call** — permissive, defensive, or smart. Smart mode statically analyses shell commands for anything reaching outside your workspace and asks when it can't clear a call. Permanent allow-rules are offered inline and manageable per-session or globally.
- **Crash-safe sessions.** Every session persists as it runs and resumes exactly where it stopped — mid-turn, after a crash, after a window reload. Multiple sessions run in parallel tabs across multiple VS Code windows, all against one shared local server.
- **Web-capable research** — an agent-driven search that paces its own discovery/read/synthesis loop.
- **A stuck-agent watchdog** that notices when a model is looping on its own thinking and intervenes instead of burning your evening.

## Before you hit "run" — the honest warnings

**Local models die on long sessions.** A local model's tool calls are parsed out of its raw token stream, and that format slips in ways a hosted API's basically never does. Kōdo does real work to survive this — grammar-constrained parsing, salvaging tool calls the model emitted as plain prose (behind a confirmation, because auto-salvaging silently is exactly the shortcut that bites you later), stripping stray `<think>` tags, a cyclic-thinking detector. It genuinely helps. It is not a cure. Sessions still fall over.

**Out-of-memory protection is the weakest part of the system.** The pre-download hardware check is real, but it is an *estimate*, and the estimates are optimistic and not validated against enough real machines. Custom llama.cpp flavors bypass the guidance entirely. And here's the part that matters most: this is developed on a 128GB M5 Max, where everything fits — which means the failure path is the least-exercised code in the project, essentially by construction. If you are close to your machine's limit, be the cautious one. Save your work first.

**Guided mode has no track record.** The stages run, the gates work, the checkpoints land. What's missing is proof that chaining all of it together on a real, non-trivial project produces something worth the ceremony. Use the Problem Solver.

**Model downloads are enormous.** The catalogue runs from 8.5GB at the small end to 86GB at the large. Kōdo's own startup is fast; the wait you'll experience is HuggingFace's bandwidth, not Kōdo's.

**The UI has rough edges.** It's functional and it's been used in anger, but it hasn't had a polish pass. Expect places where the wiring shows.

## Platforms

| Platform | State |
| --- | --- |
| **macOS (Apple Silicon)** | Primary. Daily-driven, including local inference with Metal offload. |
| **Windows** | Real. Regularly used and tested. |
| **Linux** | Least tested by a wide margin — and honestly, tested under WSL2 rather than a real Linux box. A CUDA llama.cpp build has never been verified. It should work. Nobody has proven it. |

## Where your things live

Everything global goes under `~/.kodo/` — the venv, the llama.cpp builds and GGUFs, logs, settings, and every persisted session. Per-project state (specs, the checkpoint mirror, the `kodo.md` manifest) lives in a `.kodo/` directory inside the workspace itself.

Cloud API keys are in none of those files. They live in VS Code's encrypted secret storage.

There is exactly **one Kōdo server per machine** — a detached background process shared by every window, which is why parallel sessions in different windows behave sanely. It survives window reloads and closes, and shuts itself down a few seconds after the last window disconnects. You never need to kill it; the only time Kōdo stops it deliberately is to upgrade `py-kodo` after an extension update, which it does at startup and immediately relaunches from.

**When something breaks**, the first place to look is the **"Kodo Server"** output channel (View → Output). It live-tails the shared server log: startup errors, tracebacks, the exact command line used to launch the server. Two failures account for most of them:

- **The server never comes up.** Almost always a corrupt venv. Kōdo already retries once with a freshly rebuilt one; if it's still stuck, delete `~/.kodo/venv/` and reload the window. It's rebuilt automatically and safe to delete.
- **The `py-kodo` install (or upgrade) fails.** The extension pins `py-kodo` to its own version — on first install and again on every later activation where the extension has updated ahead of the installed `py-kodo` — and falls back to the latest release if that exact version isn't on PyPI's index yet. A failed upgrade never blocks startup: Kōdo just launches on whatever `py-kodo` version is already installed. The `uv pip install` error will be in the output channel either way. For the full step-by-step trace of this process (which branch was taken, the exact commands run, their exit codes, each retry, and whether the upgrade was confirmed afterwards), check the separate **"Kodo"** output channel — it's dedicated to this setup/upgrade sequence so it doesn't get lost in the server's own log volume, and there's a **Kōdo: Show Diagnostics Log** command if you'd rather not hunt for it in the Output dropdown. Before upgrading, Kōdo stops the running server precisely so it can't hold its own files locked (the classic Windows failure); if you see the "Kodo" channel report the server still alive at that point, that shutdown is what didn't work.

A leftover `~/.kodo/kodo-server` file after a crash or reboot is harmless — Kōdo notices the PID is dead, removes it, and starts fresh.

## Roadmap

In rough priority order, and with the standard caveat that "roadmap" means "not built yet":

1. **Guided mode earning its keep.** Release is gated on demonstrated capability, not a feature list. A validator harness runs real Kōdo sessions end-to-end — real server, real protocol, real tools and gates, no VS Code and no human — and v1.0 ships when a battery of medium-to-high-complexity scenarios builds cleanly inside it with all generated tests passing: an HTTP/HTTPS server in C++ or Rust, a transactional in-memory database, a distributed-consensus key/value store. That battery has not been cleared.
2. **Hybrid local↔cloud routing.** Treat local and cloud as one pool: a small local model triages each step and escalates to a frontier model only when the work genuinely needs one, keeping everything routine on your own GPU.
3. **More cloud providers.** DeepSeek, Alibaba, Kimi, and OpenRouter as an aggregator — the settings tabs are already waiting for them.
4. **Agent studio.** Let users author their own agents, plus a prompt-helper agent that assists in writing the prompts that drive them.
5. **Console mode.** A real headless interface, so `py-kodo` is useful without VS Code.
6. **Spec and code staying in sync.** The north star: the spec as source of truth, code as its derived artifact — update the spec and Kōdo handles the rest. Including teaching the Problem Solver to operate on guided projects so an urgent fix never silently desyncs the two.
7. **Frontend and UI work**, lifting today's backend-only scope limit.
8. **More language toolchains.** Python, C++, and Rust exist today.

## Honest status

Early-stage, with that phrase carrying its literal meaning rather than the usual README hedge that means "basically done, but legally we have to say this."

Guided mode is mostly untested end-to-end and has not yet produced a delivery good enough to point at and say "see, this is why you'd use it."

The Problem Solver is in noticeably better shape, mostly because it's the mode that's actually been driven — hard, repeatedly, including on Kōdo's own codebase. Most of Kōdo is written using Claude Code (different tool, unfortunate name overlap, sorry), and for the last few weeks Kōdo has also been used to write parts of itself. It hasn't collapsed into a recursive-slop feedback loop yet, which is either mildly encouraging about the approach or just means it hasn't been pushed hard enough to find out. Both remain open.

And none of this closes the gap with a frontier hosted model, because nothing can. An open-weight GGUF running on the desk next to you is not going to out-plan or out-code a current-generation heavyweight, and no amount of context engineering, checkpointing, or agent choreography changes that ceiling. Anyone telling you otherwise is selling something.

What Kōdo bets on instead is narrower and, hopefully, truer: most real engineering work doesn't need frontier-grade reasoning — it needs the workflow around a smaller model to stop wasting the reasoning that model already has. Small, dense contexts instead of one ever-growing transcript. Tests as the definition of done. Iteration paid for in electricity and patience rather than tokens.

It's a stubborn bet. It isn't proven. It's being worked on anyway, slowly, on ordinary hardware, with the same patience the whole approach is asking of everyone else.

## Links and development

- **Kōdo server** (Python, the engine): [github.com/thehiddenone/kodo](https://github.com/thehiddenone/kodo) — start with its [README](https://github.com/thehiddenone/kodo/blob/main/README.md) and the design docs in [`doc/`](https://github.com/thehiddenone/kodo/tree/main/doc), covering the workflow, agents, wire protocol, security model, checkpointing, and local inference in far more depth than this page.
- **This extension**: [github.com/thehiddenone/kodo-vsix](https://github.com/thehiddenone/kodo-vsix), published on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=StanislavMorozov.vs-kodo).
- **Licence**: Apache 2.0.

Building from source needs Node.js 24 and VS Code ≥ 1.90; `npm install`, then **F5** launches an Extension Development Host. Set `KODO_DEV_PATH` to a local `kodo` checkout to install the server editable from source instead of from PyPI. The extension is TypeScript throughout, bundled with esbuild, with a Preact UI in the webviews.

```bash
npm install
npm run compile     # type-check + lint + dev bundle
npm run package     # production bundle
npm test            # integration tests via @vscode/test-cli
```
