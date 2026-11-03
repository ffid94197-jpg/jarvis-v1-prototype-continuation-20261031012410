/**
 * JARVIS local project build adapter.
 *
 * Untrusted project build code runs ONLY inside Windows Sandbox (Hyper-V
 * disposable VM), with networking/clipboard/devices disabled. The only host
 * folders mapped into the guest are a secret-filtered read-only source
 * snapshot, read-only Node/npm runtime and package cache, and one run-scoped
 * writable output folder. There is no direct-process fallback.
 *
 * This is a prototype isolation boundary, not LPAC/AppContainer or release
 * security certification. Owner must explicitly opt in.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  resolveScopedPath,
  WORKSPACE_ROOT,
} from "../guardian/policy";

const ENABLE_FLAG = "JARVIS_LOCAL_PROJECT_BUILD_ENABLED";
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 128 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 520 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_ARTIFACT_FILES = 25_000;
const MAX_OUTPUT_FILES = 25_016;
const MAX_RUN_MS = 27 * 60 * 1000;

export interface LocalProjectBuildPrepared {
  projectAbs: string;
  projectRel: string;
  packageJsonSha256: string;
  packageLockSha256: string;
  nodeExeAbs: string;
  npmRootAbs: string;
  npmCacheAbs: string;
  sandboxExeAbs: string;
}
export interface LocalProjectBuildDecision {
  ok: boolean;
  reason?: string;
  prepared?: LocalProjectBuildPrepared;
}
export interface LocalProjectBuildResult {
  ok: boolean;
  tool: string;
  evidence: string;
  detail?: Record<string, unknown>;
  error?: string;
}

type TreeLimits = { maxBytes: number; maxFiles: number };
type TreeStats = { bytes: number; files: number; entries: { rel: string; size: number }[] };

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}
function isReparsePoint(st: any): boolean {
  return Boolean(st?.isSymbolicLink?.()) ||
    (typeof st?.attributes === "number" && (st.attributes & 0x400) !== 0);
}
export function isSafeSandboxEntryName(name: string): boolean {
  if (!name || name === "." || name === ".." || /[<>:"\/\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name)) return false;
  const base = name.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) return false;
  return true;
}

/** Secrets, package-manager state, prior outputs and link-based escapes never enter the VM. */
export function isExcludedProjectPath(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const lower = parts.map((part) => part.toLowerCase());
  const blockedDirectories = new Set([
    ".git", "node_modules", ".next", "dist", "build", "out", "coverage",
    ".turbo", ".cache", ".npm", ".yarn", ".pnpm-store",
    ".jarvis-build-results", ".jarvis-sandbox-runs",
    ".ssh", ".aws", ".azure", ".docker", ".kube", ".gnupg",
    "secrets", "credentials",
  ]);
  if (lower.some((part) => blockedDirectories.has(part))) return true;
  const base = lower[lower.length - 1] ?? "";
  if (base.startsWith(".env") || base === ".npmrc" || base === ".yarnrc" ||
      base === ".yarnrc.yml" || base === ".pypirc" || base === ".netrc" ||
      base === "credentials.json" || base === "service-account.json" ||
      base === "id_rsa" || base === "id_ed25519") return true;
  if (/\.(pem|key|pfx|p12|kdbx|sqlite|sqlite3|db|log)$/i.test(base)) return true;
  return false;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function createWindowsSandboxConfig(paths: {
  input: string; tools: string; cache: string; output: string;
}): string {
  const rows = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Configuration>",
    "  <vGPU>Disable</vGPU>",
    "  <Networking>Disable</Networking>",
    "  <ClipboardRedirection>Disable</ClipboardRedirection>",
    "  <PrinterRedirection>Disable</PrinterRedirection>",
    "  <AudioInput>Disable</AudioInput>",
    "  <VideoInput>Disable</VideoInput>",
    "  <ProtectedClient>Enable</ProtectedClient>",
    "  <MemoryInMB>4096</MemoryInMB>",
    "  <MappedFolders>",
    "    <MappedFolder><HostFolder>" + xmlEscape(paths.input) +
      "</HostFolder><SandboxFolder>C:\\JARVIS\\Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>",
    "    <MappedFolder><HostFolder>" + xmlEscape(paths.tools) +
      "</HostFolder><SandboxFolder>C:\\JARVIS\\Tools</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>",
    "    <MappedFolder><HostFolder>" + xmlEscape(paths.cache) +
      "</HostFolder><SandboxFolder>C:\\JARVIS\\CacheInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>",
    "    <MappedFolder><HostFolder>" + xmlEscape(paths.output) +
      "</HostFolder><SandboxFolder>C:\\JARVIS\\Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>",
    "  </MappedFolders>",
    "  <LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\JARVIS\\Tools\\run.ps1</Command></LogonCommand>",
    "</Configuration>",
    "",
  ];
  return rows.join("\r\n");
}

