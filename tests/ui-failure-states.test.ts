import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSend,
  classifyPublishError,
  initialXPublishState,
  textLocked,
  xPublishReducer,
  type XPublishEvent,
  type XPublishState,
} from "../src/renderer/publishing/xOutcome";
import { reloadAfterRestore, runRestore } from "../src/renderer/restoreFlow";
import { initialUpdateState, updateFailureNotice, updateReducer, type UpdateEvent } from "../src/renderer/updates/updateState";

const run = (events: XPublishEvent[], from: XPublishState = initialXPublishState) =>
  events.reduce(xPublishReducer, from);
const receipt = { url: "https://x.com/example/status/1", recorded: true, warning: null };
const unknown = "X 未返回明确发布结果，请到个人主页核实；不要重复发送。";

test("F1: unknown X result survives a failed 'open profile'", () => {
  const state = run([
    { type: "publish" },
    { type: "publishFailed", message: unknown },
    { type: "actionFailed", message: "无法打开链接。" },
  ]);
  assert.equal(state.outcome.kind, "uncertain");
  assert.equal(state.actionError, "无法打开链接。");
  assert.equal(canSend(state.outcome), false, "no resend offered");
  assert.equal(textLocked(state.outcome), true);
  // A later publish attempt from this state is ignored, and editing does not unlock it.
  assert.equal(run([{ type: "edited" }, { type: "publish" }], state).outcome.kind, "uncertain");
});

test("F1: a receipt survives failed open/copy of the work", () => {
  for (const message of ["无法打开链接。", "复制未完成。"]) {
    const state = run([
      { type: "publish" },
      { type: "published", receipt },
      { type: "actionFailed", message },
    ]);
    assert.equal(state.outcome.kind, "published");
    assert.equal(state.actionError, message);
    assert.equal(canSend(state.outcome), false);
  }
});

test("F1: local pre-send failures are not reported as platform rejections", () => {
  for (const message of [
    "请填写有效的 X 发布内容。",
    "发布内容包含本机资源路径，请移除后再发布。",
    "内容可能包含密钥或密码，请先核对公开范围。",
    "请先连接 X 账号。",
    "账号已变化，请重新打开预览并确认发布账号。",
    "稿件已变化，请重新打开发布预览。",
    "操作未完成，请重试。",
  ])
    assert.equal(classifyPublishError(message).kind, "failed", message);
  assert.equal(classifyPublishError("X 拒绝访问，请检查应用写入权限、账号和 API 额度。").kind, "rejected");
  assert.equal(classifyPublishError("发布操作中断，请先到 X 核实结果。").kind, "uncertain");
  assert.equal(classifyPublishError("上次请求的结果尚未确认，已阻止重复发送。请打开 X 个人主页核实；若已发布，可粘贴链接记录。").kind, "uncertain");
});

test("F1: definite rejection or local failure allows a corrected attempt", () => {
  const rejected = run([{ type: "publish" }, { type: "publishFailed", message: "X 未接受请求，请检查应用配置或发布内容。" }]);
  assert.equal(rejected.outcome.kind, "rejected");
  assert.ok(canSend(rejected.outcome));
  assert.equal(run([{ type: "edited" }], rejected).outcome.kind, "idle");
  assert.equal(run([{ type: "publish" }], rejected).outcome.kind, "publishing");
  // While a request is in flight nothing starts a second one.
  assert.equal(run([{ type: "publish" }, { type: "publish" }]).outcome.kind, "publishing");
});

const counter = <T>(impl: () => Promise<T>) => {
  const fn = async () => {
    fn.calls += 1;
    return impl();
  };
  fn.calls = 0;
  return fn;
};

test("F2: restore succeeded but refresh failed; retry only refreshes", async () => {
  const restore = counter(async () => true);
  let failRefresh = true;
  const refresh = counter(async () => {
    if (failRefresh) throw new Error("资料暂时无法读取");
  });
  const first = await runRestore(restore, refresh, (e) => (e as Error).message);
  assert.deepEqual(first, { kind: "restore", state: "refreshFailed", message: "资料暂时无法读取" });
  assert.equal(restore.calls, 1);
  failRefresh = false;
  const retried = await reloadAfterRestore(refresh, (e) => (e as Error).message);
  assert.deepEqual(retried, { kind: "restore", state: "done" });
  assert.equal(restore.calls, 1, "retry must not run the restore command again");
  assert.equal(refresh.calls, 2);
});

