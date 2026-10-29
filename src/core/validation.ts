import { z } from "zod";

export const MAX_BODY = 1_000_000;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const id = z.uuid();
const timestamp = z.iso.datetime();
const content = {
  title: z.string().max(200),
  body: z.string().max(MAX_BODY),
  project: z.string().max(80),
};

export const draftInputSchema = z
  .object({
    ...content,
    id: id.optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export const draftSchema = z
  .object({
    ...content,
    id,
    revision: z.number().int().positive(),
    archived: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export const revisionSchema = z
  .object({
    ...content,
    revision: z.number().int().positive(),
    savedAt: timestamp,
  })
  .strict();
export const storedRevisionSchema = revisionSchema.extend({ draftId: id });
export const publicationSchema = z
  .object({
    id,
    draftId: id,
    draftRevision: z.number().int().positive(),
    title: z.string().max(200),
    platform: z.enum(["juejin", "x"]),
    url: z.string().max(4096),
    confirmedAt: timestamp,
    confirmation: z.literal("manual"),
  })
  .strict();
export const readingInputSchema = z
  .object({
    id: id.optional(),
    url: z.string().max(4096),
    title: z.string().max(200),
    note: z.string().max(MAX_BODY),
    read: z.boolean(),
  })
  .strict();
export const readingSchema = readingInputSchema
  .extend({
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export const backupSchema = z
  .object({
    format: z.literal("content-workbench"),
    version: z.literal(1),
    exportedAt: timestamp,
    drafts: z.array(draftSchema).max(10_000),
    revisions: z.array(storedRevisionSchema).max(100_000),
    publications: z.array(publicationSchema).max(20_000),
    readings: z.array(readingSchema).max(20_000),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;

/** Store links without fetching them; retain query strings and fragments as meaningful identity. */
export function normalizeReadingUrl(raw: string): string {
  if (typeof raw !== "string" || raw.length > 4096)
    throw new Error("链接过长，请检查后重试。");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("请输入完整的 http 或 https 链接。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("只支持不含账号密码的 http 或 https 链接。");
  }
  return url.toString();
}

/** Platform identity is the post ID, not the handle or tracking parameters in a pasted URL. */
export function parsePublicationUrl(raw: string): {
  platform: "juejin" | "x";
  url: string;
  identity: string;
} {
  const url = new URL(normalizeReadingUrl(raw));
  if (url.protocol !== "https:" || url.port)
    throw new Error("请粘贴掘金或 X 的 https 文章链接。");
  const juejin =
    url.hostname === "juejin.cn" && /^\/post\/([0-9]+)\/?$/.exec(url.pathname);
  if (juejin)
    return {
      platform: "juejin",
      url: `https://juejin.cn/post/${juejin[1]}`,
      identity: `juejin:${juejin[1]}`,
    };
  const x =
    url.hostname === "x.com" &&
    /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)\/?$/.exec(url.pathname);
  if (x)
    return {
      platform: "x",
      url: `https://x.com/${x[1]}/status/${x[2]}`,
      identity: `x:${x[2]}`,
    };
  throw new Error(
    "请粘贴具体文章链接，例如 juejin.cn/post/… 或 x.com/用户名/status/…。",
  );
}

export function assertId(value: string): void {
  if (!id.safeParse(value).success)
    throw new Error("这条记录无效，请重新选择。");
}

export function parseInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
}