/** Trusted guest bootstrap; project-controlled commands execute only inside the VM. */
export function createWindowsSandboxGuestScript(): string {
  const rows = [
    "$ErrorActionPreference = 'Stop'",
    "$node = 'C:\\JARVIS\\Tools\\node.exe'",
    "$npm = 'C:\\JARVIS\\Tools\\npm\\bin\\npm-cli.js'",
    "$work = 'C:\\JARVIS\\Work'",
    "$cache = 'C:\\JARVIS\\Cache'",
    "$output = 'C:\\JARVIS\\Output'",
    "$resultPath = Join-Path $output 'result.json'",
    "$result = [ordered]@{ status = 'failed'; exitCode = 1; artifactKind = ''; error = 'Build did not complete' }",
    "$pushed = $false",
    "function Stop-Tree([int]$ProcessId) {",
    "  try { & \"$env:SystemRoot\\System32\\taskkill.exe\" /PID $ProcessId /T /F *> $null } catch {}",
    "}",
    "function Get-TreeStats([string]$Root) {",
    "  $all = @(Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction Stop)",
    "  $files = @($all | Where-Object { -not $_.PSIsContainer })",
    "  foreach ($entry in $all) {",
    "    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point in build tree' }",
    "  }",
    "  $bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)",
    "  return @{ files = $files.Count; bytes = $bytes }",
    "}",
    "function Invoke-BoundedNode([string[]]$Arguments, [int]$LimitSeconds) {",
    "  $proc = Start-Process -FilePath $node -ArgumentList $Arguments -WorkingDirectory $work -NoNewWindow -PassThru",
    "  $deadline = [DateTime]::UtcNow.AddSeconds($LimitSeconds)",
    "  try {",
    "    while (-not $proc.HasExited) {",
    "      $proc.Refresh()",
    "      if ($proc.HasExited) { break }",
    "      if ([DateTime]::UtcNow -gt $deadline) { Stop-Tree $proc.Id; throw 'Build process time limit exceeded' }",
    "      $stats = Get-TreeStats $work",
    "      if ($stats.bytes -gt 2147483648 -or $stats.files -gt 50000) { Stop-Tree $proc.Id; throw 'Build workspace quota exceeded' }",
    "      Start-Sleep -Milliseconds 1000",
    "    }",
    "    $proc.Refresh()",
    "    if ($proc.ExitCode -ne 0) { throw ('Node/npm command failed with exit code ' + $proc.ExitCode) }",
    "  } finally {",
    "    if (-not $proc.HasExited) { Stop-Tree $proc.Id }",
    "  }",
    "}",
    "try {",
    "  New-Item -ItemType Directory -Force -Path $work, $cache, $output | Out-Null",
    "  $copy = Start-Process -FilePath \"$env:SystemRoot\\System32\\robocopy.exe\" -ArgumentList @('C:\\JARVIS\\Input', $work, '/E', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS') -NoNewWindow -PassThru -Wait",
    "  if ($copy.ExitCode -ge 8) { throw 'Unable to stage project inside Windows Sandbox' }",
    "  $cacheInput = 'C:\\JARVIS\\CacheInput\\_cacache'",
    "  if (Test-Path -LiteralPath $cacheInput -PathType Container) {",
    "    $copy = Start-Process -FilePath \"$env:SystemRoot\\System32\\robocopy.exe\" -ArgumentList @($cacheInput, (Join-Path $cache '_cacache'), '/E', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS') -NoNewWindow -PassThru -Wait",
    "    if ($copy.ExitCode -ge 8) { throw 'Unable to stage offline npm cache' }",
    "  }",
    "  $env:PATH = 'C:\\JARVIS\\Tools;' + $env:PATH",
    "  $env:HOME = $work",
    "  $env:USERPROFILE = $work",
    "  $env:APPDATA = Join-Path $work '.appdata'",
    "  $env:LOCALAPPDATA = Join-Path $work '.localappdata'",
    "  New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:LOCALAPPDATA | Out-Null",
    "  $env:npm_config_cache = $cache",
    "  $env:npm_config_offline = 'true'",
    "  $env:npm_config_audit = 'false'",
    "  $env:npm_config_fund = 'false'",
    "  $env:npm_config_update_notifier = 'false'",
    "  $env:CI = '1'",
    "  $env:NODE_ENV = 'production'",
    "  Push-Location $work",
    "  $pushed = $true",
    "  Invoke-BoundedNode @($npm, '--offline', '--cache', $cache, 'ci', '--no-audit', '--no-fund') 600",
    "  Invoke-BoundedNode @($npm, '--offline', '--cache', $cache, 'run', 'build') 900",
    "  $kind = ''",
    "  if (Test-Path -LiteralPath (Join-Path $work '.next\\BUILD_ID') -PathType Leaf) { $kind = '.next' }",
    "  elseif (Test-Path -LiteralPath (Join-Path $work 'dist\\index.html') -PathType Leaf) { $kind = 'dist' }",
    "  elseif (Test-Path -LiteralPath (Join-Path $work 'build\\index.html') -PathType Leaf) { $kind = 'build' }",
    "  elseif (Test-Path -LiteralPath (Join-Path $work 'out\\index.html') -PathType Leaf) { $kind = 'out' }",
    "  if (-not $kind) { throw 'Build exited zero but no supported artifact marker was found' }",
    "  $artifactRoot = Join-Path $work $kind",
    "  $stats = Get-TreeStats $artifactRoot",
    "  if ($stats.files -lt 1 -or $stats.files -gt 25000 -or $stats.bytes -gt 536870912) { throw 'Build artifact exceeds file/size quota' }",
    "  $copy = Start-Process -FilePath \"$env:SystemRoot\\System32\\robocopy.exe\" -ArgumentList @($artifactRoot, (Join-Path $output 'artifact'), '/E', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS') -NoNewWindow -PassThru -Wait",
    "  if ($copy.ExitCode -ge 8) { throw 'Unable to export build artifact' }",
    "  $result.status = 'ok'",
    "  $result.exitCode = 0",
    "  $result.artifactKind = $kind",
    "  $result.artifactFiles = $stats.files",
    "  $result.artifactBytes = $stats.bytes",
    "} catch {",
    "  $result.status = 'failed'",
    "  $result.exitCode = 1",
    "  $result.error = ([string]$_.Exception.Message).Substring(0, [Math]::Min(500, ([string]$_.Exception.Message).Length))",
    "} finally {",
    "  if ($pushed) { try { Pop-Location } catch {} }",
    "  try { $result | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8 } catch {}",
    "  Start-Sleep -Milliseconds 500",
    "  try { & \"$env:SystemRoot\\System32\\shutdown.exe\" /s /t 0 /f *> $null } catch {}",
    "}",
    "",
  ];
  return rows.join("\r\n");
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
async function regularFile(file: string, maxBytes: number): Promise<Buffer> {
  const st = await fs.lstat(file);
  if (!st.isFile() || isReparsePoint(st) || st.size > maxBytes) {
    throw new Error("Required file is not a bounded regular file");
  }
  return fs.readFile(file);
}
async function requireDirectory(dir: string): Promise<string> {
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || isReparsePoint(st)) throw new Error("Expected a real directory");
  return fs.realpath(dir);
}
async function treeCopy(
  source: string,
  destination: string,
  limits: TreeLimits,
  exclude?: (relativePath: string) => boolean,
  isCancelled?: () => boolean,
): Promise<TreeStats> {
  const sourceRoot = await requireDirectory(source);
  await fs.mkdir(destination, { recursive: false });
  const stats: TreeStats = { bytes: 0, files: 0, entries: [] };
  async function visit(src: string, dst: string, relative: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (isCancelled?.()) throw new Error("Build cancelled during file snapshot");
      if (!isSafeSandboxEntryName(entry.name)) throw new Error("Unsafe filename in project snapshot");
      const childRel = relative ? relative + "/" + entry.name : entry.name;
      if (exclude?.(childRel)) continue;
      const srcChild = path.join(src, entry.name);
      const dstChild = path.join(dst, entry.name);
      const st = await fs.lstat(srcChild);
      if (isReparsePoint(st)) throw new Error("Symbolic link/reparse point rejected in build input");
      if (st.isDirectory()) {
        await fs.mkdir(dstChild, { recursive: false });
        await visit(srcChild, dstChild, childRel);
        continue;
      }
      if (!st.isFile() || st.nlink > 1) throw new Error("Non-regular or hard-linked build input rejected");
      stats.files++;
      stats.bytes += st.size;
      if (stats.files > limits.maxFiles || stats.bytes > limits.maxBytes) {
        throw new Error("Build input exceeds bounded snapshot quota");
      }
      await fs.copyFile(srcChild, dstChild);
      stats.entries.push({ rel: childRel, size: st.size });
    }
  }
  await visit(sourceRoot, destination, "");
  return stats;
}
async function measureDirectory(
  root: string, limits: TreeLimits, isCancelled?: () => boolean,
): Promise<TreeStats> {
  const rootReal = await requireDirectory(root);
  const stats: TreeStats = { bytes: 0, files: 0, entries: [] };
  async function visit(dir: string, relative: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isCancelled?.()) throw new Error("Build cancelled during output inspection");
      if (!isSafeSandboxEntryName(entry.name)) throw new Error("Unsafe output filename");
      const childRel = relative ? relative + "/" + entry.name : entry.name;
      const child = path.join(dir, entry.name);
      const st = await fs.lstat(child);
      if (isReparsePoint(st)) throw new Error("Reparse point rejected in sandbox output");
      if (st.isDirectory()) {
        await visit(child, childRel);
      } else if (st.isFile() && st.nlink <= 1) {
        stats.files++;
        stats.bytes += st.size;
        if (stats.files > limits.maxFiles || stats.bytes > limits.maxBytes) {
          throw new Error("Sandbox output exceeded bounded file/size quota");
        }
        stats.entries.push({ rel: childRel, size: st.size });
      } else {
        throw new Error("Non-regular sandbox output rejected");
      }
    }
  }
  await visit(rootReal, "");
  return stats;
}
async function copyRegularFile(source: string, destination: string, maxBytes: number): Promise<void> {
  const st = await fs.lstat(source);
  if (!st.isFile() || isReparsePoint(st) || st.size > maxBytes) throw new Error("Runtime file rejected");
  await fs.copyFile(source, destination);
}
async function locateRuntime(): Promise<{
  nodeExe: string; npmRoot: string; npmCache: string; sandboxExe: string;
}> {
  const nodeExe = await fs.realpath(process.execPath);
  const nodeStat = await fs.lstat(nodeExe);
  if (!nodeStat.isFile() || isReparsePoint(nodeStat)) throw new Error("Node runtime is not a regular file");
  const npmRootCandidate = path.join(path.dirname(nodeExe), "node_modules", "npm");
  const npmRoot = await requireDirectory(npmRootCandidate);
  const npmCli = await regularFile(path.join(npmRoot, "bin", "npm-cli.js"), 2 * 1024 * 1024);
  if (!npmCli.length) throw new Error("npm CLI unavailable");
  const cacheCandidate = process.env.npm_config_cache ||
    path.join(process.env.LOCALAPPDATA || os.homedir(), "npm-cache");
  const npmCache = path.resolve(cacheCandidate);
  const sandboxExe = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsSandbox.exe");
  const sandboxStat = await fs.lstat(sandboxExe);
  if (!sandboxStat.isFile() || isReparsePoint(sandboxStat)) throw new Error("Windows Sandbox is not installed");
  return { nodeExe, npmRoot, npmCache, sandboxExe };
}

