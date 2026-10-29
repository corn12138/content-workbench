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
