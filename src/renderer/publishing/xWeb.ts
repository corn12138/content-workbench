/** X's documented Web Intent (docs.x.com, "Web Intent"): opens the normal composer for the signed-in user. */
export const X_INTENT = "https://x.com/intent/tweet";
const MAX_URL = 2000;

/** Prefilled intent URL, or null when the text is too long to pass safely in a link. */
export function xIntentURL(text: string) {
  const url = `${X_INTENT}?text=${encodeURIComponent(text.trim())}`;
  return url.length <= MAX_URL ? url : null;
}
