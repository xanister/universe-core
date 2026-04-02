# Tileset Asset Guide

This document explains how to correctly import, analyze, and configure tileset assets for the DMNPC project.

## Tile Index Calculation

For any tileset with uniform tile sizes:

```
index = row * columns_per_row + column
```

Where:
- `row` = vertical position (0 = top)
- `column` = horizontal position (0 = left)
- `columns_per_row` = image_width / tile_size

**Example:** For a 1024px wide tileset with 32px tiles:
- columns_per_row = 1024 / 32 = 32
- Tile at row 39, col 0 = 39 * 32 + 0 = **1248**

## How to Analyze a Tileset

**NEVER estimate visually from thumbnails.** Always use programmatic analysis.

### Step 1: Get Image Dimensions

```bash
node -e "
const fs = require('fs');
const buf = fs.readFileSync('path/to/tileset.png');
const w = buf.readUInt32BE(16);
const h = buf.readUInt32BE(20);
console.log('Width:', w, 'Height:', h);
console.log('Tiles per row (32px):', w/32);
console.log('Total rows (32px):', h/32);
"
```

### Step 2: Analyze Tile Colors by Row

Use the canvas library to extract and analyze tiles:

```javascript
const { createCanvas, loadImage } = require('canvas');

async function analyzeTile(imgPath, row, col, tileSize = 32) {
  const img = await loadImage(imgPath);
  const canvas = createCanvas(tileSize, tileSize);
  const ctx = canvas.getContext('2d');
  
  const x = col * tileSize;
  const y = row * tileSize;
  
  ctx.drawImage(img, x, y, tileSize, tileSize, 0, 0, tileSize, tileSize);
  const imageData = ctx.getImageData(0, 0, tileSize, tileSize);
  
  // Calculate average RGB
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (imageData.data[i + 3] > 0) { // non-transparent
      r += imageData.data[i];
      g += imageData.data[i + 1];
      b += imageData.data[i + 2];
      count++;
    }
  }
  
  return {
    row, col,
    index: row * (img.width / tileSize) + col,
    rgb: count > 0 ? [Math.round(r/count), Math.round(g/count), Math.round(b/count)] : null,
    filled: count / (tileSize * tileSize)
  };
}
```

### Step 3: Test Before Committing

Always test at least one tile index visually before committing configuration changes:

1. Set the floor type to use a single test index
2. Rebuild and refresh
3. Verify the rendered tile matches expectations
4. Only then update the full configuration

---

## floors.png Analysis (lpc-interior)

**File:** `packages/data/sprites/lpc-interior/floors.png`  
**Dimensions:** 1024 × 2048 pixels  
**Tile size:** 32 × 32 pixels  
**Grid:** 32 columns × 64 rows  
**Total tiles:** 2048

### Row-by-Row Breakdown

| Rows | Index Range | Avg RGB | Description |
|------|-------------|---------|-------------|
| 0-9 | 0-319 | Various | Decorative rugs (red, blue borders) |
| 10-14 | 320-479 | Greenish | Green decorative rugs |
| 15-19 | 480-639 | Brown | Gold/tan rugs and borders |
| 20 | 640-671 | - | EMPTY |
| 21-34 | 672-1119 | Various | Mixed decorative, patterns |
| **35-36** | **1120-1183** | **(133,113,99)** | **Light gray wood** |
| **37-38** | **1184-1247** | **(145,90,51)** | **Medium brown wood** |
| **39-40** | **1248-1311** | **(107,66,36)** | **Dark brown wood (TAVERN)** |
| **41-44** | **1312-1439** | **(65-73,31-41,21-25)** | **Very dark wood** |
| **45-46** | **1440-1503** | **(130,60,37)** | **Orangey brown wood** |
| 47-48 | 1504-1567 | (48,78,62) | Green/teal (decorative) |
| 49 | 1568-1599 | - | EMPTY |
| **50** | **1600-1631** | **(186,175,158)** | **Light tan stone** |
| 51-57 | 1632-1855 | Various | Mixed patterns (blue, purple, dark) |
| 58 | 1856-1887 | - | EMPTY |
| 59 | 1888-1919 | (164,113,75) | Brown pattern |
| **60** | **1920-1951** | **(115,136,127)** | **Gray stone** |
| **61-63** | **1952-2047** | **(98,74,62)** | **Brown stone/cobble** |

### Recommended Indices by Floor Type

| Floor Type | Rows | Index Range | RGB | Notes |
|------------|------|-------------|-----|-------|
| wood_simple | 39-40 | 1248-1311 | (107,66,36) | Best for taverns |
| wood_light | 35-36 | 1120-1183 | (133,113,99) | Light gray wood |
| wood_herringbone | 37-38 | 1184-1247 | (145,90,51) | Medium brown |
| wood_dark | 41-42 | 1312-1375 | (73,31,21) | Very dark |
| wood_orange | 45-46 | 1440-1503 | (130,60,37) | Orangey brown |
| stone_tan | 50 | 1600-1631 | (186,175,158) | Light stone |
| stone_gray | 60 | 1920-1951 | (115,136,127) | Gray stone |
| stone_cobble | 61-63 | 1952-2047 | (98,74,62) | Cobblestone |

---

## Verification Checklist

Before committing any tileset configuration:

- [ ] Image dimensions verified programmatically
- [ ] Tile indices calculated using formula (NOT estimated)
- [ ] At least one tile tested visually in-game
- [ ] RGB values documented for reference
- [ ] Configuration file updated with comments showing calculations

## Common Mistakes to Avoid

1. **DON'T** estimate row numbers from thumbnail images
2. **DON'T** assume section boundaries based on visual appearance
3. **DON'T** commit without testing at least one tile
4. **DO** use programmatic analysis to identify tile positions
5. **DO** document the index calculation in code comments
6. **DO** test edge cases (first/last rows of a section)
