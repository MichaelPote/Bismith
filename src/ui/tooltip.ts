// Tooltips (Tippy.js, Cinderforge theme in styles/base.css): `v-tip="'text'"` or `v-tip="{ title, body, list, meta }"`.
// The argument picks the side: `v-tip:right="…"` (default left — the inspector sits on the right edge, so tips open
// over the viewport instead of covering fields). Content is built as DOM text, never parsed as HTML.

import tippy, { type Instance, type Placement } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import type { Directive } from 'vue'

export interface Tip {
  title?: string
  body?: string
  /** Term / description pairs, e.g. the options of a dropdown. */
  list?: [string, string][]
  /** Small mono footer, e.g. the param key and its default. */
  meta?: string
}

export type TipValue = string | Tip | null | undefined

/** What last triggered each tip (mouseenter / focus). */
const lastTrigger = new WeakMap<Instance, string>()

tippy.setDefaultProps({
  theme: 'cinder',
  arrow: false,
  delay: [450, 0],
  duration: [120, 60],
  offset: [0, 8],
  maxWidth: 300,
  appendTo: () => document.body,
  onTrigger: (instance, event) => void lastTrigger.set(instance, event.type),
  // Focus shows a tip only when it is keyboard focus, not when a click or a script moves focus (a menu focusing its
  // first item would otherwise pop that item's tip up unasked).
  onShow: (instance) => (lastTrigger.get(instance) === 'focus' && !instance.reference.matches(':focus-visible') ? false : undefined),
})

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function render(v: TipValue): HTMLElement | null {
  if (!v) return null
  const t: Tip = typeof v === 'string' ? { body: v } : v
  if (!t.title && !t.body && !t.list?.length && !t.meta) return null
  const root = el('div', 'tip')
  if (t.title) root.append(el('div', 'tip-title', t.title))
  if (t.body) root.append(el('div', t.title ? 'tip-body' : 'tip-text', t.body))
  if (t.list?.length) {
    const ul = el('ul', 'tip-list')
    for (const [term, desc] of t.list) {
      const li = el('li', '')
      li.append(el('b', '', term), document.createTextNode(desc ? ` — ${desc}` : ''))
      ul.append(li)
    }
    root.append(ul)
  }
  if (t.meta) root.append(el('div', 'tip-meta', t.meta))
  return root
}

type TipEl = HTMLElement & { _tip?: Instance; _tipKey?: string }

function apply(node: TipEl, value: TipValue, placement: Placement): void {
  const key = JSON.stringify(value ?? null) + placement
  if (node._tipKey === key) return
  node._tipKey = key
  const content = render(value)
  if (!content) {
    node._tip?.destroy()
    node._tip = undefined
    return
  }
  if (node._tip) {
    node._tip.setContent(content)
    node._tip.setProps({ placement })
  } else {
    node._tip = tippy(node, { content, placement })
  }
}

export const vTip: Directive<TipEl, TipValue> = {
  mounted: (node, b) => apply(node, b.value, (b.arg as Placement) || 'left'),
  updated: (node, b) => apply(node, b.value, (b.arg as Placement) || 'left'),
  beforeUnmount(node) {
    node._tip?.destroy()
    node._tip = undefined
  },
}
