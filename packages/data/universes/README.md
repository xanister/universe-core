# Universes System

This directory contains custom RPG universes that can be loaded and swapped in the game.

Universe definitions live in `universes/definitions/`.

## Current implementation (server)

The server currently supports **directory-based** universes with this structure:

- `universes/definitions/<universeId>/index.json`
- `universes/definitions/<universeId>/characters.json` (JSON array of `Character`)
- `universes/definitions/<universeId>/places.json` (JSON array of `Place`)
- Optional: `universes/definitions/<universeId>/tags.json`

`index.json` must declare:

- `structure: "multi-file"`
- `files.characters` and `files.places` (filenames)

### Entity file format

`characters.json` and `places.json` are **unified arrays** of entities (not nested objects). Each entity is expected to include:

- `id`: stable identifier (e.g. `CHAR_...`, `PLACE_...`)
- `label`: display name
- `description`: text description (may include references to other IDs)
- `entityType`: `"character"` or `"place"`
- `tags`: string array
- `info`: object (free-form; character info commonly includes `role`/`race`)
- `relationships`: object mapping relationship types to arrays of entity IDs (e.g., `{ "parent": ["CHAR_1"], "sibling": ["CHAR_2", "CHAR_3"] }`)

Implementation notes:

- There is **no separate** persisted `dynamic/` layer in the current server; reads/writes happen directly to the unified `characters.json` / `places.json` / `tags.json` files.


