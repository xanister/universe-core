/**
 * Unit tests for district center identification.
 *
 * Tests topology analysis that resolves district configs
 * to concrete center positions from road graph structure.
 */

import { describe, it, expect } from 'vitest';
import {
  computeNodeDegrees,
  identifyDistrictCenters,
} from '../../../src/place-layout/algorithms/district-identifier.js';
import type { RoadGraph } from '@dmnpc/types/world';
import type { DistrictConfig } from '@dmnpc/types/world';

describe('computeNodeDegrees', () => {
  it('computes degree for each node', () => {
    const graph: RoadGraph = {
      nodes: [
        { x: 0, y: 0, type: 'endpoint' },
        { x: 10, y: 0, type: 'intersection' },
        { x: 20, y: 0, type: 'endpoint' },
      ],
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
    };
    expect(computeNodeDegrees(graph)).toEqual([1, 2, 1]);
  });

  it('handles nodes with many edges', () => {
    const graph: RoadGraph = {
      nodes: [
        { x: 10, y: 10, type: 'intersection' },
        { x: 0, y: 10, type: 'endpoint' },
        { x: 20, y: 10, type: 'endpoint' },
        { x: 10, y: 0, type: 'branch' },
        { x: 10, y: 20, type: 'branch' },
      ],
      edges: [
        { from: 0, to: 1 },
        { from: 0, to: 2 },
        { from: 0, to: 3 },
        { from: 0, to: 4 },
      ],
    };
    expect(computeNodeDegrees(graph)).toEqual([4, 1, 1, 1, 1]);
  });

  it('returns zeros for graph with no edges', () => {
    const graph: RoadGraph = {
      nodes: [{ x: 0, y: 0, type: 'endpoint' }],
      edges: [],
    };
    expect(computeNodeDegrees(graph)).toEqual([0]);
  });
});

