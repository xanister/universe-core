/**
 * Prompt Constants (Shared)
 *
 * Writing style and naming rules used by both generation/ and game/ layers.
 * Extracted to shared/ to allow generation/ to import without violating boundaries.
 */

/**
 * Standard writing style rules for entity descriptions (characters, places).
 * Enforces authoritative, definitive language without speculation.
 */
export const WRITING_STYLE_RULES = `WRITING STYLE (CRITICAL):
- Write descriptions as if for a historical encyclopedia or scholarly reference work.
- Use authoritative, definitive language. State facts directly without hedging.
- NEVER use speculative words: "perhaps", "maybe", "might", "could be", "possibly", "it seems", "appears to be".
- Write in third person, present tense: "This individual stands tall" not "You see a tall person".
- Focus on permanent, defining characteristics rather than momentary states.
- Keep descriptions to 3-4 sentences maximum. Focus on the most distinctive, defining features.`;

/**
 * Example of good writing style for character descriptions.
 */
export const CHARACTER_DESCRIPTION_EXAMPLE = `Example: "A weathered fisherman of middle years, bearing the sun-darkened complexion and calloused hands typical of those who work the coastal waters. Deep crow's feet frame pale gray eyes that speak to decades spent squinting against the glare of open sea."`;

/**
 * Example of good writing style for place descriptions.
 */
export const PLACE_DESCRIPTION_EXAMPLE = `Example: "A weathered stone tower rising three stories above the harbor ward, its upper windows perpetually shuttered against the salt spray. The ground floor serves as a chandlery, its cramped interior thick with the smell of hemp rope and tallow."`;

/**
 * Rules preventing characters from being mentioned in place descriptions.
 * Characters move around; their presence is tracked separately.
 */
export const NO_INDIVIDUALS_IN_DESCRIPTIONS = `NO INDIVIDUALS IN DESCRIPTIONS (CRITICAL):
- NEVER mention specific characters, people, or individuals by name or description in place descriptions.
- Characters are NOT static - they move around. Their presence is tracked separately.
- BAD: "A corner is claimed by a melancholy robot" or "The bartender wipes glasses behind the counter"
- GOOD: "A shadowy corner holds a dusty stack of crates" or "A worn bar counter dominates the room"
- Describe the SPACE itself - architecture, furniture, lighting, atmosphere - not who might be there.`;

/**
 * Rules for place naming style (labels).
 * Ensures place names are concise, properly capitalized, and distinctive.
 * Includes purpose-specific naming guidance.
 */
