/**
 * Plot Quality Heuristics
 *
 * Pure functions for checking plot quality. These heuristics define "what good looks like"
 * and are used by:
 * - plot-agent.ts (during generation for validation/repair loops)
 * - plot-quality.ts validator (studio validation)
 *
 * IMPORTANT: This module must not import from game/ or studio/ - only @dmnpc/types
 * and simple logic. This keeps it usable in both contexts.
 */

import type { PlotGoal, PlotTurningPoint, DramaticRole } from '@dmnpc/types/npc';

/**
 * Severity levels for quality issues.
 */
export type QualityIssueSeverity = 'error' | 'warning' | 'info';

/**
 * A quality issue detected by a heuristic.
 * Designed to be convertible to PlotValidationIssue by the validator adapter.
 */
export interface QualityIssue {
  /** Unique rule identifier for this check */
  rule: string;
  /** Human-readable description of the issue */
  message: string;
  /** Severity of the issue */
  severity: QualityIssueSeverity;
  /** Optional field path for the issue */
  field?: string;
  /** Optional goal ID if goal-specific */
  goalId?: string;
  /** Optional turning point ID if TP-specific */
  turningPointId?: string;
  /** Optional suggestion for fixing */
  suggestion?: string;
}

/**
 * Minimal plot shape required for quality checks.
 * Allows use with both PlotDefinition and StorytellerPlan.
 */
export interface PlotQualityInput {
  goals?: PlotGoal[];
  turningPoints?: PlotTurningPoint[];
  possibleFlags?: Array<{ id: string; triggerDescription?: string }>;
}

/**
 * Result of running all quality heuristics.
 */
export interface QualityCheckResult {
  /** All issues found */
  issues: QualityIssue[];
  /** Summary counts by rule */
  counts: Record<string, number>;
  /** Whether all required checks passed (no errors) */
  valid: boolean;
}

/**
 * Get the intensity index for a dramatic role (higher = more intense).
 */
function getDramaticIntensity(role: DramaticRole): number {
  // Climax is peak intensity, resolution is denouement
  const intensityMap: Record<DramaticRole, number> = {
    inciting_incident: 1,
    rising_action: 2,
    midpoint: 3,
    crisis: 4,
    climax: 5,
    resolution: 2, // Resolution drops intensity (denouement)
  };
  return intensityMap[role];
}

/**
 * Check that at least one goal has stakes defined.
 * Stakes clarity helps players understand why they should care.
 */
export function checkStakesClarity(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const goals = input.goals ?? [];

  if (goals.length === 0) {
    return issues; // No goals to check
  }

  const goalsWithStakes = goals.filter((g) => g.stakes && g.stakes.trim().length > 0);

  if (goalsWithStakes.length === 0) {
    issues.push({
      rule: 'stakes_clarity',
      message:
        'No goals have stakes defined. Consider adding stakes to at least one goal to clarify what happens if the player fails.',
      severity: 'warning',
      field: 'goals',
      suggestion: 'Add a "stakes" field to your primary goal describing consequences of failure.',
    });
  }

  // Also check long_term goals specifically - they should have stakes
  const longTermGoals = goals.filter((g) => g.goalType === 'long_term');
  for (const goal of longTermGoals) {
    if (!goal.stakes || goal.stakes.trim().length === 0) {
      issues.push({
        rule: 'stakes_clarity',
        message: `Long-term goal "${goal.id}" should have stakes defined to clarify consequences.`,
        severity: 'info',
        field: 'stakes',
        goalId: goal.id,
        suggestion: 'Long-term goals benefit from clear stakes to maintain player investment.',
      });
    }
  }

  return issues;
}

/**
 * Check that turning points escalate in dramatic intensity.
 * Non-resolution TPs should generally increase in intensity as progress increases.
 */
export function checkEscalation(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const turningPoints = input.turningPoints ?? [];

  if (turningPoints.length < 3) {
    return issues; // Not enough TPs to check escalation
  }

  const sorted = [...turningPoints].sort((a, b) => a.progressTarget - b.progressTarget);
  const nonResolution = sorted.filter((tp) => tp.dramaticRole !== 'resolution');

  let prevIntensity = 0;
  let deescalationCount = 0;

  for (const tp of nonResolution) {
    const intensity = getDramaticIntensity(tp.dramaticRole);
    if (intensity < prevIntensity) {
      deescalationCount++;
    }
    prevIntensity = intensity;
  }

  // Allow one de-escalation (stories can have breather moments), but flag multiple
  if (deescalationCount > 1) {
    issues.push({
      rule: 'escalation',
      message: `Turning points de-escalate in intensity ${deescalationCount} times. Consider reordering for better dramatic buildup.`,
      severity: 'warning',
      field: 'turningPoints',
      suggestion:
        'Ensure dramatic roles escalate: inciting_incident → rising_action → midpoint → crisis → climax.',
    });
  }

  const climax = turningPoints.find((tp) => tp.dramaticRole === 'climax');
  if (climax) {
    const higherProgressNonResolution = nonResolution.filter(
      (tp) => tp.progressTarget > climax.progressTarget && tp.dramaticRole !== 'climax',
    );
    if (higherProgressNonResolution.length > 0) {
      issues.push({
        rule: 'escalation',
        message: `Climax turning point has progressTarget ${climax.progressTarget}, but ${higherProgressNonResolution.length} other non-resolution TPs have higher values.`,
        severity: 'warning',
        turningPointId: climax.id,
        field: 'progressTarget',
        suggestion:
          'The climax should have the highest progressTarget among non-resolution turning points.',
      });
    }
  }

  return issues;
}