test("F2: cancelled, rejected and completed restores stay distinct", async () => {
  const describe = (e: unknown) => (e as Error).message;
  const refresh = counter(async () => {});
  assert.deepEqual(await runRestore(async () => false, refresh, describe), { kind: "restore", state: "cancelled" });
  assert.equal(refresh.calls, 0, "cancel must not refresh");
  assert.deepEqual(
    await runRestore(async () => { throw new Error("备份校验失败"); }, refresh, describe),
    { kind: "restore", state: "failed", message: "备份校验失败" },
  );
  assert.equal(refresh.calls, 0);
  assert.deepEqual(await runRestore(async () => true, refresh, describe), { kind: "restore", state: "done" });
  assert.equal(refresh.calls, 1);
});

const updates = (events: UpdateEvent[]) => events.reduce(updateReducer, initialUpdateState);

test("F3: install failure without a no-change guarantee is reported neutrally", () => {
  const state = updates([
    { type: "checkStart", quiet: false },
    { type: "checkSucceeded", value: { version: "0.5.0", notes: "" } },
    { type: "installStart" },
    { type: "installFailed", message: "安装未完成，升级前副本已保留；请查看升级备份。" },
  ]);
  const notice = updateFailureNotice(state)!;
  assert.equal(notice.title, "升级没有完成");
  assert.ok(notice.showBackups);
  assert.doesNotMatch(`${notice.title}${notice.detail}`, /没有改动|未改动/);
  assert.equal(state.installing, false);
});

test("F3: a later successful check (background or manual) clears a stale check failure", () => {
  const failed = updates([
    { type: "checkStart", quiet: false },
    { type: "checkFailed", message: "网络不可用", quiet: false },
  ]);
  assert.equal(updateFailureNotice(failed)?.title, "检查更新未完成");
  const background = [
    { type: "checkStart", quiet: true },
    { type: "checkSucceeded", value: null },
  ] satisfies UpdateEvent[];
  const recovered = background.reduce(updateReducer, failed);
  assert.equal(recovered.error, null);
  assert.equal(updateFailureNotice(recovered), null);
  assert.equal(recovered.message, "当前已是最新版本");
  // A quiet background failure never replaces what the user sees.
  const quietFail = updateReducer(updateReducer(recovered, { type: "checkStart", quiet: true }), { type: "checkFailed", message: "x", quiet: true });
  assert.equal(quietFail.error, null);
  assert.equal(quietFail.message, "当前已是最新版本");
});

test("F3: a check does not erase an install failure the user has not dealt with", () => {
  const state = updates([
    { type: "installStart" },
    { type: "installFailed", message: "安装未完成" },
    { type: "checkStart", quiet: true },
    { type: "checkSucceeded", value: { version: "0.5.0", notes: "" } },
  ]);
  assert.equal(state.error, "install");
});

test("F1: a server failure during token refresh is not presented as a platform rejection", () => {
  // http.rs maps every non-4xx status (including 5xx from the token refresh x_publish runs first) to this text.
  const outcome = classifyPublishError("X 服务暂时不可用，请稍后重试。");
  assert.equal(outcome.kind, "failed");
  // Every message still classified as a rejection is a fixed 4xx text from http.rs `error()`.
  for (const message of [
    "X 授权已失效，请重新连接账号。",
    "X API 额度不足，请在开发者控制台检查费用与余额。",
    "X 拒绝访问，请检查应用写入权限、账号和 API 额度。",
    "X 请求过于频繁，请稍后再试。",
    "X 未接受请求，请检查应用配置或发布内容。",
  ])
    assert.equal(classifyPublishError(message).kind, "rejected", message);
});

test("F3: install failures before the backup stage are not told a backup was kept", () => {
  // Messages install_update can return before update_backup::prepare runs.
  for (const message of ["请先重新检查更新。", "更新正在进行。", "应用正在关闭，请重新打开后升级。", "无法定位应用。"]) {
    const state = updates([{ type: "installStart" }, { type: "installFailed", message }]);
    const notice = updateFailureNotice(state)!;
    assert.equal(notice.detail, message, "native message is shown as-is");
    assert.doesNotMatch(`${notice.title}${notice.guidance}`, /已保留|没有改动|未改动/, message);
    assert.ok(notice.showBackups, "the upgrade-backup entry stays available");
  }
});
