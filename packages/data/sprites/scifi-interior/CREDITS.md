# Sci-Fi Interior Assets Credits

## Source
- **Asset**: Free Space Station Game Asset
- **Author**: Jonik9i
- **URL**: https://jonik9i.itch.io/free-space-station-game-asset
- **License**: CC0 (Creative Commons Zero v1.0 Universal)

## Description
Sci-fi space station interior tiles and object sprites. Originally distributed
as a PSD file with layers; extracted into PNG tilesheets using `psd-tools`.

## Contents
- `floors.png` - 96 unique 32x32 floor tiles (metal deck, blue panels, teal medical, dark maintenance)
- `walls.png` - 66 unique 32x32 wall tiles (bulkheads, hull sections, borders, windows)
- `space.png` - 22 unique 32x32 space background tiles (starfield, nebula)
- `objects.png` - Combined spritesheet with 20 object sprites (crates, barrels, generators, gates, turrets, fighter)
- `objects/` - Individual object sprite PNGs
- `upper-body.png` - 30 unique ceiling/upper structure tiles
- `light.png` - Lighting overlay tiles
- `shadow.png` - Shadow overlay tiles

## Extraction
Extracted from `Space station._32_2.psd` using scripts in `scripts/`:
- `scripts/extract-scifi-psd.py` - Main extraction script
- `scripts/fix-scifi-objects.py` - Object clustering fix
- `scripts/pack-scifi-objects.py` - Object spritesheet packer
