/**
 * Document Processor Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processDocuments, type WorldBible } from '@dmnpc/generation/document/document-processor.js';
import type { ParsedDocument } from '@dmnpc/generation/document/document-parser.js';
import { ENVIRONMENT_PRESETS, environmentFromPreset } from '@dmnpc/types/world';

// Mock the OpenAI client
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';

const mockQueryLlm = vi.mocked(queryLlm);

describe('document-processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processDocuments', () => {
    it('processes documents and returns a WorldBible with temporal fields', async () => {
      const mockExtraction = {
        themes: ['adventure', 'magic'],
        characters: [
          {
            name: 'Hero',
            title: '',
            aliases: [],
            description: 'The main character who seeks to restore balance',
            temporalStatus: 'contemporary',
            activeEra: 'Third Age',
          },
        ],
        places: [
          {
            name: 'Castle',
            description: 'A grand castle',
            isSuitableStart: false,
            environment: 'exterior',
            purpose: 'building',
            parentName: 'Cosmos',
          },
        ],
        loreElements: ['Ancient prophecy'],
        rules: ['Magic requires sacrifice'],
        tone: 'Epic fantasy',
        summary: 'A tale of adventure.',
        historicalFigures: ['King Aldric the First, founder of the realm who died 500 years ago'],
        historicalEvents: [],
        narrativePresent: 'Year 3019 of the Third Age',
      };

      const mockWorldBible: WorldBible = {
        themes: ['adventure', 'magic'],
        characters: [
          {
            name: 'Hero',
            title: '',
            aliases: [],
            description: 'The main character who seeks to restore balance',
            temporalStatus: 'contemporary',
            activeEra: 'Third Age',
          },
        ],
        places: [
          {
            name: 'Castle',
            description: 'A grand castle',
            isSuitableStart: false,
            environment: 'exterior',
            purpose: 'building',
            parentName: 'Cosmos',
          },
        ],
        lore: 'An ancient prophecy foretells the coming of a hero.',
        rules: ['Magic requires sacrifice'],
        tone: 'Epic fantasy',
        overview: 'A world of magic and adventure.',
        keyConflicts: ['The struggle to restore balance to the realm'],
        atmosphere: 'Heroic and dramatic',
        narrativePresent: 'Year 3019 of the Third Age',
        historicalLore:
          'King Aldric the First founded the realm 500 years ago, establishing the order of Knights.',
        historicalEvents: [],
      };

      // First call: extraction for each document
      // Second call: consolidation
      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        {
          filename: 'lore.txt',
          content: 'Once upon a time in a magical kingdom...',
          charCount: 40,
        },
      ];

      const result = await processDocuments(documents);

      // The processor maps environment strings from the LLM response to EnvironmentConfig objects
      const expectedWorldBible = {
        ...mockWorldBible,
        places: mockWorldBible.places.map((p: any) => ({
          ...p,
          environment: environmentFromPreset(p.environment),
        })),
      };
      expect(result).toEqual(expectedWorldBible);
      expect(result.narrativePresent).toBe('Year 3019 of the Third Age');
      expect(result.historicalLore).toContain('King Aldric');
      expect(result.characters[0].temporalStatus).toBe('contemporary');
      expect(mockQueryLlm).toHaveBeenCalledTimes(2);
    });

    it('handles multiple documents with different narrativePresent values', async () => {
      const mockExtraction1 = {
        themes: ['adventure'],
        characters: [
          {
            name: 'Hero',
            title: '',
            aliases: [],
            description: 'Main character',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Epic',
        summary: 'First document summary.',
        historicalFigures: [],
        historicalEvents: [],
        narrativePresent: 'Year 3015 of the Third Age',
      };

      const mockExtraction2 = {
        themes: ['mystery'],
        characters: [
          {
            name: 'Antagonist',
            title: '',
            aliases: ['The Conqueror'],
            description: 'A warlord seeking power through conquest',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'Dungeon',
            description: 'Dark place',
            isSuitableStart: false,
            environment: 'interior',
            purpose: 'room',
            parentName: 'Cosmos',
          },
        ],
        loreElements: [],
        rules: [],
        tone: 'Dark',
        summary: 'Second document summary.',
        historicalFigures: ['Ancient Mage Theron, who created the dungeon millennia ago'],
        historicalEvents: [],
        narrativePresent: 'Year 3019 of the Third Age',
      };

      const mockWorldBible: WorldBible = {
        themes: ['adventure', 'mystery'],
        characters: [
          {
            name: 'Hero',
            title: '',
            aliases: [],
            description: 'Main character',
            temporalStatus: 'contemporary',
          },
          {
            name: 'Antagonist',
            title: '',
            aliases: ['The Conqueror'],
            description: 'A warlord seeking power through conquest',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'Dungeon',
            description: 'Dark place',
            isSuitableStart: false,
            environment: 'interior',
            purpose: 'room',
            parentName: 'Cosmos',
          },
        ],
        lore: 'Combined lore.',
        rules: [],
        tone: 'Epic with dark undertones',
        overview: 'A tale of adventure and mystery.',
        keyConflicts: ['The conflict between Hero and Antagonist'],
        atmosphere: 'Dramatic',
        narrativePresent: 'Year 3019 of the Third Age', // Latest from both documents
        historicalLore: 'Ancient Mage Theron created the dungeon millennia ago.',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction1 })
        .mockResolvedValueOnce({ content: mockExtraction2 })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        { filename: 'doc1.txt', content: 'First document content', charCount: 21 },
        { filename: 'doc2.txt', content: 'Second document content', charCount: 22 },
      ];

      const result = await processDocuments(documents);

      expect(result.themes).toContain('adventure');
      expect(result.themes).toContain('mystery');
      expect(result.characters).toHaveLength(2);
      expect(result.narrativePresent).toBe('Year 3019 of the Third Age');
      expect(result.historicalLore).toContain('Theron');
      expect(mockQueryLlm).toHaveBeenCalledTimes(3); // 2 extractions + 1 consolidation
    });

    it('filters historical characters into historicalLore', async () => {
      const mockExtraction = {
        themes: ['history'],
        characters: [
          {
            name: 'CurrentKing',
            title: 'King',
            aliases: [],
            description: 'The reigning monarch who rules wisely',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Historical',
        summary: 'A chronicle of the realm.',
        historicalFigures: [
          'First King Aldric, who founded the dynasty 1000 years ago',
          'Queen Elara the Wise, who ruled 500 years ago and established the laws',
        ],
        historicalEvents: [],
        narrativePresent: 'Year 1000 of the Current Era',
      };

      const mockWorldBible: WorldBible = {
        themes: ['history'],
        characters: [
          {
            name: 'CurrentKing',
            title: 'King',
            aliases: [],
            description: 'The reigning monarch who rules wisely',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: 'The realm has a rich history.',
        rules: [],
        tone: 'Historical',
        overview: 'A chronicle of the realm.',
        keyConflicts: [],
        atmosphere: 'Regal',
        narrativePresent: 'Year 1000 of the Current Era',
        historicalLore:
          'First King Aldric founded the dynasty 1000 years ago. Queen Elara the Wise ruled 500 years ago and established the laws that govern the realm today.',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        { filename: 'history.txt', content: 'A chronicle of the realm...', charCount: 28 },
      ];

      const result = await processDocuments(documents);

      // Only contemporary characters should be in characters array
      expect(result.characters).toHaveLength(1);
      expect(result.characters[0].name).toBe('CurrentKing');

      // Historical figures should be in historicalLore
      expect(result.historicalLore).toContain('Aldric');
      expect(result.historicalLore).toContain('Elara');
    });

    it('extracts objective descriptions without POV bias', async () => {
      const mockExtraction = {
        themes: ['conflict'],
        characters: [
          {
            name: 'Anakin Skywalker',
            title: 'Lord',
            aliases: ['Darth Vader'],
            description: 'A Sith Lord who serves the Galactic Empire and seeks to restore order',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Space opera',
        summary: 'A galactic conflict.',
        historicalFigures: [],
        historicalEvents: [],
        narrativePresent: '0 BBY',
      };

      const mockWorldBible: WorldBible = {
        themes: ['conflict'],
        characters: [
          {
            name: 'Anakin Skywalker',
            title: 'Lord',
            aliases: ['Darth Vader'],
            description: 'A Sith Lord who serves the Galactic Empire and seeks to restore order',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: 'The galaxy is divided between the Empire and the Rebellion.',
        rules: [],
        tone: 'Space opera',
        overview: 'A galactic conflict between two ideologies.',
        keyConflicts: [
          'The conflict between centralized Imperial control and the decentralized Republic ideals',
        ],
        atmosphere: 'Epic and dramatic',
        narrativePresent: '0 BBY',
        historicalLore: '',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        {
          filename: 'starwars.txt',
          content: 'A long time ago in a galaxy far, far away...',
          charCount: 44,
        },
      ];

      const result = await processDocuments(documents);

      // Verify descriptions are objective (no "evil", "villain", "hero", "tyrannical")
      expect(result.characters[0].description).not.toContain('evil');
      expect(result.characters[0].description).not.toContain('villain');
    });

    it('throws error when no documents can be processed', async () => {
      mockQueryLlm.mockRejectedValue(new Error('LLM error'));

      const documents: ParsedDocument[] = [
        { filename: 'doc.txt', content: 'Content', charCount: 7 },
      ];

      await expect(processDocuments(documents)).rejects.toThrow('No documents could be processed');
    });

    it('truncates large documents to 30k characters', async () => {
      const mockExtraction = {
        themes: [],
        characters: [],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Unknown',
        summary: 'Summary',
        historicalFigures: [],
        historicalEvents: [],
        narrativePresent: '',
      };

      const mockWorldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: 'Unknown',
        overview: 'Overview',
        keyConflicts: [],
        atmosphere: 'Neutral',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const largeContent = 'A'.repeat(50000);
      const documents: ParsedDocument[] = [
        { filename: 'large.txt', content: largeContent, charCount: 50000 },
      ];

      await processDocuments(documents);

      // Verify the extraction call was made with truncated content
      const extractionCall = mockQueryLlm.mock.calls[0];
      const prompt = extractionCall[0].prompt as string;
      // Content should be truncated to 30k chars in the prompt
      expect(prompt.length).toBeLessThan(50000);
    });

    it('passes historicalFigures to consolidation for historicalLore synthesis', async () => {
      const mockExtraction = {
        themes: ['epic'],
        characters: [
          {
            name: 'Aragorn',
            title: '',
            aliases: ['Strider', 'Elessar'],
            description: 'A ranger who is heir to the throne',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Epic',
        summary: 'The tale of Middle-earth.',
        historicalFigures: [
          'Isildur, ancient king who cut the Ring from Sauron',
          'Gil-galad, last High King of the Noldor who fell in the Last Alliance',
        ],
        historicalEvents: [],
        narrativePresent: 'Year 3019 of the Third Age',
      };

      const mockWorldBible: WorldBible = {
        themes: ['epic'],
        characters: [
          {
            name: 'Aragorn',
            title: '',
            aliases: ['Strider', 'Elessar'],
            description: 'A ranger who is heir to the throne',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: 'Middle-earth has a long history.',
        rules: [],
        tone: 'Epic',
        overview: 'The world of Middle-earth.',
        keyConflicts: [],
        atmosphere: 'Mythic',
        narrativePresent: 'Year 3019 of the Third Age',
        historicalLore:
          'In ages past, Isildur cut the Ring from Sauron. Gil-galad, the last High King of the Noldor, fell in the Last Alliance alongside Elendil.',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        { filename: 'lotr.txt', content: 'Content about Middle-earth', charCount: 25 },
      ];

      const result = await processDocuments(documents);

      // Verify consolidation was called with historicalFigures in the summary
      const consolidationCall = mockQueryLlm.mock.calls[1];
      const prompt = consolidationCall[0].prompt as string;
      expect(prompt).toContain('historicalFigures');
      expect(prompt).toContain('Isildur');

      // Verify result has synthesized historicalLore
      expect(result.historicalLore).toContain('Isildur');
    });

    it('extracts and preserves isSuitableStart for places', async () => {
      const mockExtraction = {
        themes: ['adventure'],
        characters: [],
        places: [
          {
            name: 'The Prancing Pony',
            description: 'A cozy inn at the crossroads',
            isSuitableStart: true,
            environment: 'interior',
            purpose: 'building',
            parentName: 'Cosmos',
          },
          {
            name: 'Mines of Moria',
            description: 'Dark and dangerous dwarven mines',
            isSuitableStart: false,
            environment: 'interior',
            purpose: 'passage',
            parentName: 'Cosmos',
          },
          {
            name: 'Rivendell',
            description: 'An elven sanctuary',
            isSuitableStart: true,
            environment: 'exterior',
            purpose: 'settlement',
            parentName: 'Cosmos',
          },
        ],
        loreElements: [],
        rules: [],
        tone: 'Fantasy',
        summary: 'A world with many locations.',
        historicalFigures: [],
        historicalEvents: [],
        narrativePresent: 'Third Age',
      };

      const mockWorldBible: WorldBible = {
        themes: ['adventure'],
        characters: [],
        places: [
          {
            name: 'The Prancing Pony',
            description: 'A cozy inn at the crossroads',
            isSuitableStart: true,
            environment: 'interior',
            purpose: 'building',
            parentName: 'Cosmos',
          },
          {
            name: 'Mines of Moria',
            description: 'Dark and dangerous dwarven mines',
            isSuitableStart: false,
            environment: 'interior',
            purpose: 'passage',
            parentName: 'Cosmos',
          },
          {
            name: 'Rivendell',
            description: 'An elven sanctuary',
            isSuitableStart: true,
            environment: 'exterior',
            purpose: 'settlement',
            parentName: 'Cosmos',
          },
        ],
        lore: 'A world of adventure.',
        rules: [],
        tone: 'Fantasy',
        overview: 'A fantasy world.',
        keyConflicts: [],
        atmosphere: 'Epic',
        narrativePresent: 'Third Age',
        historicalLore: '',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        { filename: 'places.txt', content: 'Description of various locations', charCount: 30 },
      ];

      const result = await processDocuments(documents);

      // Verify places have isSuitableStart
      expect(result.places).toHaveLength(3);

      const prancingPony = result.places.find((p) => p.name === 'The Prancing Pony');
      expect(prancingPony?.isSuitableStart).toBe(true);

      const moria = result.places.find((p) => p.name === 'Mines of Moria');
      expect(moria?.isSuitableStart).toBe(false);

      const rivendell = result.places.find((p) => p.name === 'Rivendell');
      expect(rivendell?.isSuitableStart).toBe(true);

      // Count startable places
      const startablePlaces = result.places.filter((p) => p.isSuitableStart === true);
      expect(startablePlaces).toHaveLength(2);
    });

    it('extracts character name, title, and aliases correctly', async () => {
      const mockExtraction = {
        themes: ['royalty'],
        characters: [
          {
            name: 'Meiloria',
            title: 'Queen',
            aliases: ['The Iron Queen', 'Mel'],
            description: 'The reigning monarch of the realm',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
          {
            name: 'Marcus Vale',
            title: 'Captain',
            aliases: ['The Shadow'],
            description: 'A veteran soldier who leads the royal guard',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
          {
            name: 'James Johnson',
            title: '',
            aliases: ['Jimmy', 'Two-Fingers'],
            description: 'A street-smart informant',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
        ],
        places: [],
        loreElements: [],
        rules: [],
        tone: 'Political drama',
        summary: 'A story of politics and intrigue.',
        historicalFigures: [],
        historicalEvents: [],
        narrativePresent: 'Year 500 of the Current Era',
      };

      const mockWorldBible: WorldBible = {
        themes: ['royalty'],
        characters: [
          {
            name: 'Meiloria',
            title: 'Queen',
            aliases: ['The Iron Queen', 'Mel'],
            description: 'The reigning monarch of the realm',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
          {
            name: 'Marcus Vale',
            title: 'Captain',
            aliases: ['The Shadow'],
            description: 'A veteran soldier who leads the royal guard',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
          {
            name: 'James Johnson',
            title: '',
            aliases: ['Jimmy', 'Two-Fingers'],
            description: 'A street-smart informant',
            temporalStatus: 'contemporary',
            activeEra: 'Current Era',
          },
        ],
        places: [],
        lore: 'A tale of politics.',
        rules: [],
        tone: 'Political drama',
        overview: 'A political drama.',
        keyConflicts: [],
        atmosphere: 'Tense',
        narrativePresent: 'Year 500 of the Current Era',
        historicalLore: '',
        historicalEvents: [],
      };

      mockQueryLlm
        .mockResolvedValueOnce({ content: mockExtraction })
        .mockResolvedValueOnce({ content: mockWorldBible });

      const documents: ParsedDocument[] = [
        { filename: 'story.txt', content: 'A political drama...', charCount: 20 },
      ];

      const result = await processDocuments(documents);

      // Verify character naming conventions are followed
      expect(result.characters).toHaveLength(3);

      // Queen Meiloria - title should be separate from name
      const queen = result.characters.find((c) => c.name === 'Meiloria');
      expect(queen).toBeDefined();
      expect(queen?.title).toBe('Queen');
      expect(queen?.aliases).toContain('The Iron Queen');
      expect(queen?.aliases).toContain('Mel');

      // Captain Marcus Vale - title should be separate
      const captain = result.characters.find((c) => c.name === 'Marcus Vale');
      expect(captain).toBeDefined();
      expect(captain?.title).toBe('Captain');
      expect(captain?.aliases).toContain('The Shadow');

      // James Johnson - no title, just aliases (nicknames)
      const james = result.characters.find((c) => c.name === 'James Johnson');
      expect(james).toBeDefined();
      expect(james?.title).toBe('');
      expect(james?.aliases).toContain('Jimmy');
      expect(james?.aliases).toContain('Two-Fingers');
    });
  });
});
