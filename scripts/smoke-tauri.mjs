import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const packaged = process.argv.includes("--packaged");
const supplied = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const binary = await realpath(resolve(supplied || "src-tauri/target/debug/content-workbench-tauri"));
const target = await realpath(resolve("src-tauri/target"));
if (!binary.startsWith(`${target}${sep}`) || basename(binary) !== "content-workbench-tauri") {
  throw new Error("Native smoke accepts only this project's Tauri executable");
}
const data = await mkdtemp(join(tmpdir(), "workbench-tauri-smoke-"));
await writeFile(join(data, ".workbench-smoke"), "content-workbench-smoke-v1\n", { mode: 0o600 });
const reports = [];
let frontend;
let failed;

async function ready() {
  try {
    const response = await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes("<title>内容工作台</title>") && html.includes('src="/src/renderer/main.tsx"');
  }
  catch { return false; }
}

async function runPhase(phase) {
  const child = spawn(binary, [], {
    env: { ...process.env, WORKBENCH_TAURI_DATA_DIR: data, WORKBENCH_TAURI_SMOKE: "1", WORKBENCH_TAURI_SMOKE_PHASE: phase },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { log = (log + chunk).slice(-8000); });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 90000);
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); }).finally(() => clearTimeout(timeout));
  let report;
  try { report = JSON.parse(await readFile(join(data, `smoke-${phase}.json`), "utf8")); }
  catch { throw new Error(`${phase}: native report missing (exit ${code}). ${log}`); }
  reports.push(report);
  if (code !== 0 || !report.passed) throw new Error(`${phase}: ${report.error || "native assertions failed"} (exit ${code})`);
  console.log(`Native Tauri ${phase}: passed`);
}

try {
  if (!packaged && !(await ready())) {
    frontend = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { stdio: "ignore" });
    const deadline = Date.now() + 20000;
    while (!(await ready())) {
      if (Date.now() > deadline || frontend.exitCode !== null) throw new Error("Frontend did not become ready for native smoke");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await runPhase("redClose");
  await runPhase("menuQuit");
} catch (error) {
  failed = String(error.message || error).replaceAll(data, "<isolated-test-directory>");
  console.error(failed);
} finally {
  frontend?.kill("SIGTERM");
  const output = resolve("artifacts/tauri-comparison");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "native-smoke.json"), JSON.stringify({ passed: !failed && reports.length === 2, cases: reports, ...(failed ? { error: failed } : {}), actualKeyboardShortcutTested: false, fixtureOnly: true }, null, 2));
  await rm(data, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
