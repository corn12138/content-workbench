import twitterText from "twitter-text";

export const sensitiveText = (text: string) =>
  /(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|token)\s*[:=]\s*["'][^"']{8,}["'])/i.test(
    text,
  );

export function checkXText(text: string) {
  const parsed = twitterText.parseTweet(text.trim());
  const localAsset = /assets\/|file:\/\/|\/Users\/|\/private\/var\//.test(text);
  return {
    length: parsed.weightedLength,
    valid: parsed.valid && !localAsset,
    localAsset,
  };
}

export function initialXText(title: string, body: string) {
  const candidate = `${title}\n\n${body}`.trim();
  // Long-form drafts can reach a million characters; avoid parsing them as a tweet on the UI thread.
  return candidate.length <= 1000 && checkXText(candidate).valid
    ? candidate
    : title.trim();
}


const patterns = {
  juejin: /^https:\/\/juejin\.cn\/post\/[0-9]+\/?(?:[?#].*)?$/,
  x: /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+\/?(?:[?#].*)?$/,
};
export function validPublicationURL(platform: "juejin" | "x", url: string) {
  return patterns[platform].test(url.trim());
}
