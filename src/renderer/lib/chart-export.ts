/**
 * Chart export helpers — convert recharts-rendered SVG into a portable
 * data URI suitable for embedding in HTML print previews where the live
 * recharts ResponsiveContainer would collapse.
 *
 * Pure browser code — no Node / Electron-main dependency.
 */

/**
 * Serialize an inline `<svg>` element to a data URI.
 *
 * Recharts mounts charts as a `<div class="recharts-wrapper">` containing
 * one `<svg class="recharts-surface">`. Pass either the wrapper or the
 * surface; we'll find the surface either way.
 */
export function chartToImage(svgOrWrapper: SVGSVGElement | HTMLElement | null): string {
  if (!svgOrWrapper) return '';

  const svg =
    svgOrWrapper instanceof SVGSVGElement
      ? svgOrWrapper
      : (svgOrWrapper.querySelector('svg.recharts-surface, svg') as SVGSVGElement | null);
  if (!svg) return '';

  // Clone so we can mutate width/height without disturbing the live DOM.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const bbox = svg.getBoundingClientRect();
  const width = svg.getAttribute('width') || (bbox.width || 600).toString();
  const height = svg.getAttribute('height') || (bbox.height || 300).toString();
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  const xml = new XMLSerializer().serializeToString(clone);
  // Use Unicode-safe base64 (handles non-ASCII text labels).
  const b64 =
    typeof window !== 'undefined' && typeof window.btoa === 'function'
      ? window.btoa(unescape(encodeURIComponent(xml)))
      : '';
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Find every recharts SVG in `root` and return their data URIs in DOM order.
 */
export function chartsToImages(root: HTMLElement | Document = document): string[] {
  const surfaces = Array.from(
    root.querySelectorAll('svg.recharts-surface')
  ) as SVGSVGElement[];
  return surfaces.map((s) => chartToImage(s));
}

/**
 * Open a print preview for a dashboard's HTML — landscape Letter, dark
 * theme overridden to white, all the dashboard print CSS already applied.
 *
 * Wraps the existing `print:preview` IPC. Call from the renderer.
 */
export async function printDashboard(
  html: string,
  title: string = 'Dashboard'
): Promise<{ success?: boolean }> {
  // Dynamic import keeps `lib/api` out of the unit-test surface for this file
  // (the api module pulls in window.electronAPI).
  const apiMod = await import('./api');
  return apiMod.default.printPreview(html, title);
}
