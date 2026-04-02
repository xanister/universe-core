/**
 * Canonical color constants shared between server and client.
 *
 * Pure data mappings with no runtime dependencies — browser-safe.
 * @dmnpc/sprites re-exports these; do NOT duplicate definitions there.
 */

/**
 * Hex tint colors for skin colorization via multiply-blend tinting.
 * Applied to white-base body sprites and head universal.png.
 *
 * On a white base, the tint color maps directly to the output skin color.
 * On a light-skin base (heads), the tint darkens proportionally.
 */
export const SKIN_COLOR_TINT_HEX = {
  amber: 0xd4a76a,
  black: 0x3a2a1a,
  blue: 0x6688cc,
  bright_green: 0x66cc44,
  bronze: 0xad8b60,
  brown: 0x6b4226,
  dark_green: 0x3a6b30,
  fur_black: 0x2a2a2a,
  fur_brown: 0x7a5c3a,
  fur_copper: 0xc87533,
  fur_gold: 0xdaa520,
  fur_grey: 0x9a9a9a,
  fur_tan: 0xc4a882,
  fur_white: 0xe8e4e0,
  green: 0x6bbf47,
  lavender: 0xb4a0d0,
  light: 0xf0c8a8,
  olive: 0x9aad6a,
  pale_green: 0xa0d4a0,
  taupe: 0xc4b098,
  zombie: 0x8a9a6a,
  zombie_green: 0x7aaa55,
} as const satisfies Record<string, number>;

/**
 * Hex tint colors for hair colorization via multiply-blend tinting.
 * Applied to white-base hair sprites.
 */
export const HAIR_COLOR_TINT_HEX = {
  black: 0x1a1a1a,
  brown: 0x6b4226,
  brunette: 0x4a3728,
  blonde: 0xd4a76a,
  red: 0xb03030,
  auburn: 0x8b3a1a,
  gray: 0x808080,
  white: 0xe8e4e0,
  blue: 0x3060b0,
  green: 0x3a7a3a,
  pink: 0xd06080,
} as const satisfies Record<string, number>;

/**
 * Hex tint colors for eye colorization via multiply-blend tinting.
 * Applied to white-base eye sprites.
 */
export const EYE_COLOR_TINT_HEX = {
  blue: 0x4488dd,
  brown: 0x6b4226,
  gray: 0x808888,
  green: 0x3a8a3a,
  orange: 0xdd7720,
  purple: 0x7733aa,
  red: 0xcc2222,
  yellow: 0xddcc22,
} as const satisfies Record<string, number>;

/**
 * Named clothing colors for player UI swatches and LLM generation.
 * Curated palette — same proven pattern as skin/hair/eye colors.
 */
export const CLOTHING_COLORS = [
  'white',
  'off_white',
  'black',
  'charcoal',
  'gray',
  'brown',
  'tan',
  'beige',
  'rust',
  'red',
  'crimson',
  'maroon',
  'burgundy',
  'orange',
  'gold',
  'yellow',
  'green',
  'forest_green',
  'olive',
  'teal',
  'blue',
  'navy',
  'sky_blue',
  'royal_blue',
  'purple',
  'lavender',
  'plum',
  'pink',
  'rose',
  'silver',
  'bronze',
  'copper',
] as const satisfies readonly string[];

/**
 * Hex tint values for each named clothing color.
 * Applied via multiply-blend on white-base sprites.
 */
export const CLOTHING_COLOR_HEX = {
  white: 0xffffff,
  off_white: 0xf5f0e8,
  black: 0x1a1a1a,
  charcoal: 0x3a3a3a,
  gray: 0x808080,
  brown: 0x8b4513,
  tan: 0xd2b48c,
  beige: 0xf5deb3,
  rust: 0xb7410e,
  red: 0xcc2222,
  crimson: 0xdc143c,
  maroon: 0x800000,
  burgundy: 0x722f37,
  orange: 0xe87830,
  gold: 0xdaa520,
  yellow: 0xf0d040,
  green: 0x2d8f2d,
  forest_green: 0x228b22,
  olive: 0x808020,
  teal: 0x008080,
  blue: 0x4060cc,
  navy: 0x000080,
  sky_blue: 0x6ca6cd,
  royal_blue: 0x3050b0,
  purple: 0x7030a0,
  lavender: 0xb4a0d0,
  plum: 0x8b3a8b,
  pink: 0xe88ca0,
  rose: 0xc06070,
  silver: 0xc0c0c0,
  bronze: 0xad8b60,
  copper: 0xb87333,
} as const satisfies Record<string, number>;