export const PLACE_NAMING_RULES = `PLACES vs EXITS (CRITICAL):
- A PLACE is a SPACE you can be inside: room, building, outdoor area, district, region
- An EXIT is a connection feature: door, gate, path, stairs, window, hatch, ladder
- NEVER create a place named after an exit type
  BAD: "Barracks Door", "Market Gate", "Tower Entrance", "Back Door"
  GOOD: "The Barracks", "Market Gatehouse", "Tower Entry Hall", "Back Office"
- If player goes through a door/gate, create the DESTINATION as a place, not the door itself
- Doors, gates, stairs, paths are automatically created as EXITS connecting places

PLACE NAMING STYLE:
- Use Title Case for all place names.
- Prefer SHORT, EVOCATIVE names (2-4 words) over verbose descriptions.
- Names should feel like real place names, not filing system entries.
- OMIT redundant context: drop possessives like "ship's" or "castle's" when the location context is obvious.

FORBIDDEN PATTERNS (validation will reject these):
- NEVER use parentheses to add details
  BAD: "Market Square (Fish Stalls)"
  BAD: "Main Deck (Fore Section)"
- NEVER append geographic location with a comma
  BAD: "The Crossroads Inn, Trident Road"
- NEVER name objects/containers instead of places
  BAD: "Storage Crate", "Navigation Terminal", "Research Kit"
  GOOD: "Storage Bay", "Navigation Room", "Research Lab"
- NEVER use generic labels without distinctive names
  BAD: "The Room", "Back Door", "Second Passage"
  GOOD: "The Crimson Chamber", "Merchant's Gate", "The Serpent Corridor"

STYLE GUIDANCE (not validated, but improves quality):
- Avoid verbose functional descriptions
  BAD: "Cargo Inspection Checkpoint Area"
  BETTER: "The Inspection Post"
- Transform bare building types to proper nouns:
  BAD: "dungeon", "tower", "tavern", "temple", "forge"
  GOOD: "The Ironhold Dungeon", "The Watchfire Tower", "The Crossed Cask", "Temple of the Silver Moon", "The Ember Anvil"
  Or include parent location: "Farsreach Castle Dungeon", "Saltfog Harbor Ward"

NAMING BY purpose:

room (single enclosed space):
- Possessive or "The [Adjective] [Type]"
- GOOD: "Captain's Quarters", "The Crimson Chamber", "Cargo Hold Three"

building (structure with rooms):
- Proper noun establishment name
- GOOD: "The Wanderer's Rest", "Holst's Forge", "Temple of the Silver Moon"

outdoors (open navigable area):
- Simple descriptive or "The [Name]"
- GOOD: "The Foredeck", "Market Square", "Northside Plaza"

passage (transit route):
- Named like real streets/paths
- GOOD: "Copper Lane", "The Underpaths", "Merchant's Row"

district (urban subdivision):
- [City/Region] + [Name] + [Type] for uniqueness
- GOOD: "Saltfog Harbor Ward", "The Warrens", "Hightown"

region (large geographic area):
- Evocative proper noun
- GOOD: "Thornroot Forest", "The Pale Sea", "Mistveil Moors"

settlement (populated place):
- Proper noun city/town name
- GOOD: "Hearthhome", "Farsreach", "New Geneva"

vessel (mobile structure):
- Ship's proper name only, 2-4 words
- GOOD: "The Ledgerwake", "Stormchaser", "The Ironwind"

world (planet/realm):
- Proper noun
- GOOD: "Anslem", "Earth", "The Feywild"

cosmos (outermost container):
- "The [Name]"
- GOOD: "The Cosmos", "The Great Wheel", "The Milky Way"

TRANSFORMATION EXAMPLES:
- "Market Square (Fish Stalls)" → "The Fish Market"
- "Main Deck (Fore Section)" → "The Foredeck"
- "Storage Crate" → "Storage Bay"
- "Back Room" → "The Storekeeper's Office"

The name should be recognizable even without knowing the current location.`;

/**
 * Rules for VESSEL naming specifically (ships, boats, aircraft).
 * Vessel labels must be proper ship names, not verbose descriptions.
 */
export const VESSEL_NAMING_RULES = `VESSEL NAMING (for ships, boats, aircraft):
- Vessel labels MUST be the ship's proper name (2-4 words max)
- Use "The [Name]" or just "[Name]" format
- Examples: "The Ledgerwake", "The Ironwind", "Marchwatch", "Stormchaser"
- NEVER include in vessel labels:
  - Location prefixes (port names, dock names, harbor names)
  - Vessel type descriptors ("Packet Ship", "Merchant Vessel", "Trading Ship")
  - Part names ("Main Deck", "Bridge", "Hull")
- BAD: "Straitwarden Chainpoint Packet Ship (Main Deck)"
- BAD: "Harbor District Trading Vessel"
- BAD: "The Docks Fishing Boat"
- GOOD: "The Marchwatch"
- GOOD: "The Ironwind"
- GOOD: "Stormchaser"

VESSEL INTERIOR NAMING:
- Interior spaces aboard vessels should reference the ship's proper name
- Format: "[Ship Name] [Space Type]" or just "[Space Type]" if context is clear
- Examples: "Marchwatch Crew Berth", "Captain's Quarters", "The Ledgerwake Hold"
- NEVER derive interior names from dock locations or vessel type descriptors`;

/**
 * Rules for REGION naming specifically.
 * Regions (districts, wards, areas) must have globally unique proper noun names
 * to prevent duplicate places and incorrect exit linking.
 */
export const REGION_NAMING_RULES = `REGION NAMING (CRITICAL FOR DISTRICTS/AREAS):
- Region names MUST be globally unique proper nouns that include geographic context.
- Include the parent region or city name to distinguish from similar places elsewhere.
- BAD (generic): "Harbor District", "The Docks", "Deep Passage", "Market Square"
- GOOD (proper nouns): "Saltfog Harbor Ward", "Oxenfurt Docks", "Farsreach Deep Passage", "Novigrad Market Square"
- The name should be recognizable even without knowing the current location.
- Combine the distinctive local name with enough context to be unique universe-wide.
- Examples of good region names:
  - "Saltfog Harbor Ward" (not just "Harbor Ward")
  - "Oxenfurt Harbor District" (not just "Harbor District")
  - "Icehold Upper Wards" (not just "Upper Wards")
  - "Novigrad Temple Quarter" (not just "Temple Quarter")`;
