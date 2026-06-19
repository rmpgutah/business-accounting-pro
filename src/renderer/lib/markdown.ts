/**
 * Tiny safe-ish markdown renderer for email previews.
 * Supports: **bold**, *italic*, `code`, links [text](url), line breaks.
 * No new dependencies — used by EmailTemplatesSettings and any preview surface.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(input: string): string {
  if (!input) return '';
  let text = escapeHtml(input);

  // Bold: **x**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *x*
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Inline code: `x`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links: [text](url) — only http(s)/mailto
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, t, u) => {
    const safeUrl = u.replace(/"/g, '');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // Paragraph breaks
  text = text.replace(/\r\n/g, '\n');
  // Convert double newlines to paragraph breaks; single newline to <br>
  const paragraphs = text.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
  return paragraphs;
}
