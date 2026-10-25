// Capture a trimmed DOM snapshot of the current page, cheap enough to send to the
// backend agent and small enough to stay inside a reasonable token budget.
//
// Strategy: clone <html>, strip scripts / styles / comments / clearly-hidden nodes,
// drop noisy attributes and over-long attribute values, then serialize and hard-cap
// the total size. We keep structure, ids, classes, roles, aria, and visible text —
// the things the agent needs to write correct selectors.

const MAX_CHARS = 60_000;
const MAX_ATTR_LEN = 200;

// Attributes worth keeping for selector-writing; everything else is dropped to save space.
const KEEP_ATTRS = new Set([
  'id',
  'class',
  'role',
  'name',
  'type',
  'href',
  'src',
  'alt',
  'title',
  'placeholder',
  'value',
  'aria-label',
  'aria-labelledby',
  'aria-hidden',
  'data-testid',
  'for',
]);

const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'SVG', 'PATH', 'CANVAS']);

function isHidden(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.hidden) return true;
  const style = window.getComputedStyle(he);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  // Drop fully collapsed, non-structural nodes (but keep the body even if 0-size early).
  return false;
}

function clean(node: Node, into: Node): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.COMMENT_NODE) return;

    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ');
      if (text.trim()) into.appendChild(document.createTextNode(text));
      return;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    if (DROP_TAGS.has(el.tagName)) return;

    let hidden = false;
    try {
      hidden = isHidden(el);
    } catch {
      hidden = false;
    }
    if (hidden) return;

    const copy = document.createElement(el.tagName.toLowerCase());
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP_ATTRS.has(attr.name) && !attr.name.startsWith('data-')) continue;
      let v = attr.value;
      if (v.length > MAX_ATTR_LEN) v = v.slice(0, MAX_ATTR_LEN) + '…';
      copy.setAttribute(attr.name, v);
    }
    clean(el, copy);
    into.appendChild(copy);
  });
}

export function captureSnapshot(): string {
  const root = document.body ?? document.documentElement;
  const container = document.createElement('body');
  try {
    clean(root, container);
  } catch {
    // If anything throws mid-walk, fall back to a truncated outerHTML.
    return (document.body?.outerHTML ?? '').slice(0, MAX_CHARS);
  }
  let html = container.innerHTML;
  if (html.length > MAX_CHARS) {
    html = html.slice(0, MAX_CHARS) + '\n<!-- …snapshot truncated… -->';
  }
  return html;
}
