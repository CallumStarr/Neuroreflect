// Chart tokens, validated with the dataviz palette checker on the ink-900
// surface (#1d1915), dark mode, all pairs: both slots inside the lightness band,
// CVD separation 23.0, normal-vision 23.3, contrast >= 3:1.
//
// Semantic mapping kept consistent across charts:
//   warm (brass) = the anticipating / self-focused version
//   cool (blue)  = the reflective / actual version
export const CHART = {
  surface: '#1d1915',
  grid: '#2c261f',
  axis: '#3b332b',
  textPrimary: '#efe6d6',
  textSecondary: '#c4b49b',
  textMuted: '#93846f',
  cool: '#6f93d9', // slot 1
  warm: '#bf8a30', // slot 2
  neutral: '#4d453c', // diverging midpoint
  serious: '#e0805c', // status: rumination detected (always with icon + label)
} as const;

export const AXIS_TICK = { fill: CHART.textMuted, fontSize: 12, fontFamily: 'IBM Plex Sans, system-ui, sans-serif' };
