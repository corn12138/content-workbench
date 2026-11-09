export type Shortcut = "newDraft" | "importDraft" | "togglePreview";

/**
 * Maps a key event to an app shortcut. macOS uses ⌘, other platforms Ctrl; the other modifier must
 * not be held, so system and text-editing shortcuts keep working. Input-method composition never
 * triggers a shortcut.
 */
export function shortcutFor(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "keyCode" | "repeat">,
  platform: string,
): Shortcut | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
  const mac = /mac|iphone|ipad/i.test(platform);
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary || event.altKey || event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case "n":
      return "newDraft";
    case "o":
      return "importDraft";
    case "e":
      return "togglePreview";
    default:
      return null;
  }
}

export const shortcutLabel = (platform: string, key: string) =>
  /mac|iphone|ipad/i.test(platform) ? `⌘${key}` : `Ctrl+${key}`;

/** True while the user is typing somewhere, where ⌘⌫ / Delete must keep editing text. */
export function isEditableTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset"].includes(target.type))
  );
}

/**
 * Delete key for the selected item: ⌘⌫ on macOS, Delete elsewhere. The caller must also check
 * `isEditableTarget`, because both keys edit text in fields.
 */
export function isDeleteShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "keyCode" | "repeat">,
  platform: string,
) {
  if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || event.shiftKey || event.ctrlKey) return false;
  return /mac|iphone|ipad/i.test(platform)
    ? event.metaKey && event.key === "Backspace"
    : !event.metaKey && event.key === "Delete";
}

export const deleteShortcutLabel = (platform: string) =>
  /mac|iphone|ipad/i.test(platform) ? "⌘⌫" : "Delete";
