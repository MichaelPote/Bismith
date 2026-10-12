import type { PostDef } from './types'
import { tonemapPost } from './tonemap'
import { glowPost } from './glow'
import { blurPost } from './blur'
import { gradePost } from './grade'
import { sharpenPost } from './sharpen'
import { pixelatePost } from './pixelate'
import { palettePost } from './palettize'

/** Every post filter type, in add-menu order (also the usual stack order: HDR filters, tonemap, then LDR). */
export const POSTS: PostDef[] = [glowPost, blurPost, tonemapPost, gradePost, sharpenPost, pixelatePost, palettePost]
