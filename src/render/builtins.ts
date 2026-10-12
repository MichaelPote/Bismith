// Registers every built-in layer and post filter type. Safe to call more than once.

import { registerLayer } from '@/layers/registry'
import { GENERATORS } from '@/layers/generators'
import { FILTERS } from '@/layers/filters'
import { registerPost } from './post/registry'
import { POSTS } from './post'

let done = false

export function ensureBuiltins(): void {
  if (done) return
  done = true
  for (const def of GENERATORS) registerLayer(def)
  for (const def of FILTERS) registerLayer(def)
  for (const def of POSTS) registerPost(def)
}
