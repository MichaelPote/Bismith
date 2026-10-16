// Starter projects (docs/features/fr5.4-presets.md). Each preset builds a fresh Project; they double as
// optimiser seeds for reference matching.

import type { ParamValues } from '@/core/params'
import type { Layer, Light, PostFilter, Project } from '@/core/project'
import { createLayer, createLight, createPostFilter, createProject } from '@/core/serialize'
import { defaultRender } from '@/core/project'
import { addMaterial } from '@/recipes'
import { TEMPLATES } from '@/match/templates'
import { schemeAnalysis } from '@/match/schemes'
import { PRESET_PREVIEWS } from './previews'

export interface Preset {
  id: string
  name: string
  group: 'Quake-style' | 'UI surfaces' | 'Nature' | 'Basics'
  build: () => Project
}

const L = (type: string, name: string, params: ParamValues = {}): Layer => createLayer(type, params, name)
const ramp = (...colors: string[]) => ({ stops: colors.map((color, i) => ({ pos: colors.length === 1 ? 0 : i / (colors.length - 1), color })) })
const sun = (params: ParamValues, name = 'Key'): Light => ({ ...createLight('directional', params), name })
const post = (type: string, params: ParamValues = {}): PostFilter => createPostFilter(type, params)

// ------------------------------------------------------------------------------------------- Quake-style

