/**
 * Benchmark and Basics test from the Kōdo Settings panel (kodo
 * doc/AGENT_BUILDER.md §8, D17–D20, D37).
 *
 * The panel never runs a benchmark itself (D19): it builds a `kodo-harbor run`
 * command and runs it in a VS Code integrated terminal, using the
 * `kodo-harbor` from the managed `~/.kodo/venv`. `kodo-harbor` does every
 * preflight (Docker, uv, credentials, tier) and prints it in that terminal.
 * When the terminal's shell integration reports the command ended, the job's
 * `kodo-summary.md` is opened if the run wrote one.
 *
 * Credentials (D37): `kodo-harbor` reads a cloud key only from its own
 * environment, and a key entered in Kōdo's Cloud AI settings lives in VS
 * Code's secret storage, not in any shell. So when no credential variable for
 * the chosen vendor is set, the active stored key is passed in that one
 * terminal's environment, under the vendor's preferred variable name. It is
 * never written on the command line or to a file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { BenchmarkRequest, HarborModelOption, HarborOptionsResult } from '../settings-panel/types';
import { kodoVenvDir } from '../uv-setup';
import { sendControlAwait } from './control-send';
import { readSettings } from './settings-io';
import { state } from './state';

const SUMMARY_FILE = 'kodo-summary.md';
const SHELL_INTEGRATION_WAIT_MS = 5_000;
const AWS_REGION_VARS = ['AWS_REGION', 'AWS_DEFAULT_REGION'];

/** What the last `harbor.options` reply said that `runBenchmark` needs and
 *  the webview does not send back: where each vendor's key goes, where jobs
 *  are written, and the control agent. */
let lastOptions: { credentialEnv: Map<string, string[]>; jobsDir: string; control: string } | null = null;

