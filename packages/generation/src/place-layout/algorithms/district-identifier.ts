/**
 * District Center Identification
 *
 * Analyzes road graph topology to identify district centers.
 * Each district config declares a seed strategy; this module
 * resolves strategies to concrete tile positions.
 */
import type { RoadGraph, ResolvedDistrict } from '@dmnpc/types/world';
import type { DistrictConfig } from '@dmnpc/types/world';

/**
 * Compute node degree (number of edges) for each node in a road graph.
 * Returns array parallel to graph.nodes with degree counts.
 */
export function computeNodeDegrees(graph: RoadGraph): number[] {
  const degrees = new Array<number>(graph.nodes.length).fill(0);
  for (const edge of graph.edges) {
    degrees[edge.from]++;
    degrees[edge.to]++;
  }
  return degrees;
}

/**
 * Resolve district configs to concrete center positions using road topology.
 *
 * Strategies:
 * - highest_degree: intersection node with most edges (not already claimed)
 * - branch_terminus: branch/endpoint node farthest from already-claimed centers
 *
 * Returns one ResolvedDistrict per config. If the graph lacks suitable nodes,
 * falls back to any available node. Returns empty array if graph has no nodes.
 */
export function identifyDistrictCenters(
  graph: RoadGraph,
  configs: DistrictConfig[],
): ResolvedDistrict[] {
  if (graph.nodes.length === 0 || configs.length === 0) return [];

  const degrees = computeNodeDegrees(graph);
  const claimed = new Set<number>(); // node indices already used
  const resolved: ResolvedDistrict[] = [];

  for (const config of configs) {
    let bestIdx = -1;

    if (config.seedStrategy === 'highest_degree') {
      // Pick highest-degree intersection not already claimed
      let bestDegree = -1;
      for (let i = 0; i < graph.nodes.length; i++) {
        if (claimed.has(i)) continue;
        if (graph.nodes[i].type !== 'intersection') continue;
        if (degrees[i] > bestDegree) {
          bestDegree = degrees[i];
          bestIdx = i;
        }
      }
      // Fallback: any unclaimed node
      if (bestIdx === -1) {
        for (let i = 0; i < graph.nodes.length; i++) {
          if (!claimed.has(i)) {
            bestIdx = i;
            break;
          }
        }
      }
    } else {
      // branch_terminus: pick branch/endpoint node farthest from all claimed centers
      let bestDist = -1;
      for (let i = 0; i < graph.nodes.length; i++) {
        if (claimed.has(i)) continue;
        const node = graph.nodes[i];
        if (node.type !== 'endpoint' && node.type !== 'branch') continue;
        // Distance to nearest claimed center (or Infinity if none claimed)
        let minDist = Infinity;
        for (const ci of claimed) {
          const cn = graph.nodes[ci];
          const d = Math.hypot(node.x - cn.x, node.y - cn.y);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestDist) {
          bestDist = minDist;
          bestIdx = i;
        }
      }
      // Fallback: any unclaimed node
      if (bestIdx === -1) {
        for (let i = 0; i < graph.nodes.length; i++) {
          if (!claimed.has(i)) {
            bestIdx = i;
            break;
          }
        }
      }
    }

    if (bestIdx === -1) continue; // no nodes left

    claimed.add(bestIdx);
    const node = graph.nodes[bestIdx];
    resolved.push({
      id: config.id,
      center: { x: node.x, y: node.y },
      influenceRadius: config.influenceRadius,
      weight: config.weight,
    });
  }

  return resolved;
}
