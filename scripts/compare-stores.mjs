import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { WorkbenchStore } = await tsImport(
  "../src/core/store.ts",
  import.meta.url,
);
const { validateBackup } = await tsImport(
  "../src/core/backup.ts",
  import.meta.url,
);
const root = await mkdtemp(join(tmpdir(), "workbench-parity-"));
const reportPath = join(project, "artifacts/tauri-comparison/data-parity.json");
const checks = [];
const report = {
  passed: false,
  fixtureOnly: true,
  universalCompatibility: false,
  validatedFixtureMigrationReady: false,
  checkedAt: new Date().toISOString(),
  knownLimitations: [
    "Legacy titles containing unpaired UTF-16 surrogates are rejected without converting or overwriting source data. Each real database requires its own preflight.",
  ],
  checks,
};
let currentCheck = "Build probe and create isolated fixture";
const binary =
  process.env.WORKBENCH_STORE_PROBE ||
  join(
    project,
    "src-tauri/target/debug",
    process.platform === "win32" ? "store-probe.exe" : "store-probe",
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonical(json) {
  const value =
    typeof json === "string" ? JSON.parse(json) : structuredClone(json);
  delete value.exportedAt;
  // SQLite row order and the export clock are not persisted data; all IDs and fields still compare exactly.
  for (const key of ["drafts", "readings", "publications"])
    value[key].sort((a, b) => a.id.localeCompare(b.id));
  value.revisions.sort(
    (a, b) => a.draftId.localeCompare(b.draftId) || a.revision - b.revision,
  );
  return value;
}

function probe(args, shouldSucceed = true) {
  const result = spawnSync(binary, ["--root", root, ...args], {
    cwd: project,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (shouldSucceed && result.status !== 0)
    throw new Error(`Rust probe failed: ${result.stderr.trim()}`);
  if (!shouldSucceed)
    assert.equal(
      result.status,
      1,
      "Rust probe must reject this fixture through a handled error",
    );
  return result;
}

async function readBackup(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function seed(directory) {
  const store = new WorkbenchStore(directory);
  try {
    const first = store.saveDraft({
      title: "版本对照 🦀",
      body: "# 初稿\n\n中文、emoji 🚀、组合字符 é。\n",
      project: "桌面应用",
    });
    const second = store.saveDraft({
      id: first.id,
      expectedRevision: 1,
      title: "版本对照 🦀 第二版",
      body: "# 修订\n\n```rust\nlet 保存 = true;\n```\n",
      project: "本地优先",
    });
    store.recordPublication(
      first.id,
      1,
      "https://juejin.cn/post/1234567890123456789?source=fixture#comment",
    );
    store.recordPublication(
      first.id,
      second.revision,
      "https://x.com/fixture/status/9876543210123456789",
    );
    store.restoreRevision(first.id, 1, second.revision);
    store.archiveDraft(first.id, true);
    store.importMarkdown(
      "未分类.md",
      "# 资料快照\n\n![待接入的图片](./image.png)\n",
    );
    const note = store.saveReading({
      url: "https://Example.com:443/docs?q=rust#细节",
      title: "来源与笔记 📖",
      note: "不要覆盖已经读过的内容。\n保留引用与证据。",
      read: true,
    });
    store.saveReading({
      url: "https://example.com/next?mode=a&mode=b",
      title: "",
      note: "",
      read: false,
    });
    store.readingToDraft(note.id);
    store.saveDraft({
      title: "🚀".repeat(200),
      body: "# Unicode 边界\n\n保留已被现有校验器接受的完整标题。\n",
      project: "",
    });
    return store.exportBackup();
  } finally {
    store.close();
  }
}

function invalidVariants(baseline) {
  const mutate = (name, fn) => {
    const value = structuredClone(baseline);
    fn(value);
    return [name, value];
  };
  return [
    mutate("future backup version", (b) => {
      b.version = 2;
    }),
    mutate("missing history", (b) => {
      b.revisions = [];
    }),
    mutate("duplicate publication", (b) => {
      b.publications.push(b.publications[0]);
    }),
    mutate("unknown top-level field", (b) => {
      b.credentials = { fixture: true };
    }),
    mutate("foreign publication revision", (b) => {
      b.publications[0].draftRevision = 999;
    }),
    mutate("Unicode title limit", (b) => {
      const draft = b.drafts[0];
      draft.title = "🚀".repeat(201);
      b.revisions.find(
        (revision) =>
          revision.draftId === draft.id && revision.revision === draft.revision,
      ).title = draft.title;
      for (const publication of b.publications) {
        if (
          publication.draftId === draft.id &&
          publication.draftRevision === draft.revision
        )
          publication.title = draft.title;
      }
    }),
    mutate("non-UTC timestamp", (b) => {
      b.drafts[0].createdAt = "2026-10-28T12:00:00+08:00";
    }),
  ];
}

function seedLegacyUnicodeEdge(directory) {
  const store = new WorkbenchStore(directory);
  try {
    // The old importer slices UTF-16 units and can split an emoji at its title limit.
    store.importMarkdown("boundary.md", `# ${"a".repeat(199)}🚀`);
    const backup = store.exportBackup();
    validateBackup(backup);
    assert(backup.includes("\\ud83d"));
    return backup;
  } finally {
    store.close();
  }
}

try {
  await writeFile(
    join(root, ".workbench-comparison-fixture"),
    "content-workbench-parity-v1",
    { mode: 0o600 },
  );
  if (!process.argv.includes("--skip-build")) {
    const build = spawnSync(
      "cargo",
      [
        "build",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--features",
        "probes",
        "--bin",
        "store-probe",
      ],
      { cwd: project, stdio: "inherit" },
    );
    if (build.status !== 0)
      throw new Error("Could not build the Rust comparison probe.");
  }
  const sourceDir = join(root, "electron-source");
  const baselineText = seed(sourceDir);
  const baseline = canonical(baselineText);
  const input = join(root, "electron-backup.json");
  await writeFile(input, baselineText);
  const sourceDatabase = join(sourceDir, "workbench.sqlite");
  const sourceHash = hash(await readFile(sourceDatabase));

  // A closed fixture database has no outstanding WAL writes. The original stays untouched.
  const copyDir = join(root, "copied-electron-database");
  await mkdir(copyDir);
  await copyFile(sourceDatabase, join(copyDir, "workbench.sqlite"));
  const nativeOutput = join(root, "rust-native-read.json");
  currentCheck = "Rust opens copied Electron SQLite without conversion";
  probe(["--inspect-db", copyDir, "--output", nativeOutput]);
  assert.deepEqual(canonical(await readBackup(nativeOutput)), baseline);
  checks.push({
    name: "Rust opens copied Electron SQLite without conversion",
    passed: true,
  });

  const rustDir = join(root, "rust-restored");
  const rustOutput = join(root, "rust-export.json");
  currentCheck = "Electron v1 backup restores and exports in Rust losslessly";
  probe(["--data", rustDir, "--input", input, "--output", rustOutput]);
  const rustBackup = await readBackup(rustOutput);
  assert.deepEqual(canonical(rustBackup), baseline);
  checks.push({
    name: "Electron v1 backup restores and exports in Rust losslessly",
    passed: true,
  });

  currentCheck = "Electron reopens Rust-written SQLite with matching data";
  const reopened = new WorkbenchStore(rustDir);
  try {
    // These lookups exercise derived SQLite keys that a JSON payload comparison cannot verify.
    const activeDraft = baseline.drafts.find((draft) => !draft.archived);
    const imported = reopened.importMarkdown("existing.md", activeDraft.body);
    assert.equal(imported.duplicate, true);
    assert.equal(imported.draft.id, activeDraft.id);
    const publication = baseline.publications.find(
      (item) => item.platform === "x",
    );
    assert.equal(
      reopened.recordPublication(
        publication.draftId,
        publication.draftRevision,
        publication.url.replace("/fixture/", "/new_handle/"),
      ).id,
      publication.id,
    );
    const reading = baseline.readings.find((item) => item.read);
    assert.deepEqual(
      reopened.saveReading({
        url: reading.url,
        title: "",
        note: "",
        read: false,
      }),
      reading,
    );
    assert.deepEqual(canonical(reopened.exportBackup()), baseline);
  } finally {
    reopened.close();
  }
  checks.push({
    name: "Electron reopens Rust-written SQLite with matching data",
    passed: true,
  });

  currentCheck =
    "Rust v1 export restores into Electron with exact IDs and references";
  const roundtrip = new WorkbenchStore(join(root, "electron-roundtrip"));
  try {
    roundtrip.restoreBackup(JSON.stringify(rustBackup));
    assert.deepEqual(canonical(roundtrip.exportBackup()), baseline);
  } finally {
    roundtrip.close();
  }
  checks.push({
    name: "Rust v1 export restores into Electron with exact IDs and references",
    passed: true,
  });

  for (const [index, [name, invalid]] of invalidVariants(
    JSON.parse(baselineText),
  ).entries()) {
    currentCheck = `Rejected backup preserves data: ${name}`;
    const json = JSON.stringify(invalid);
    assert.throws(
      () => validateBackup(json),
      `Fixture must fail existing validation: ${name}`,
    );
    const invalidPath = join(root, `invalid-${index}.json`);
    await writeFile(invalidPath, json);
    probe(
      ["--data", rustDir, "--input", invalidPath, "--output", rustOutput],
      false,
    );
    probe(["--inspect-db", rustDir, "--output", rustOutput]);
    assert.deepEqual(
      canonical(await readBackup(rustOutput)),
      baseline,
      `Rejected restore changed data: ${name}`,
    );
    checks.push({
      name: `Rejected backup preserves data: ${name}`,
      passed: true,
    });
  }

  currentCheck = "Unsupported legacy Unicode backup fails without data loss";
  const legacyDir = join(root, "legacy-unicode-source");
  const legacyInput = join(root, "legacy-unicode-backup.json");
  await writeFile(legacyInput, seedLegacyUnicodeEdge(legacyDir));
  const legacyDatabase = join(legacyDir, "workbench.sqlite");
  const legacyHash = hash(await readFile(legacyDatabase));
  probe(
    ["--data", rustDir, "--input", legacyInput, "--output", rustOutput],
    false,
  );
  probe(["--inspect-db", rustDir, "--output", rustOutput]);
  assert.deepEqual(canonical(await readBackup(rustOutput)), baseline);
  checks.push({ name: currentCheck, passed: true });

  currentCheck =
    "Unsupported copied legacy SQLite is rejected and original stays byte-identical";
  const legacyCopy = join(root, "legacy-unicode-copy");
  await mkdir(legacyCopy);
  await copyFile(legacyDatabase, join(legacyCopy, "workbench.sqlite"));
  probe(["--inspect-db", legacyCopy, "--output", rustOutput], false);
  assert.equal(hash(await readFile(legacyDatabase)), legacyHash);
  checks.push({ name: currentCheck, passed: true });

  currentCheck = "Original Electron fixture database remains byte-identical";
  assert.equal(hash(await readFile(sourceDatabase)), sourceHash);
  checks.push({
    name: "Original Electron fixture database remains byte-identical",
    passed: true,
  });
  report.passed = true;
  report.validatedFixtureMigrationReady = true;
  report.counts = Object.fromEntries(
    ["drafts", "revisions", "publications", "readings"].map((key) => [
      key,
      baseline[key].length,
    ]),
  );
  console.log(`STORE_PARITY_PASS (${checks.length} checks)`);
} catch (error) {
  checks.push({ name: currentCheck, passed: false });
  report.error = "Comparison failed; inspect command output for diagnostics.";
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