export async function prepareLocalProjectBuild(
  args: Record<string, unknown>,
): Promise<LocalProjectBuildDecision> {
  if (Object.keys(args).some((key) => key !== "project")) {
    return { ok: false, reason: "local_project_build accepts only a workspace-relative project path" };
  }
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS === "true") {
    return { ok: false, reason: "Local project builds require an interactive Windows host; CI is not a fallback" };
  }
  if (process.env[ENABLE_FLAG] !== "1") {
    return { ok: false, reason: "Local project build is disabled; operator must set " + ENABLE_FLAG + "=1" };
  }
  const scoped = resolveScopedPath(args.project);
  if (!scoped.ok || !scoped.abs || !scoped.rel) {
    return { ok: false, reason: scoped.reason || "Invalid project path" };
  }
  try {
    const workspaceReal = await fs.realpath(WORKSPACE_ROOT);
    const projectReal = await fs.realpath(scoped.abs);
    if (!within(workspaceReal, projectReal)) {
      return { ok: false, reason: "Project must be a concrete directory strictly inside the JARVIS workspace" };
    }
    const projectStat = await fs.lstat(scoped.abs);
    if (!projectStat.isDirectory() || isReparsePoint(projectStat)) {
      return { ok: false, reason: "Project path must be a real directory, not a link or reparse point" };
    }
    const packageBytes = await regularFile(path.join(projectReal, "package.json"), 1024 * 1024);
    const lockBytes = await regularFile(path.join(projectReal, "package-lock.json"), 16 * 1024 * 1024);
    const manifest = JSON.parse(packageBytes.toString("utf8")) as {
      scripts?: { build?: unknown };
    };
    const lock = JSON.parse(lockBytes.toString("utf8")) as { lockfileVersion?: unknown };
    if (typeof manifest.scripts?.build !== "string" ||
        !manifest.scripts.build.trim() || manifest.scripts.build.length > 2000) {
      return { ok: false, reason: "Project must declare a bounded npm scripts.build command" };
    }
    if (!Number.isInteger(lock.lockfileVersion) ||
        (lock.lockfileVersion as number) < 1 || (lock.lockfileVersion as number) > 3) {
      return { ok: false, reason: "Project requires a supported package-lock.json (lockfileVersion 1–3)" };
    }
    const runtime = await locateRuntime();
    return {
      ok: true,
      prepared: {
        projectAbs: projectReal,
        projectRel: scoped.rel,
        packageJsonSha256: sha256(packageBytes),
        packageLockSha256: sha256(lockBytes),
        nodeExeAbs: runtime.nodeExe,
        npmRootAbs: runtime.npmRoot,
        npmCacheAbs: runtime.npmCache,
        sandboxExeAbs: runtime.sandboxExe,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 300) : "Project prerequisites unavailable",
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function terminateSandbox(child: ChildProcess): Promise<void> {
  if (child.pid) {
    const taskkill = path.join(process.env.WINDIR || "C:\\Windows", "System32", "taskkill.exe");
    await new Promise<void>((resolve) => {
      execFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        shell: false, windowsHide: true, timeout: 10_000,
        env: {
          SystemRoot: process.env.SystemRoot || process.env.WINDIR,
          WINDIR: process.env.WINDIR || process.env.SystemRoot,
          PATH: path.join(process.env.WINDIR || "C:\\Windows", "System32"),
        },
      }, () => resolve());
    });
  }
  try { child.kill(); } catch { /* already exited */ }
}
function sandboxEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PATH = path.join(process.env.WINDIR || "C:\\Windows", "System32");
  return env;
}
async function readBoundedJson(file: string): Promise<Record<string, unknown>> {
  const bytes = await regularFile(file, 16 * 1024);
  const value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid sandbox result");
  return value as Record<string, unknown>;
}
async function ensureRealDirectory(dir: string, parent: string): Promise<string> {
  try {
    await fs.mkdir(dir, { recursive: false });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }
  const real = await requireDirectory(dir);
  const parentReal = await fs.realpath(parent);
  if (!within(parentReal, real)) throw new Error("Build result directory escaped the project");
  return real;
}
async function copyVerifiedArtifact(
  source: string,
  destination: string,
  kind: string,
  isCancelled: () => boolean,
): Promise<{ files: number; bytes: number; sha256: string }> {
  const stats = await measureDirectory(source, {
    maxBytes: MAX_ARTIFACT_BYTES, maxFiles: MAX_ARTIFACT_FILES,
  }, isCancelled);
  const required = kind === ".next" ? path.join(source, "BUILD_ID") : path.join(source, "index.html");
  const marker = await regularFile(required, 2 * 1024 * 1024);
  if (!marker.length) throw new Error("Build artifact marker is empty");
  await fs.mkdir(destination, { recursive: false });
  const copied = await treeCopy(source, destination, {
    maxBytes: MAX_ARTIFACT_BYTES, maxFiles: MAX_ARTIFACT_FILES,
  }, undefined, isCancelled);
  if (copied.files !== stats.files || copied.bytes !== stats.bytes) {
    throw new Error("Build artifact changed during host-side verification");
  }
  const digest = createHash("sha256");
  for (const entry of copied.entries.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (isCancelled()) throw new Error("Build cancelled during artifact hashing");
    const file = path.join(destination, ...entry.rel.split("/"));
    const handle = await fs.open(file, "r");
    const fileHash = createHash("sha256");
    const chunk = Buffer.alloc(1024 * 1024);
    try {
      while (true) {
        const read = await handle.read(chunk, 0, chunk.length, null);
        if (!read.bytesRead) break;
        fileHash.update(chunk.subarray(0, read.bytesRead));
      }
    } finally {
      await handle.close();
    }
    digest.update(entry.rel);
    digest.update("\0");
    digest.update(fileHash.digest("hex"));
    digest.update("\n");
  }
  return { files: copied.files, bytes: copied.bytes, sha256: digest.digest("hex") };
}