/** `<agent>-<YYYY-MM-DD_HH-MM-SS>`, local time: the panel's job name (§8). */
export function benchmarkJobName(agent: string, now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${agent}-${date}_${time}`;
}

/** The `kodo-harbor` argument list for *request* (§8). */
export function benchmarkArgs(
  request: BenchmarkRequest,
  jobsDir: string,
  jobName: string,
  control: string,
): string[] {
  return [
    'run',
    '--agent', request.agent,
    '--model', request.model,
    '--suite', request.suite,
    '--attempts', String(request.attempts),
    ...(request.control ? ['--control', control] : []),
    ...(request.thinkingLevel ? ['--thinking-level', request.thinkingLevel] : []),
    '--jobs-dir', jobsDir,
    '--job-name', jobName,
  ];
}

/** The environment a terminal needs for *vendor*'s credential: `{}` when the
 *  inherited environment already holds one, else the stored *secret* under
 *  the preferred variable (plus the Bedrock region, which is not a secret). */
export function credentialEnv(
  names: readonly string[],
  secret: string | undefined,
  inherited: Readonly<Record<string, string | undefined>>,
  bedrockRegion: string | null,
): Record<string, string> {
  if (names.length === 0 || !secret || names.some((name) => (inherited[name] ?? '').trim() !== '')) {
    return {};
  }
  const env: Record<string, string> = { [names[0]]: secret };
  if (bedrockRegion && !AWS_REGION_VARS.some((name) => (inherited[name] ?? '').trim() !== '')) {
    env.AWS_REGION = bedrockRegion;
  }
  return env;
}

/** One command line for a shell with no shell integration to run it for us. */
export function quoteCommandLine(executable: string, args: readonly string[], platform: string): string {
  if (platform === 'win32') {
    // PowerShell, VS Code's default Windows shell: call operator + single quotes.
    const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
    return ['&', q(executable), ...args.map(q)].join(' ');
  }
  const q = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [executable, ...args].map(q).join(' ');
}

function kodoHarborExecutable(): string {
  return process.platform === 'win32'
    ? path.join(kodoVenvDir(), 'Scripts', 'kodo-harbor.exe')
    : path.join(kodoVenvDir(), 'bin', 'kodo-harbor');
}

async function storedKey(vendor: string): Promise<string | undefined> {
  const context = state.extensionContext;
  return context ? cloudCredentials.getActiveKey(context, vendor) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** Fetch `harbor.options` for the modal, widening each cloud model's
 *  `credential` with the keys kept in Kōdo's Cloud AI settings (D37). */
export async function fetchHarborOptionsForPanel(): Promise<void> {
  const failed = (error: string): HarborOptionsResult => ({
    ok: false, error, models: [], suites: [], basicsSuite: '', controls: [],
    llamaRunning: false, llamaModel: '',
  });
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('harbor.options', {}, 30_000);
  } catch {
    KodoSettingsPanel.instance?.update({ harborOptions: failed('Could not reach the Kōdo server.') });
    return;
  }
  if (resp.ok !== true) {
    KodoSettingsPanel.instance?.update({ harborOptions: failed(String(resp.error ?? 'unknown error')) });
    return;
  }
  const rows = Array.isArray(resp.models) ? (resp.models as Record<string, unknown>[]) : [];
  const stored = new Map<string, boolean>();
  const credentialEnvByVendor = new Map<string, string[]>();
  const models: HarborModelOption[] = [];
  for (const row of rows) {
    const vendor = String(row.vendor ?? '');
    let credential = typeof row.credential === 'boolean' ? row.credential : null;
    if (vendor) {
      credentialEnvByVendor.set(vendor, strings(row.credential_env));
      if (credential === false) {
        if (!stored.has(vendor)) {
          stored.set(vendor, (await storedKey(vendor)) !== undefined);
        }
        credential = stored.get(vendor) === true;
      }
    }
    models.push({
      model: String(row.model ?? ''),
      kind: String(row.kind ?? 'local'),
      description: String(row.description ?? ''),
      credential,
      vendor,
      thinkingTiers: strings(row.thinking_tiers),
      defaultThinkingTier: String(row.default_thinking_tier ?? ''),
      control: row.control === true,
    });
  }
  lastOptions = {
    credentialEnv: credentialEnvByVendor,
    jobsDir: String(resp.jobs_dir ?? ''),
    control: strings(resp.controls)[0] ?? '',
  };
  const suites = Array.isArray(resp.suites) ? (resp.suites as Record<string, unknown>[]) : [];
  KodoSettingsPanel.instance?.update({
    harborOptions: {
      ok: true,
      error: '',
      models,
      suites: suites.map((s) => ({ name: String(s.name ?? ''), description: String(s.description ?? '') })),
      basicsSuite: String(resp.basics_suite ?? ''),
      controls: strings(resp.controls),
      llamaRunning: resp.llama_running === true,
      llamaModel: String(resp.llama_model ?? ''),
    },
  });
}

/** Wait (bounded) for a fresh terminal's shell integration to activate. */
async function shellIntegrationOf(
  terminal: vscode.Terminal,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return terminal.shellIntegration;
  }
  // Added in VS Code 1.93; the extension supports 1.90, so feature-detect.
  if (typeof vscode.window.onDidChangeTerminalShellIntegration !== 'function') {
    return undefined;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(undefined);
    }, SHELL_INTEGRATION_WAIT_MS);
    const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) {
        clearTimeout(timer);
        listener.dispose();
        resolve(e.shellIntegration);
      }
    });
  });
}

async function openSummary(summary: string): Promise<void> {
  if (!fs.existsSync(summary)) {
    return;
  }
  await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(summary));
}

/** Run *request* with `kodo-harbor` in a new integrated terminal (D19). */
export async function runBenchmark(request: BenchmarkRequest): Promise<void> {
  const executable = kodoHarborExecutable();
  if (!fs.existsSync(executable)) {
    void vscode.window.showErrorMessage(
      `Kōdo: kodo-harbor is not installed at ${executable}. Start the Kōdo server once so it sets up its environment, then try again.`,
    );
    return;
  }
  const jobsDir = lastOptions?.jobsDir || path.join(os.homedir(), '.kodo', 'harbor', 'jobs');
  const jobName = benchmarkJobName(request.agent, new Date());
  const args = benchmarkArgs(request, jobsDir, jobName, lastOptions?.control || 'terminus-2');

  const vendor = request.model.includes('/') ? request.model.split('/')[0] : '';
  const names = vendor ? lastOptions?.credentialEnv.get(vendor) ?? [] : [];
  const region = vendor === 'bedrock' ? String(readSettings().bedrock_region ?? '') || null : null;
  const env = credentialEnv(names, vendor ? await storedKey(vendor) : undefined, process.env, region);

  const terminal = vscode.window.createTerminal({
    name: `Kōdo benchmark: ${request.agent}`,
    cwd: os.homedir(),
    env,
  });
  terminal.show();
  const summary = path.join(jobsDir, jobName, SUMMARY_FILE);
  const integration = await shellIntegrationOf(terminal);
  if (integration && typeof vscode.window.onDidEndTerminalShellExecution === 'function') {
    const execution = integration.executeCommand(executable, args);
    const listener = vscode.window.onDidEndTerminalShellExecution((e) => {
      if (e.execution === execution) {
        listener.dispose();
        void openSummary(summary);
      }
    });
    state.extensionContext?.subscriptions.push(listener);
    return;
  }
  // No shell integration: run it as typed input. The summary is not opened
  // automatically then; kodo-harbor prints its path when it finishes.
  terminal.sendText(quoteCommandLine(executable, args, process.platform));
}