describe('identifyDistrictCenters', () => {
  it('returns empty array for empty graph', () => {
    const graph: RoadGraph = { nodes: [], edges: [] };
    const configs: DistrictConfig[] = [
      { id: 'market', seedStrategy: 'highest_degree', influenceRadius: 20, weight: 0.7 },
    ];
    expect(identifyDistrictCenters(graph, configs)).toEqual([]);
  });

  it('returns empty array for empty configs', () => {
    const graph: RoadGraph = {
      nodes: [{ x: 10, y: 10, type: 'intersection' }],
      edges: [],
    };
    expect(identifyDistrictCenters(graph, [])).toEqual([]);
  });

  it('highest_degree picks the intersection with most edges', () => {
    // Node 0: degree 2, Node 1: degree 4 (highest), Node 2: degree 3
    const graph: RoadGraph = {
      nodes: [
        { x: 0, y: 0, type: 'intersection' },
        { x: 10, y: 10, type: 'intersection' },
        { x: 20, y: 20, type: 'intersection' },
        { x: 10, y: 0, type: 'endpoint' },
        { x: 10, y: 20, type: 'endpoint' },
      ],
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 1, to: 3 },
        { from: 1, to: 4 },
        { from: 0, to: 2 },
      ],
    };
    const configs: DistrictConfig[] = [
      { id: 'market', seedStrategy: 'highest_degree', influenceRadius: 15, weight: 0.8 },
    ];
    const result = identifyDistrictCenters(graph, configs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('market');
    expect(result[0].center).toEqual({ x: 10, y: 10 }); // node 1
    expect(result[0].influenceRadius).toBe(15);
    expect(result[0].weight).toBe(0.8);
  });

  it('highest_degree avoids already-claimed nodes', () => {
    // Two highest_degree configs → picks top two distinct intersection nodes
    // Node 0: degree 2 (0→1, 0→2), Node 1: degree 4 (0→1, 1→2, 1→3, 1→4), Node 2: degree 3 (0→2, 1→2, 2→5)
    const graph: RoadGraph = {
      nodes: [
        { x: 0, y: 0, type: 'intersection' },
        { x: 10, y: 10, type: 'intersection' },
        { x: 20, y: 20, type: 'intersection' },
        { x: 10, y: 0, type: 'endpoint' },
        { x: 10, y: 20, type: 'endpoint' },
        { x: 30, y: 20, type: 'endpoint' },
      ],
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 1, to: 3 },
        { from: 1, to: 4 },
        { from: 0, to: 2 },
        { from: 2, to: 5 },
      ],
    };
    const configs: DistrictConfig[] = [
      { id: 'civic', seedStrategy: 'highest_degree', influenceRadius: 20, weight: 0.7 },
      { id: 'market', seedStrategy: 'highest_degree', influenceRadius: 15, weight: 0.6 },
    ];
    const result = identifyDistrictCenters(graph, configs);
    expect(result).toHaveLength(2);
    // First picks node 1 (degree 4), second picks node 2 (degree 3)
    expect(result[0].center).toEqual({ x: 10, y: 10 });
    expect(result[1].center).toEqual({ x: 20, y: 20 });
  });

  it('branch_terminus picks branch/endpoint farthest from claimed centers', () => {
    const graph: RoadGraph = {
      nodes: [
        { x: 50, y: 50, type: 'intersection' },  // center hub
        { x: 40, y: 45, type: 'endpoint' },       // close to hub (~11 tiles)
        { x: 100, y: 100, type: 'branch' },       // far from hub (~71 tiles)
        { x: 60, y: 50, type: 'branch' },         // close to hub (10 tiles)
      ],
      edges: [
        { from: 0, to: 1 },
        { from: 0, to: 2 },
        { from: 0, to: 3 },
      ],
    };
    const configs: DistrictConfig[] = [
      // First claim the hub as civic
      { id: 'civic', seedStrategy: 'highest_degree', influenceRadius: 20, weight: 0.7 },
      // Then branch_terminus should pick the farthest endpoint/branch from hub
      { id: 'residential', seedStrategy: 'branch_terminus', influenceRadius: 25, weight: 0.5 },
    ];
    const result = identifyDistrictCenters(graph, configs);
    expect(result).toHaveLength(2);
    expect(result[0].center).toEqual({ x: 50, y: 50 }); // civic at hub
    // residential should be at (100,100) — farthest branch/endpoint from (50,50)
    expect(result[1].center).toEqual({ x: 100, y: 100 });
  });

  it('falls back to any unclaimed node when no matching type exists', () => {
    // Graph with only endpoints, highest_degree wants intersections
    const graph: RoadGraph = {
      nodes: [
        { x: 0, y: 0, type: 'endpoint' },
        { x: 10, y: 10, type: 'endpoint' },
      ],
      edges: [{ from: 0, to: 1 }],
    };
    const configs: DistrictConfig[] = [
      { id: 'market', seedStrategy: 'highest_degree', influenceRadius: 15, weight: 0.7 },
    ];
    const result = identifyDistrictCenters(graph, configs);
    expect(result).toHaveLength(1);
    // Falls back to first unclaimed node
    expect(result[0].center).toEqual({ x: 0, y: 0 });
  });

  it('branch_terminus with no claimed centers picks first matching node', () => {
    const graph: RoadGraph = {
      nodes: [
        { x: 0, y: 0, type: 'endpoint' },
        { x: 50, y: 50, type: 'branch' },
      ],
      edges: [{ from: 0, to: 1 }],
    };
    const configs: DistrictConfig[] = [
      { id: 'residential', seedStrategy: 'branch_terminus', influenceRadius: 25, weight: 0.5 },
    ];
    const result = identifyDistrictCenters(graph, configs);
    expect(result).toHaveLength(1);
    // With no claimed centers, minDist is Infinity for all candidates — picks first
    expect(result[0].id).toBe('residential');
  });
});
