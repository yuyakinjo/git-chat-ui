function fallbackCopyTextToClipboard(text: string): boolean {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      if (fallbackCopyTextToClipboard(text)) {
        return;
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(String(error), { cause: error });
    }
  }

  if (fallbackCopyTextToClipboard(text)) {
    return;
  }

  throw new Error("Clipboard API is not available.");
}