export async function executeLocalProjectBuild(
  prepared: LocalProjectBuildPrepared,
  isCancelled: () => boolean,
  register: (child: ChildProcess) => void,
): Promise<LocalProjectBuildResult> {
  const tool = "local_project_build";
  if (isCancelled()) return { ok: false, tool, evidence: "", error: "Build cancelled before sandbox launch" };
  const rechecked = await prepareLocalProjectBuild({ project: prepared.projectRel });
  if (!rechecked.ok || !rechecked.prepared) {
    return { ok: false, tool, evidence: "", error: rechecked.reason || "Project build authorization expired" };
  }
  if (rechecked.prepared.projectAbs !== prepared.projectAbs ||
      rechecked.prepared.packageJsonSha256 !== prepared.packageJsonSha256 ||
      rechecked.prepared.packageLockSha256 !== prepared.packageLockSha256) {
    return { ok: false, tool, evidence: "", error: "Project changed after Guardian authorization; request a fresh build plan" };
  }

  let stageRoot = "";
  let partialResultRoot = "";
  let keepResult = false;
  let childClosed = false;
  let childCode: number | null = null;
  let keepStage = false;
  const runId = randomUUID();
  try {
    const workspaceReal = await fs.realpath(WORKSPACE_ROOT);
    stageRoot = await fs.mkdtemp(path.join(workspaceReal, ".jarvis-sandbox-run-"));
    const input = path.join(stageRoot, "input");
    const tools = path.join(stageRoot, "tools");
    const cacheInput = path.join(stageRoot, "cache-input");
    const output = path.join(stageRoot, "output");
    await fs.mkdir(input);
    await fs.mkdir(tools);
    await fs.mkdir(cacheInput);
    await fs.mkdir(output);

    if (isCancelled()) return { ok: false, tool, evidence: "", error: "Build cancelled before source snapshot" };
    const sourceStats = await treeCopy(
      prepared.projectAbs, input,
      { maxBytes: MAX_SOURCE_BYTES, maxFiles: MAX_FILES },
      isExcludedProjectPath,
      isCancelled,
    );
    const packageAfterCopy = await regularFile(path.join(input, "package.json"), 1024 * 1024);
    const lockAfterCopy = await regularFile(path.join(input, "package-lock.json"), 16 * 1024 * 1024);
    if (sha256(packageAfterCopy) !== prepared.packageJsonSha256 ||
        sha256(lockAfterCopy) !== prepared.packageLockSha256) {
      throw new Error("Project manifest changed while its immutable build snapshot was being staged");
    }

    await copyRegularFile(prepared.nodeExeAbs, path.join(tools, "node.exe"), 64 * 1024 * 1024);
    await treeCopy(prepared.npmRootAbs, path.join(tools, "npm"), {
      maxBytes: MAX_RUNTIME_BYTES, maxFiles: 20_000,
    }, undefined, isCancelled);
    const cacheRoot = await fs.realpath(prepared.npmCacheAbs).catch(() => "");
    if (cacheRoot) {
      const cacache = path.join(cacheRoot, "_cacache");
      try {
        await treeCopy(cacache, path.join(cacheInput, "_cacache"), {
          maxBytes: MAX_CACHE_BYTES, maxFiles: 100_000,
        }, undefined, isCancelled);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await fs.mkdir(path.join(cacheInput, "_cacache"));
      }
    } else {
      await fs.mkdir(path.join(cacheInput, "_cacache"));
    }

    const guestScript = createWindowsSandboxGuestScript();
    await fs.writeFile(path.join(tools, "run.ps1"), guestScript, { encoding: "utf8", flag: "wx" });
    const wsb = createWindowsSandboxConfig({ input, tools, cache: cacheInput, output });
    const wsbPath = path.join(stageRoot, "jarvis-project-build.wsb");
    await fs.writeFile(wsbPath, wsb, { encoding: "utf8", flag: "wx" });

    let resolveLaunch!: (value: {
      error: Error | null; code: number | null; stdout: string; stderr: string;
    }) => void;
    const launchPromise = new Promise<{
      error: Error | null; code: number | null; stdout: string; stderr: string;
    }>((resolve) => { resolveLaunch = resolve; });
    const launchedChild = execFile(prepared.sandboxExeAbs, [wsbPath], {
      cwd: workspaceReal,
      env: sandboxEnvironment(),
      shell: false,
      windowsHide: false,
      timeout: 0,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      childClosed = true;
      childCode = typeof (error as any)?.code === "number" ? (error as any).code :
        error ? 1 : 0;
      resolveLaunch({
        error: error ?? null,
        code: childCode,
        stdout: String(stdout || "").slice(-2000),
        stderr: String(stderr || "").slice(-2000),
      });
    });
    register(launchedChild);

    const startedAt = Date.now();
    let quotaFailure = "";
    while (!childClosed) {
      if (isCancelled()) {
        await terminateSandbox(launchedChild);
        break;
      }
      if (Date.now() - startedAt > MAX_RUN_MS) {
        quotaFailure = "Windows Sandbox build exceeded the 27-minute deadline";
        await terminateSandbox(launchedChild);
        break;
      }
      try {
        const current = await measureDirectory(output, {
          maxBytes: MAX_OUTPUT_BYTES, maxFiles: MAX_OUTPUT_FILES,
        }, isCancelled);
        if (current.bytes > MAX_OUTPUT_BYTES || current.files > MAX_OUTPUT_FILES) {
          quotaFailure = "Sandbox output quota exceeded";
          await terminateSandbox(launchedChild);
          break;
        }
      } catch (error) {
        quotaFailure = error instanceof Error ? error.message : "Invalid sandbox output";
        await terminateSandbox(launchedChild);
        break;
      }
      await delay(750);
    }
    if (!childClosed) {
      const waitUntil = Date.now() + 10_000;
      while (!childClosed && Date.now() < waitUntil) await delay(100);
    }
    if (!childClosed) {
      keepStage = true;
      return {
        ok: false, tool, evidence: "Windows Sandbox shutdown could not be confirmed",
        detail: { runId, outcomeUnknown: true, stagingRetained: true },
        error: "Sandbox process remains active after termination request; close Windows Sandbox manually. Do not blindly retry.",
      };
    }
    const launch = await launchPromise;
    if (isCancelled()) {
      return { ok: false, tool, evidence: "Windows Sandbox process exited after cancellation", error: "Build cancelled" };
    }
    if (quotaFailure) return { ok: false, tool, evidence: "", error: quotaFailure };
    if (launch.error || launch.code !== 0) {
      return {
        ok: false, tool, evidence: "Windows Sandbox did not complete successfully",
        detail: { runId, exitCode: launch.code, stderr: launch.stderr },
        error: "Windows Sandbox launch/guest shutdown failed",
      };
    }

    const guestResult = await readBoundedJson(path.join(output, "result.json"));
    if (guestResult.status !== "ok" || guestResult.exitCode !== 0 ||
        ![".next", "dist", "build", "out"].includes(String(guestResult.artifactKind)) ||
        !Number.isInteger(guestResult.artifactFiles) || !Number.isInteger(guestResult.artifactBytes)) {
      return {
        ok: false, tool, evidence: "Sandboxed npm install/build did not produce a verified success receipt",
        detail: { runId, guestError: String(guestResult.error || "Unknown guest failure").slice(0, 300) },
        error: "Offline dependency install or project build failed inside Windows Sandbox",
      };
    }
    const kind = String(guestResult.artifactKind);
    const outputArtifact = path.join(output, "artifact");
    const parent = await fs.realpath(prepared.projectAbs);
    const resultsRoot = await ensureRealDirectory(path.join(parent, ".jarvis-build-results"), parent);
    const runRoot = path.join(resultsRoot, runId);
    partialResultRoot = runRoot;
    await fs.mkdir(runRoot, { recursive: false });
    const artifactRoot = path.join(runRoot, "artifact");
    if (isCancelled()) return { ok: false, tool, evidence: "", error: "Build cancelled before artifact collection" };
    const artifact = await copyVerifiedArtifact(outputArtifact, artifactRoot, kind, isCancelled);
    if (isCancelled()) return { ok: false, tool, evidence: "", error: "Build cancelled during artifact collection" };
    if (artifact.files !== guestResult.artifactFiles || artifact.bytes !== guestResult.artifactBytes) {
      throw new Error("Host artifact count/size does not match the guest build receipt");
    }
    const receipt = {
      schemaVersion: 1,
      runId,
      project: prepared.projectRel,
      action: "npm ci --offline && npm run build",
      sandbox: "Windows Sandbox; networking, clipboard, printer, audio, video and vGPU disabled",
      artifactKind: kind,
      artifactFiles: artifact.files,
      artifactBytes: artifact.bytes,
      artifactManifestSha256: artifact.sha256,
      packageJsonSha256: prepared.packageJsonSha256,
      packageLockSha256: prepared.packageLockSha256,
      sourceSnapshotFiles: sourceStats.files,
      sourceSnapshotBytes: sourceStats.bytes,
      completedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(runRoot, "build-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", {
      encoding: "utf8", flag: "wx",
    });
    keepResult = true;
    return {
      ok: true, tool,
      evidence: "npm dependencies installed offline and the project build completed inside Windows Sandbox; artifact tree independently copied and hashed on the host",
      detail: {
        runId,
        project: prepared.projectRel,
        artifactPath: path.relative(WORKSPACE_ROOT, artifactRoot).replace(/\\/g, "/"),
        receiptPath: path.relative(WORKSPACE_ROOT, path.join(runRoot, "build-receipt.json")).replace(/\\/g, "/"),
        artifactKind: kind,
        artifactFiles: artifact.files,
        artifactBytes: artifact.bytes,
        artifactManifestSha256: artifact.sha256,
        packageJsonSha256: prepared.packageJsonSha256,
        packageLockSha256: prepared.packageLockSha256,
        sourceSnapshotFiles: sourceStats.files,
        sourceSnapshotBytes: sourceStats.bytes,
        sandboxed: true,
        networkDisabled: true,
      },
    };
  } catch (error) {
    return {
      ok: false, tool, evidence: "",
      error: isCancelled() ? "Build cancelled" :
        error instanceof Error ? error.message.slice(0, 500) : "Local project build failed closed",
    };
  } finally {
    if (partialResultRoot && !keepResult) {
      await fs.rm(partialResultRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
    }
    if (stageRoot && !keepStage) {
      await fs.rm(stageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
    }
  }
}