function riveted(): Project {
  return createProject({
    name: 'Riveted plate',
    width: 64,
    height: 64,
    tileable: true,
    heightDepth: 1.5,
    base: { color: '#4b4540', roughness: 0.55, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('noise', 'Brushed grain', {
        noise: 'value', fractal: 'fbm', scale: 6, stretch: 4, octaves: 4,
        h_on: true, h_amount: 0.06, dif_on: true, dif_grad: ramp('#3a3530', '#6f665c'), r_on: true, r_a: 0.35, r_b: 0.7,
      }),
      L('noise', 'Speckle', {
        noise: 'white', h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.22, dif_grad: ramp('#000000', '#ffffff'),
      }),
      L('rect', 'Plate', { size_mode: 'inset', inset_x: 2, inset_y: 2, radius: 0, bevel: 2, profile: 'linear', aa: false, h_on: true, h_amount: 1 }),
      L('rect', 'Seam', { size_mode: 'size', width: 64, height: 1, y: 0.5, radius: 0, bevel: 0, profile: 'flat', aa: false, h_on: true, h_mode: 'subtract', h_amount: 0.6, dif_on: true, dif_src: 'flat', dif_grad: ramp('#1c1916'), dif_opacity: 0.7 }),
      L('ellipse', 'Rivets', {
        radius: 1.7, x: 0.5, y: 0.25, rep_x: 4, rep_y: 2, rep_mirror: true, bevel: 1.6, profile: 'round', aa: false,
        h_on: true, h_amount: 0.9, dif_on: true, dif_grad: ramp('#4a423b', '#a39684'), r_on: true, r_src: 'flat', r_b: 0.3,
      }),
      L('scratches', 'Scratches', {
        density: 10, len_min: 3, len_max: 10, thickness: 0.6, angle: 20, angle_jitter: 70, hard: true, clump: 0.3, breakup: 0.2,
        dif_on: true, dif_blend: 'screen', dif_opacity: 0.35, dif_grad: ramp('#000000', '#8c8070'), r_on: true, r_mode: 'min', r_a: 0.6, r_b: 0.25,
      }),
      L('cavity', 'Grime & wear', { radius: 2, wear_amount: 0.55, wear_color: '#9a8c78', dirt_amount: 0.75, dirt_color: '#14100c', noise_scale: 10 }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#8e9cab', horizon: '#a59e94', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 32, angle: 1.5, intensity: 1.5, color: '#fff1dc' })],
    },
    render: { ...defaultRender(), maxSamples: 128, bounces: 1, jitter: false },
    post: [post('tonemap', { operator: 'aces', exposure: 0.4 }), post('palette', { palette: 'quake', dither: 'none' })],
  })
}

function stoneBricks(): Project {
  return createProject({
    name: 'Stone bricks',
    width: 64,
    height: 64,
    tileable: true,
    heightDepth: 2,
    base: { color: '#2e2925', roughness: 0.85, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('noise', 'Mortar grit', { noise: 'white', h_on: true, h_amount: 0.05, dif_on: true, dif_grad: ramp('#241f1b', '#3d352e') }),
      L('bricks', 'Bricks', {
        columns: 2, rows: 4, stagger: 0.5, mortar: 2, round: 1, len_var: 0.15, wobble: 0.8, size_jitter: 0.4,
        bevel: 3, profile: 'round', aa: false, h_on: true, h_amount: 1,
        dif_on: true, dif_src: 'random', dif_grad: ramp('#4f463d', '#6e6152', '#857561'), dif_jitter: 0.25,
      }),
      L('noise', 'Stone grain', {
        noise: 'perlin', fractal: 'fbm', scale: 8, octaves: 4, m_clip: 'inside',
        h_on: true, h_amount: 0.25, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.55, dif_grad: ramp('#000000', '#ffffff'),
      }),
      L('noise', 'Pits', {
        noise: 'cells', fractal: 'none', w_even: false, w_profile: 'linear', scale: 10, sh_lo: 0.0, sh_hi: 0.25, sh_invert: true, m_clip: 'inside',
        h_on: true, h_mode: 'subtract', h_amount: 0.25, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.4, dif_grad: ramp('#ffffff', '#5a4a3a'),
      }),
      L('cavity', 'Grime & wear', { radius: 2.5, wear_amount: 0.4, wear_color: '#a89780', dirt_amount: 0.8, dirt_color: '#120e0b', noise_scale: 8 }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#7f8b97', horizon: '#9b958c', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 320, elevation: 30, angle: 2, intensity: 1.5, color: '#ffeedd' })],
    },
    render: { ...defaultRender(), maxSamples: 128, bounces: 1, jitter: false },
    post: [post('tonemap', { operator: 'aces', exposure: 0.5 }), post('palette', { palette: 'quake', dither: 'none' })],
  })
}

function cobbles(): Project {
  return createProject({
    name: 'Cobblestones',
    width: 64,
    height: 64,
    tileable: true,
    heightDepth: 2,
    base: { color: '#26221e', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('voronoi', 'Cobbles', {
        output: 'cells', scale: 5, jitter: 0.85, gap: 2, round: 2, warp: 1.5, warp_scale: 6,
        bevel: 4, profile: 'round', aa: false, h_on: true, h_amount: 1,
        dif_on: true, dif_src: 'random', dif_grad: ramp('#4a443c', '#6b6153', '#7f7464'), dif_jitter: 0.2,
        r_on: true, r_src: 'random', r_a: 0.55, r_b: 0.8,
      }),
      L('noise', 'Grain', {
        noise: 'perlin', fractal: 'fbm', scale: 10, octaves: 3, m_clip: 'inside',
        h_on: true, h_amount: 0.15, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.45, dif_grad: ramp('#000000', '#ffffff'),
      }),
      L('noise', 'Moss', {
        noise: 'perlin', fractal: 'fbm', scale: 3, octaves: 4, sh_lo: 0.55, sh_hi: 0.75, m_hmode: 'below', m_hlevel: 0.35, m_hsoft: 0.2,
        h_on: false, dif_on: true, dif_opacity: 0.8, dif_grad: ramp('#2b2a1c', '#3f4524'),
      }),
      L('cavity', 'Grime', { radius: 2, wear_amount: 0.35, dirt_amount: 0.85, noise_scale: 9 }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#8b98a5', horizon: '#a49e93', intensity: 0.35 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 300, elevation: 38, angle: 2, intensity: 1.4 })],
    },
    render: { ...defaultRender(), maxSamples: 128, bounces: 1, jitter: false },
    post: [post('tonemap', { operator: 'aces', exposure: 0.5 }), post('palette', { palette: 'quake', dither: 'none' })],
  })
}

function techPanel(): Project {
  return createProject({
    name: 'Tech panel',
    width: 64,
    height: 64,
    tileable: true,
    heightDepth: 1.5,
    base: { color: '#3b3e42', roughness: 0.5, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('noise', 'Grain', { noise: 'value', fractal: 'fbm', scale: 8, stretch: 2, octaves: 3, h_on: true, h_amount: 0.04, dif_on: true, dif_grad: ramp('#34373b', '#55595e') }),
      L('grid', 'Panel seams', {
        count_x: 2, count_y: 2, width: 1, offset_x: 0.5, offset_y: 0.5, bevel: 1, profile: 'linear', aa: false,
        h_on: true, h_mode: 'subtract', h_amount: 0.7, dif_on: true, dif_src: 'flat', dif_grad: ramp('#17191b'), dif_opacity: 0.8,
      }),
      L('rect', 'Vent', {
        size_mode: 'size', width: 20, height: 12, x: 0.25, y: 0.27, radius: 1, bevel: 1, aa: false,
        h_on: true, h_mode: 'subtract', h_amount: 0.5, dif_on: true, dif_src: 'flat', dif_grad: ramp('#202326'),
      }),
      L('stripes', 'Vent slats', {
        count: 16, angle: 0, duty: 0.5, m_clip: 'inside', bevel: 0.5, aa: false,
        h_on: true, h_mode: 'add', h_amount: 0.35, dif_on: true, dif_src: 'value', dif_grad: ramp('#202326', '#4a4e53'),
      }),
      L('rect', 'Light strip', {
        size_mode: 'size', width: 22, height: 3, x: 0.75, y: 0.75, radius: 1, bevel: 1, aa: false,
        h_on: true, h_mode: 'add', h_amount: 0.25, dif_on: true, dif_src: 'flat', dif_grad: ramp('#ffb35a'),
        e_on: true, e_src: 'flat', e_color: '#ff9019', e_intensity: 5, r_on: true, r_src: 'flat', r_b: 0.2,
      }),
      L('ellipse', 'Bolts', {
        radius: 1.5, x: 0.12, y: 0.12, rep_x: 2, rep_y: 2, rep_mirror: true, bevel: 1.4, aa: false,
        h_on: true, h_amount: 0.7, dif_on: true, dif_grad: ramp('#3e4246', '#9aa0a6'),
      }),
      L('cavity', 'Grime', { radius: 1.5, wear_amount: 0.45, wear_color: '#a7acb0', dirt_amount: 0.6, dirt_color: '#101214', noise_scale: 12 }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#8f9fb0', horizon: '#9fa3a6', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 35, angle: 1.5, intensity: 1.3, color: '#eef2f8' })],
    },
    render: { ...defaultRender(), maxSamples: 128, bounces: 2, jitter: false },
    post: [
      post('glow', { threshold: 1.5, intensity: 0.5, radius: 0.45 }),
      post('tonemap', { operator: 'aces', exposure: 0.4 }),
      post('palette', { palette: 'quake', dither: 'none' }),
    ],
  })
}

// ------------------------------------------------------------------------------------------- UI surfaces

function forgedButton(): Project {
  return createProject({
    name: 'Forged button',
    width: 192,
    height: 64,
    tileable: false,
    heightDepth: 2,
    base: { color: '#1e2124', roughness: 0.6, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('rect', 'Seat', {
        size_mode: 'inset', inset_x: 4, inset_y: 5, radius: 9, bevel: 2, profile: 'smooth',
        h_on: true, h_mode: 'subtract', h_amount: 0.35, dif_on: true, dif_src: 'flat', dif_grad: ramp('#111316'),
      }),
      L('rect', 'Key face', {
        size_mode: 'inset', inset_x: 8, inset_y: 9, radius: 6, bevel: 4, profile: 'round',
        h_on: true, h_mode: 'max', h_amount: 1, dif_on: true, dif_grad: ramp('#24282c', '#3a4046'), r_on: true, r_src: 'flat', r_b: 0.45,
      }),
      L('noise', 'Face grain', {
        noise: 'value', fractal: 'fbm', scale: 24, stretch: 6, octaves: 3, m_clip: 'inside',
        h_on: true, h_amount: 0.02, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.15, dif_grad: ramp('#000000', '#ffffff'),
      }),
      L('rect', 'Underlight', {
        size_mode: 'size', width: 110, height: 3, y: 0.78, radius: 1.5, bevel: 1, profile: 'round', sm_on: false,
        h_on: true, h_amount: 0.12, dif_on: true, dif_src: 'flat', dif_grad: ramp('#ff9019'),
        e_on: true, e_src: 'flat', e_color: '#f66e10', e_intensity: 7,
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 42, angle: 2, intensity: 1.4, color: '#fff3e2' })],
    },
    render: { ...defaultRender(), maxSamples: 256, bounces: 2 },
    post: [post('glow', { threshold: 1, intensity: 1.2, radius: 0.6, tint: '#ffb066' }), post('tonemap', { operator: 'aces', exposure: 0.5 })],
  })
}

function sunkenWell(): Project {
  return createProject({
    name: 'Sunken well',
    width: 192,
    height: 96,
    tileable: false,
    heightDepth: 2,
    base: { color: '#24282c', roughness: 0.7, specular: 0.5, height: 0.6, opacity: 1 },
    layers: [
      L('noise', 'Panel grain', { noise: 'value', fractal: 'fbm', scale: 32, stretch: 4, octaves: 3, h_on: true, h_amount: 0.015, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.12, dif_grad: ramp('#000000', '#ffffff') }),
      L('rect', 'Well', {
        size_mode: 'inset', inset_x: 14, inset_y: 14, radius: 10, corners: 'tl', corner_style: 'chamfer', bevel: 4, profile: 'cove',
        sh_invert: true, h_on: true, h_mode: 'subtract', h_src: 'flat', h_amount: 0.6, dif_on: true, dif_src: 'flat', dif_grad: ramp('#1a1d20'),
      }),
      L('rect', 'Well rim', {
        size_mode: 'inset', inset_x: 12, inset_y: 12, radius: 12, corners: 'tl', corner_style: 'chamfer', outline: 1.5, bevel: 0.75, profile: 'round', sm_on: false,
        h_on: true, h_amount: 0.15, dif_on: true, dif_src: 'flat', dif_grad: ramp('#4a5259'),
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 40, angle: 2, intensity: 1.4, color: '#fff3e2' })],
    },
    render: { ...defaultRender(), maxSamples: 256, bounces: 2 },
    post: [post('tonemap', { operator: 'aces', exposure: 0.6 })],
  })
}

function bevelledPanel(): Project {
  return createProject({
    name: 'Bevelled panel',
    width: 256,
    height: 160,
    tileable: false,
    heightDepth: 2.5,
    base: { color: '#17191c', roughness: 0.7, specular: 0.5, height: 0, opacity: 0 },
    layers: [
      L('rect', 'Frame', {
        size_mode: 'inset', inset_x: 3, inset_y: 3, radius: 8, bevel: 5, profile: 'round',
        op_on: true, op_mode: 'replace', h_on: true, h_amount: 1, dif_on: true, dif_grad: ramp('#2c3136', '#3c4349'),
      }),
      L('rect', 'Recess', {
        size_mode: 'inset', inset_x: 16, inset_y: 16, radius: 4, bevel: 3, profile: 'cove', sh_invert: true,
        h_on: true, h_mode: 'subtract', h_src: 'value', h_amount: 0.55, dif_on: true, dif_src: 'flat', dif_grad: ramp('#24282c'),
      }),
      L('noise', 'Brushing', { noise: 'value', fractal: 'fbm', scale: 16, stretch: 10, octaves: 4, h_on: true, h_amount: 0.01, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.18, dif_grad: ramp('#000000', '#ffffff'), r_on: true, r_a: 0.4, r_b: 0.65 }),
      L('cross', 'Screws', {
        size: 3, arm: 1.2, x: 0.07, y: 0.12, rep_x: 2, rep_y: 2, rep_mirror: true, rotation: 20, rep_rot: 40, sm_on: false,
        bevel: 0.5, h_on: true, h_mode: 'subtract', h_amount: 0.3, dif_on: true, dif_src: 'flat', dif_grad: ramp('#101214'),
      }),
      L('ellipse', 'Screw heads', {
        radius: 5, x: 0.07, y: 0.12, rep_x: 2, rep_y: 2, rep_mirror: true, sm_on: false, outline: 1.5, bevel: 1, profile: 'round',
        h_on: true, h_amount: 0.25, dif_on: true, dif_src: 'flat', dif_grad: ramp('#6b757d'), r_on: true, r_src: 'flat', r_b: 0.3,
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 40, angle: 2, intensity: 1.4, color: '#fff3e2' })],
    },
    render: { ...defaultRender(), maxSamples: 256, bounces: 2 },
    post: [post('tonemap', { operator: 'aces', exposure: 0.6 })],
  })
}

function emberGem(): Project {
  return createProject({
    name: 'Ember gem',
    width: 64,
    height: 64,
    tileable: false,
    heightDepth: 3,
    base: { color: '#1e2124', roughness: 0.7, specular: 1, height: 0, opacity: 0 },
    layers: [
      L('polygon', 'Setting', {
        sides: 6, radius: 26, rotation: 30, round: 2, bevel: 3, profile: 'round',
        op_on: true, h_on: true, h_amount: 0.5, dif_on: true, dif_src: 'flat', dif_grad: ramp('#4a5259'), r_on: true, r_src: 'flat', r_b: 0.35,
      }),
      L('polygon', 'Gem', {
        sides: 6, radius: 19, rotation: 30, round: 1, bevel: 12, profile: 'round',
        h_on: true, h_mode: 'add', h_amount: 0.7, dif_on: true, dif_src: 'value', dif_grad: ramp('#692205', '#e25c0a'),
        r_on: true, r_src: 'flat', r_b: 0.08, e_on: true, e_src: 'value', e_color: '#f66e10', e_intensity: 1.6,
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.4 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 45, angle: 3, intensity: 1.6, color: '#fff3e2' })],
    },
    render: { ...defaultRender(), maxSamples: 256, bounces: 2, specular: 1 },
    post: [post('glow', { threshold: 0.9, intensity: 1.0, radius: 0.6 }), post('tonemap', { operator: 'aces', exposure: 0.4 })],
  })
}

