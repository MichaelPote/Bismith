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

function techPlates(): Project {
  return createProject({
    name: 'Tech plates',
    width: 256,
    height: 256,
    tileable: true,
    heightDepth: 3,
    base: { color: '#4a4a44', roughness: 0.6, specular: 0.4, height: 0, opacity: 1 },
    layers: [
      // Interlocking plates: seams that jog at 45°, corners cut, cut-offs filled with plates of their own, raised centres.
      L('greebles', 'Plates', {
        root: 'pinwheel', pinwheel: 0.25, edge_seam: 0.5, min_size: 28, max_size: 120, split: 0.7, cluster: 0.5, split_var: 0.9, diag: 0.08,
        gap: 2, seam_taper: 0, seam_max: 0, bevel: 3, profile: 'linear', round: 0,
        jog: 8, jog_space: 72, jog_chance: 0.6, jog_layers: 2,
        cut_chance: 0.7, cut_size: 0.4, cut_var: 0.5, shape_chance: 0.15, shape_min: 60, fill: 'plates',
        frame_chance: 0.75, frame_style: 'raise', frame_inset: 7, frame_min: 34, rivets: 'none',
        detail_chance: 0.2, det_min: 44, det_light: false, det_pipes: false, vent_pitch: 4, vent_slot: 2,
        levels: 4, height_var: 0.35, bulge: 0, inset_depth: 0.22,
        h_on: true, h_amount: 0.7, dif_on: true, dif_src: 'value', dif_jitter: 0.1, dif_grad: ramp('#151512', '#4e4c40', '#8a8770', '#c4c1a8'),
      }),
      L('noise', 'Mottle', {
        noise: 'value', fractal: 'fbm', scale: 24, octaves: 5, h_on: true, h_amount: 0.02,
        dif_on: true, dif_blend: 'overlay', dif_opacity: 0.25, dif_grad: ramp('#000000', '#ffffff'),
      }),
      L('cavity', 'Grime & wear', { radius: 2, wear_amount: 0.5, wear_color: '#d4d0b8', dirt_amount: 0.7, dirt_color: '#0e0d0a', noise_scale: 14 }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#a2a8ae', horizon: '#a8a396', intensity: 0.3 },
      ambient: { color: '#ffffff', intensity: 0.03 },
      lights: [sun({ azimuth: 315, elevation: 35, angle: 1.5, intensity: 1.4, color: '#fff6e6' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, jitter: false },
    post: [post('tonemap', { operator: 'aces', exposure: 0.3 })],
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

// Stone walls (FR8.22): rock-faced ashlar from the Stone blocks generator, its Joints / Gaps outputs painted over the
// relief and noise for the weathering.

/** Yellow sandstone in broken ashlar: pitched faces, faint joints, open gaps, cream blotches. */
function sandstoneAshlar(): Project {
  const wall = {
    course: 64, length: 3.6, split: 0.4, scar_size: 110, levels: 2, min_size: 26, tall: 0.25, heights: 0.1,
    recess: 0.1, joint_depth: 0.15, scars: 0.95, scar_stretch: 1, scar_depth: 3.2, scar_detail: 0.5, margin: 10,
    pitch: 0.8, gap: 1, jag: 0.8, gaps: 0.15, gap_w: 3.5,
  }
  return createProject({
    name: 'Sandstone ashlar',
    width: 512,
    height: 512,
    tileable: true,
    heightDepth: 2,
    base: { color: '#b39a74', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('stone_blocks', 'Stone blocks', {
        ...wall,
        h_amount: 14, dif_src: 'random', dif_grad: ramp('#d0ac5c', '#dcba6c', '#e6c67e'),
      }),
      L('noise', 'Zones', {
        noise: 'perlin', fractal: 'fbm', scale: 3, octaves: 3, dif_on: true, dif_blend: 'multiply',
        dif_opacity: 0.35, sh_lo: 0.35, sh_hi: 0.7, dif_grad: ramp('#ffffff', '#c8a050'), seed: 3,
      }),
      L('noise', 'Mottle', {
        noise: 'perlin', fractal: 'fbm', scale: 24, octaves: 6, gain: 0.62, sh_cut: 0.56, sh_cut_soft: 0.03,
        dif_on: true, dif_blend: 'multiply', dif_opacity: 0.4, dif_grad: ramp('#ecd6a0', '#c8a050'), seed: 5,
      }),
      L('noise', 'Blotches', {
        noise: 'perlin', fractal: 'fbm', scale: 22, octaves: 7, gain: 0.78, sh_cut: 0.57, sh_cut_soft: 0.02,
        dif_on: true, dif_grad: ramp('#f0dc9c', '#fbf0c8'), seed: 9,
      }),
      L('noise', 'Grain', {
        noise: 'white', block: 1, sh_cut: 0.8, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.35,
        dif_grad: ramp('#d8b470', '#b08848'), seed: 12,
      }),
      L('stone_blocks', 'Joints', {
        ...wall,
        output: 'joints', reach: 1.2, patch: 0, h_on: false, dif_src: 'value', dif_blend: 'multiply',
        dif_grad: ramp('#ffffff', '#b09060'),
      }),
      L('noise', 'Joint grit', {
        noise: 'white', block: 1, sh_cut: 0.55, m_clip: 'outside', dif_on: true, dif_opacity: 0.7,
        dif_grad: ramp('#6a4c22', '#9a7a44'), seed: 21,
      }),
      L('stone_blocks', 'Gaps', {
        ...wall,
        output: 'gaps', h_on: false, dif_src: 'value', dif_grad: ramp('#1c2420', '#2a3a30'),
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.6 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 40, angle: 2, intensity: 1.35, color: '#ffffff' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, specular: 0, ao: 0.7, aoRadius: 4 },
    post: [post('tonemap', { operator: 'clamp' })],
  })
}

/** Small rust-red stones in random ashlar with orange lichen specks. */
function rustRubble(): Project {
  const wall = {
    course: 26, length: 2.6, split: 0.45, levels: 2, min_size: 11, tall: 0.2, heights: 0.15, recess: 0.05,
    recess_depth: 0.3, joint_depth: 0.2, scars: 0.9, scar_size: 34, scar_depth: 2.2, scar_detail: 0.6,
    scar_stretch: 1, margin: 4, pitch: 0.4, gap: 1, jag: 0.6, rough: 0.12, rough_scale: 2, gaps: 0, seed: 7,
  }
  return createProject({
    name: 'Rust rubble wall',
    width: 512,
    height: 512,
    tileable: true,
    heightDepth: 2,
    base: { color: '#7a3a1e', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('stone_blocks', 'Stone blocks', {
        ...wall,
        h_amount: 5, dif_src: 'random', dif_grad: ramp('#6a2c14', '#82381a', '#964424', '#a05430'),
      }),
      L('noise', 'Dark mottle', {
        noise: 'perlin', fractal: 'fbm', scale: 18, octaves: 6, gain: 0.65, sh_cut: 0.52, sh_cut_soft: 0.05,
        dif_on: true, dif_blend: 'multiply', dif_opacity: 0.6, dif_grad: ramp('#c8a090', '#6a4a3a'), seed: 3,
      }),
      L('noise', 'Orange lichen', {
        noise: 'perlin', fractal: 'fbm', scale: 60, octaves: 6, gain: 0.8, sh_cut: 0.58, sh_cut_soft: 0.02,
        dif_on: true, dif_opacity: 0.8, dif_grad: ramp('#a8582a', '#c08040'), seed: 5,
      }),
      L('noise', 'Grain', {
        noise: 'white', block: 1, sh_cut: 0.75, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.4,
        dif_grad: ramp('#c09080', '#704838'), seed: 9,
      }),
      L('stone_blocks', 'Joints', {
        ...wall,
        output: 'joints', reach: 1, patch: 0.2, h_on: false, dif_src: 'value', dif_blend: 'multiply',
        dif_grad: ramp('#ffffff', '#b08870'),
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.5 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 40, angle: 2, intensity: 1.3, color: '#ffffff' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, specular: 0, ao: 0.8, aoRadius: 4 },
    post: [post('tonemap', { operator: 'clamp' })],
  })
}

/** Long sandstone blocks with flat, finely cracked faces under grey, rust and pale lichen. */
function lichenSandstone(): Project {
  const wall = {
    course: 64, length: 4.2, split: 0.25, levels: 1, min_size: 24, tall: 0.15, heights: 0.08, recess: 0.05,
    joint_depth: 0.2, scars: 0.6, scar_size: 90, scar_depth: 1.2, scar_detail: 0.4, scar_stretch: 1, margin: 6,
    pitch: 0.4, gap: 1, jag: 0.5, rough: 0.05, gaps: 0, seed: 11,
  }
  return createProject({
    name: 'Lichen sandstone',
    width: 512,
    height: 512,
    tileable: true,
    heightDepth: 2,
    base: { color: '#e6c88e', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('stone_blocks', 'Stone blocks', {
        ...wall,
        h_amount: 8, dif_src: 'random', dif_grad: ramp('#d8b47a', '#e6c88e', '#efd8a8'),
      }),
      L('noise', 'Grey patches', {
        noise: 'perlin', fractal: 'fbm', scale: 4, octaves: 7, gain: 0.78, sh_cut: 0.55, sh_cut_soft: 0.06,
        dif_on: true, dif_grad: ramp('#b4aa9a', '#d2cbbe'), seed: 3,
      }),
      L('noise', 'Rust patches', {
        noise: 'perlin', fractal: 'fbm', scale: 6, octaves: 7, gain: 0.78, sh_cut: 0.6, sh_cut_soft: 0.06,
        dif_on: true, dif_grad: ramp('#b07848', '#c89058'), seed: 5,
      }),
      L('noise', 'Dark lichen', {
        noise: 'perlin', fractal: 'fbm', scale: 9, octaves: 7, gain: 0.78, sh_cut: 0.64, sh_cut_soft: 0.06,
        dif_on: true, dif_grad: ramp('#7c6c5c', '#968472'), seed: 7,
      }),
      L('noise', 'Pale crust', {
        noise: 'perlin', fractal: 'fbm', scale: 14, octaves: 7, gain: 0.78, sh_cut: 0.6, sh_cut_soft: 0.06,
        dif_on: true, dif_grad: ramp('#efe2c6', '#f8efdc'), seed: 9,
      }),
      L('cracks', 'Cracks', {
        scale: 6, width: 0.7, width_var: 0.9, zigzag: 2, warp: 0.1, sub: 0.25, sub_width: 0.5, sm_on: false,
        bevel: 0, halo: 0, m_clip: 'inside', dif_on: true, dif_blend: 'multiply', dif_opacity: 0.6,
        dif_grad: ramp('#5a4a3a', '#ffffff'), h_on: false, seed: 13,
      }),
      L('stone_blocks', 'Joints', {
        ...wall,
        output: 'joints', reach: 1.2, patch: 0, h_on: false, dif_src: 'value', dif_blend: 'multiply',
        dif_grad: ramp('#ffffff', '#a08a68'),
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.6 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 45, angle: 2, intensity: 1.25, color: '#ffffff' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, specular: 0, ao: 0.6, aoRadius: 4 },
    post: [post('tonemap', { operator: 'clamp' })],
  })
}

/** Dark wet slate in tall courses, crazed with cracks, moss and bright green flecks along the joints. */
function mossySlate(): Project {
  const wall = {
    course: 125, length: 2.2, split: 0.15, levels: 1, slabs: 1, min_size: 40, tall: 0, row_var: 0.1, heights: 0.1,
    recess: 0, joint_depth: 0.3, scars: 0.95, scar_size: 50, scar_depth: 2.4, scar_detail: 1, scar_stretch: 0.6,
    scar_edge: 0.3, margin: 4, pitch: 0.3, gap: 1, jag: 0.4, rough: 0.3, rough_scale: 3, gaps: 0, seed: 17,
  }
  return createProject({
    name: 'Mossy slate wall',
    width: 512,
    height: 512,
    tileable: true,
    heightDepth: 2,
    base: { color: '#363733', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('stone_blocks', 'Stone blocks', {
        ...wall,
        h_amount: 8, dif_src: 'random', dif_grad: ramp('#26271f', '#2e2f2a', '#383934'), s_on: true, s_src: 'flat',
        s_a: 0.5, s_b: 0.5, r_on: true, r_src: 'flat', r_a: 0.45, r_b: 0.45,
      }),
      L('noise', 'Tone', {
        noise: 'perlin', fractal: 'fbm', scale: 8, octaves: 5, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.5,
        dif_grad: ramp('#ffffff', '#707060'), seed: 3,
      }),
      L('cracks', 'Cracks', {
        scale: 8, width: 1.5, width_var: 0.9, zigzag: 3, warp: 0.1, sub: 0.85, sub_width: 1, sub_scale: 3,
        sm_on: false, bevel: 0, halo: 0, dif_on: true, dif_blend: 'multiply', dif_grad: ramp('#141410', '#ffffff'),
        h_on: false, s_on: true, s_mode: 'multiply', s_a: 0, s_b: 1, seed: 19,
      }),
      L('noise', 'Moss', {
        noise: 'perlin', fractal: 'fbm', scale: 10, octaves: 6, gain: 0.65, sh_cut: 0.62, sh_cut_soft: 0.05,
        dif_on: true, dif_opacity: 0.45, dif_grad: ramp('#3a3c22', '#56552a'), seed: 5,
      }),
      L('stone_blocks', 'Joint moss', {
        ...wall,
        output: 'joints', reach: 10, patch: 0.55, h_on: false, dif_src: 'value', dif_blend: 'normal',
        dif_opacity: 0.6, dif_grad: ramp('#3a3a1e', '#4e5226'), mk_write: '1',
      }),
      L('noise', 'Green flecks', {
        noise: 'white', block: 2, sh_cut: 0.86, dif_on: true, dif_grad: ramp('#6ac81a', '#9af030'), mk_use: '1',
        seed: 23,
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.45 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 40, angle: 2, intensity: 1.4, color: '#ffffff' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, specular: 1, ao: 0.8, aoRadius: 4 },
    post: [post('tonemap', { operator: 'clamp' })],
  })
}

/** Pale frosted blocks with a fine crumpled face, hairline cracks and speckled moss. */
function frostedStone(): Project {
  const wall = {
    course: 80, length: 3.5, split: 0.2, levels: 1, min_size: 30, tall: 0.1, heights: 0.05, recess: 0,
    joint_depth: 0.1, scars: 0.95, scar_size: 12, scar_depth: 2.5, scar_detail: 1, scar_edge: 0.2, margin: 3,
    pitch: 0.2, gap: 1, jag: 0.5, rough: 0.2, rough_scale: 1.5, gaps: 0, seed: 29,
  }
  return createProject({
    name: 'Frosted stone',
    width: 512,
    height: 512,
    tileable: true,
    heightDepth: 2,
    base: { color: '#96a0a4', roughness: 0.9, specular: 0.5, height: 0, opacity: 1 },
    layers: [
      L('stone_blocks', 'Stone blocks', {
        ...wall,
        h_amount: 5, dif_src: 'random', dif_grad: ramp('#868e92', '#92999c', '#9ea5a8'),
      }),
      L('noise', 'Frost', {
        noise: 'perlin', fractal: 'fbm', scale: 40, octaves: 7, gain: 0.72, dif_on: true, dif_blend: 'overlay',
        dif_opacity: 0.8, dif_grad: ramp('#606a70', '#ffffff'), seed: 3,
      }),
      L('cracks', 'Cracks', {
        scale: 10, width: 0.6, width_var: 0.9, zigzag: 2, warp: 0.1, sub: 0.5, sub_width: 0.4, sm_on: false,
        bevel: 0, halo: 0, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.45,
        dif_grad: ramp('#4a5258', '#ffffff'), h_on: false, seed: 31,
      }),
      L('noise', 'Moss clusters', {
        noise: 'perlin', fractal: 'fbm', scale: 7, octaves: 6, gain: 0.7, sh_cut: 0.58, sh_cut_soft: 0.06,
        dif_on: true, dif_blend: 'multiply', dif_opacity: 0.35, dif_grad: ramp('#c8c8a8', '#909070'), mk_write: '2',
        seed: 5,
      }),
      L('noise', 'Moss specks', {
        noise: 'perlin', fractal: 'fbm', scale: 140, octaves: 3, gain: 0.6, sh_cut: 0.56, sh_cut_soft: 0.03,
        mk_use: '2', dif_on: true, dif_grad: ramp('#3a3a20', '#5e5c36'), seed: 6,
      }),
      L('stone_blocks', 'Joints', {
        ...wall,
        output: 'joints', reach: 1, patch: 0.4, h_on: false, dif_src: 'value', dif_blend: 'multiply',
        dif_grad: ramp('#ffffff', '#9aa2a6'),
      }),
    ],
    lighting: {
      sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.6 },
      ambient: { color: '#ffffff', intensity: 0.02 },
      lights: [sun({ azimuth: 315, elevation: 45, angle: 2, intensity: 1.2, color: '#ffffff' })],
    },
    render: { ...defaultRender(), maxSamples: 64, bounces: 1, specular: 0, ao: 0.5, aoRadius: 4 },
    post: [post('tonemap', { operator: 'clamp' })],
  })
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
  { id: 'plates', name: 'Tech plates', group: 'Quake-style', build: techPlates },
  { id: 'button', name: 'Forged button', group: 'UI surfaces', build: forgedButton },
  { id: 'well', name: 'Sunken well', group: 'UI surfaces', build: sunkenWell },
  { id: 'panel', name: 'Bevelled panel', group: 'UI surfaces', build: bevelledPanel },
  { id: 'gem', name: 'Ember gem', group: 'UI surfaces', build: emberGem },
  { id: 'rock', name: 'Rock face', group: 'Nature', build: rockFace },
  { id: 'water', name: 'Water caustics', group: 'Nature', build: waterCaustics },
  { id: 'ashlar', name: 'Sandstone ashlar', group: 'Nature', build: sandstoneAshlar },
  { id: 'rustwall', name: 'Rust rubble wall', group: 'Nature', build: rustRubble },
  { id: 'lichen', name: 'Lichen sandstone', group: 'Nature', build: lichenSandstone },
  { id: 'slate', name: 'Mossy slate wall', group: 'Nature', build: mossySlate },
  { id: 'frost', name: 'Frosted stone', group: 'Nature', build: frostedStone },
  { id: 'blank', name: 'Blank noise', group: 'Basics', build: () => createProject({ name: 'Untitled' }) },
] satisfies Preset[]).map(withPreview)