/**
 * Check for branching goals (player agency).
 * At least one pair of goals should have mutual blockedByFlags for meaningful choices.
 */
export function checkBranchingPresence(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const goals = input.goals ?? [];

  if (goals.length < 2) {
    return issues; // Need at least 2 goals for branching
  }

  const goalsWithBlocking = goals.filter((g) => g.blockedByFlags && g.blockedByFlags.length > 0);

  if (goalsWithBlocking.length === 0) {
    issues.push({
      rule: 'branching_presence',
      message:
        'No goals have blockedByFlags. Consider adding mutually exclusive goals for player agency.',
      severity: 'info',
      field: 'goals',
      suggestion: 'Add blockedByFlags to create branching paths where player choices matter.',
    });
    return issues;
  }

  // Check for mutual blocking (goal A blocks B and B blocks A via successFlags)
  let hasMutualBlocking = false;

  for (const goalA of goalsWithBlocking) {
    for (const goalB of goals) {
      if (goalA.id === goalB.id) continue;

      const aBlockedByB = goalA.blockedByFlags?.some((flag) => goalB.successFlags?.includes(flag));
      const bBlockedByA = goalB.blockedByFlags?.some((flag) => goalA.successFlags?.includes(flag));

      if (aBlockedByB && bBlockedByA) {
        hasMutualBlocking = true;
        break;
      }
    }
    if (hasMutualBlocking) break;
  }

  if (!hasMutualBlocking && goalsWithBlocking.length > 0) {
    issues.push({
      rule: 'branching_presence',
      message:
        'Goals have blockedByFlags but no mutual blocking was detected. Consider creating truly mutually exclusive choices.',
      severity: 'info',
      field: 'goals',
      suggestion:
        "For meaningful branching, goal A should be blocked by goal B's successFlags and vice versa.",
    });
  }

  return issues;
}

/**
 * Check that short_term and long_term goals have breadcrumbs.
 * Either immediateHint or linked immediate goals should provide next actions.
 */
export function checkBreadcrumbCoverage(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const goals = input.goals ?? [];

  const goalsNeedingBreadcrumbs = goals.filter(
    (g) => g.goalType === 'short_term' || g.goalType === 'long_term',
  );

  if (goalsNeedingBreadcrumbs.length === 0) {
    return issues;
  }

  const immediateGoals = goals.filter((g) => g.goalType === 'immediate');
  const immediateGoalRevealFlags = new Set(immediateGoals.flatMap((g) => g.revealOnFlags));

  for (const goal of goalsNeedingBreadcrumbs) {
    const hasImmediateHint = goal.immediateHint && goal.immediateHint.trim().length > 0;

    const goalFlags = [...(goal.successFlags ?? []), ...goal.revealOnFlags];
    const hasLinkedImmediate = goalFlags.some((flag) => immediateGoalRevealFlags.has(flag));

    if (!hasImmediateHint && !hasLinkedImmediate) {
      issues.push({
        rule: 'breadcrumb_coverage',
        message: `${goal.goalType} goal "${goal.id}" has no immediateHint and no linked immediate goals.`,
        severity: 'warning',
        field: 'immediateHint',
        goalId: goal.id,
        suggestion:
          'Add immediateHint with a concrete next action, or create immediate goals that reveal when this goal is active.',
      });
    }
  }

  return issues;
}

/**
 * Check for twist presence - at least one sub-question should be answered at climax.
 * This is a soft check since dramaticSubQuestions may not be present.
 */