// ------------------------------------------------------------------------------------------- Nature

/** The Rock face suggestion (FR8.18) in a warm sandstone palette: steep, fractured strata casting shadows. */
function rockFace(): Project {
  const palette = ['#1c140c', '#3a2a1a', '#5a4430', '#7e6248', '#a08060', '#c0a07c', '#d8c0a0']
  const a = schemeAnalysis({ look: 'stone', accent: '#7e6248', palette }, 128, 128)
  return { ...TEMPLATES.find((t) => t.id === 'rocky')!.build(a, { palette: '' }), name: 'Rock face' }
}

/** Sunlight through a rolling sea onto a sandless floor: the Liquid material, refracted light, Gerstner waves. */
function waterCaustics(): Project {
  const p = createProject({
    name: 'Water caustics',
    width: 128,
    height: 128,
    tileable: true,
    heightDepth: 2,
    base: { color: '#04283a', roughness: 0.25, specular: 0.5, height: 0, opacity: 1 },
    layers: [],
    lighting: {
      sky: { enabled: true, zenith: '#cdeef4', horizon: '#a6d6de', intensity: 0.7 },
      ambient: { color: '#e6fbff', intensity: 0.06 },
      lights: [sun({ azimuth: 315, elevation: 62, angle: 3, intensity: 0.6, color: '#f2fcff' })],
    },
    render: { ...defaultRender(), maxSamples: 128, bounces: 1, shadows: false },
    post: [post('glow', { threshold: 0.85, intensity: 0.5, radius: 0.5 }), post('tonemap', { operator: 'aces', exposure: 0.15 })],
  })
  addMaterial(
    p,
    'liquid',
    {
      style: 'refraction',
      model: 'gerstner',
      steepness: 0.75,
      scale: 3,
      strength: 8,
      softness: 0.5,
      exposure: 0.45,
      contrast: 2,
      waves: 11,
      meander: 0.8,
      halo: 0.55,
      variety: 0.9,
      colours: ramp('#021a2b', '#06384d', '#0b5a6e', '#138388', '#2aa9a3', '#7fdcd0', '#d4fbf3'),
      glow: 0.06,
      highlight: 0.55,
      highlight_colour: '#e6fffb',
    },
    'Water caustics',
  )
  return p
}