export function checkTwistPresence(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const turningPoints = input.turningPoints ?? [];

  const climax = turningPoints.find((tp) => tp.dramaticRole === 'climax');

  if (!climax) {
    // No climax - this is caught by structure validator
    return issues;
  }

  const essentialInfo = climax.essentialInformation;

  if (essentialInfo.length === 0) {
    issues.push({
      rule: 'twist_presence',
      message:
        'Climax turning point has no essentialInformation. The climax should reveal something significant.',
      severity: 'warning',
      turningPointId: climax.id,
      field: 'essentialInformation',
      suggestion:
        'Add essentialInformation to the climax that reveals a truth, twist, or significant outcome.',
    });
  }

  // Check if any essential info suggests a revelation (heuristic)
  const revelationPatterns = [
    /true\s+(nature|identity|purpose|goal)/i,
    /reveal/i,
    /discover/i,
    /real(ly|ize)/i,
    /twist/i,
    /secret/i,
    /actual(ly)?/i,
    /all\s+along/i,
  ];

  const hasRevelation = essentialInfo.some((info) =>
    revelationPatterns.some((pattern) => pattern.test(info)),
  );

  if (!hasRevelation && essentialInfo.length > 0) {
    issues.push({
      rule: 'twist_presence',
      message: "Climax essentialInformation doesn't appear to contain a revelation or twist.",
      severity: 'info',
      turningPointId: climax.id,
      field: 'essentialInformation',
      suggestion:
        'Consider adding a revelation that subverts expectations or reveals hidden truth.',
    });
  }

  return issues;
}

/**
 * Check that goals have appropriate types assigned.
 * Goals should use the goalType field for proper layering.
 */
export function checkGoalTypeUsage(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const goals = input.goals ?? [];

  if (goals.length === 0) {
    return issues;
  }

  const goalsWithType = goals.filter((g) => g.goalType);
  const goalsWithoutType = goals.filter((g) => !g.goalType);

  if (goalsWithoutType.length > 0 && goalsWithType.length > 0) {
    // Mixed usage - some have types, some don't
    issues.push({
      rule: 'goal_type_usage',
      message: `${goalsWithoutType.length} goals are missing goalType while ${goalsWithType.length} have it. Consider adding goalType to all goals for consistent layering.`,
      severity: 'info',
      field: 'goalType',
      suggestion:
        'Use goalType (long_term, short_term, immediate) for all goals to enable proper goal hierarchy.',
    });
  }

  if (goalsWithType.length > 0) {
    const longTermGoals = goals.filter((g) => g.goalType === 'long_term');
    if (longTermGoals.length === 0) {
      issues.push({
        rule: 'goal_type_usage',
        message:
          'Goals use goalType but none are marked as long_term. The overarching quest goal should be long_term.',
        severity: 'warning',
        field: 'goalType',
        suggestion: 'Mark the main quest objective as goalType: "long_term".',
      });
    }
  }

  return issues;
}

/**
 * Check that essentialInformation is player-focused.
 * Should describe what the player experiences/learns/decides, not just what happens.
 */
export function checkPlayerFocusedInformation(input: PlotQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const turningPoints = input.turningPoints ?? [];

  const playerFocusedPatterns = [
    /\bplayer\b/i,
    /\byou\b/i,
    /\bthe\s+character\b/i,
    /\blearn/i,
    /\bdiscover/i,
    /\brealize/i,
    /\bdecide/i,
    /\bchoose/i,
    /\bwitness/i,
    /\bexperience/i,
    /\bconfronted\s+with\b/i,
    /\bmust\b/i,
  ];

  for (const tp of turningPoints) {
    const essentialInfo = tp.essentialInformation;

    for (let i = 0; i < essentialInfo.length; i++) {
      const info = essentialInfo[i];
      const isPlayerFocused = playerFocusedPatterns.some((pattern) => pattern.test(info));

      if (!isPlayerFocused) {
        issues.push({
          rule: 'player_focused_info',
          message: `Turning point "${tp.id}" essentialInformation[${i}] may not be player-focused: "${info.slice(0, 60)}..."`,
          severity: 'info',
          turningPointId: tp.id,
          field: 'essentialInformation',
          suggestion:
            'Rephrase to describe what the player experiences/learns/decides (e.g., "The player learns X" not "X happens").',
        });
      }
    }
  }

  return issues;
}

/**
 * Run all quality heuristics on a plot.
 *
 * @param input - Minimal plot shape with goals and turning points
 * @returns Combined result of all quality checks
 */
export function checkPlotQuality(input: PlotQualityInput): QualityCheckResult {
  const allIssues: QualityIssue[] = [];

  allIssues.push(...checkStakesClarity(input));
  allIssues.push(...checkEscalation(input));
  allIssues.push(...checkBranchingPresence(input));
  allIssues.push(...checkBreadcrumbCoverage(input));
  allIssues.push(...checkTwistPresence(input));
  allIssues.push(...checkGoalTypeUsage(input));
  // NOTE: checkGoalTiming was removed - the keyword-matching heuristic produced
  // too many false positives. Goal timing is now handled via prompt guidance only.
  allIssues.push(...checkPlayerFocusedInformation(input));

  const counts: Record<string, number> = {};
  for (const issue of allIssues) {
    counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
  }

  const hasErrors = allIssues.some((i) => i.severity === 'error');

  return {
    issues: allIssues,
    counts,
    valid: !hasErrors,
  };
}