/** A preset whose built project carries its generated preview (PRESET_PREVIEWS), when there is one. */
const withPreview = (p: Preset): Preset => {
  const preview = PRESET_PREVIEWS[p.id]
  return preview ? { ...p, build: () => ({ ...p.build(), preview }) } : p
}

export const PRESETS: Preset[] = ([
  { id: 'riveted', name: 'Riveted plate', group: 'Quake-style', build: riveted },
  { id: 'bricks', name: 'Stone bricks', group: 'Quake-style', build: stoneBricks },
  { id: 'cobbles', name: 'Cobblestones', group: 'Quake-style', build: cobbles },
  { id: 'tech', name: 'Tech panel', group: 'Quake-style', build: techPanel },
  { id: 'button', name: 'Forged button', group: 'UI surfaces', build: forgedButton },
  { id: 'well', name: 'Sunken well', group: 'UI surfaces', build: sunkenWell },
  { id: 'panel', name: 'Bevelled panel', group: 'UI surfaces', build: bevelledPanel },
  { id: 'gem', name: 'Ember gem', group: 'UI surfaces', build: emberGem },
  { id: 'rock', name: 'Rock face', group: 'Nature', build: rockFace },
  { id: 'water', name: 'Water caustics', group: 'Nature', build: waterCaustics },
  { id: 'blank', name: 'Blank noise', group: 'Basics', build: () => createProject({ name: 'Untitled' }) },
] satisfies Preset[]).map(withPreview)
