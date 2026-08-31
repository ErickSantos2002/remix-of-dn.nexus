export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color?: string;
}

/**
 * Validates if a lead can move from current stage to target stage.
 * Only allows movement of exactly 1 step (forward or backward).
 */
export function canMoveToStage(currentOrder: number, targetOrder: number): boolean {
  return Math.abs(targetOrder - currentOrder) === 1;
}

/**
 * Returns the next stage in the pipeline, or null if at the last stage.
 */
export function getNextStage(stages: PipelineStage[], currentStageId: string): PipelineStage | null {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((s) => s.id === currentStageId);
  if (currentIndex === -1 || currentIndex >= sorted.length - 1) return null;
  return sorted[currentIndex + 1];
}

/**
 * Returns the previous stage in the pipeline, or null if at the first stage.
 */
export function getPrevStage(stages: PipelineStage[], currentStageId: string): PipelineStage | null {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((s) => s.id === currentStageId);
  if (currentIndex <= 0) return null;
  return sorted[currentIndex - 1];
}

/**
 * Returns only the stages adjacent to the current one (prev + current + next).
 */
export function getAdjacentStages(stages: PipelineStage[], currentStageId: string): PipelineStage[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((s) => s.id === currentStageId);
  if (currentIndex === -1) return sorted;

  const result: PipelineStage[] = [];
  if (currentIndex > 0) result.push(sorted[currentIndex - 1]);
  result.push(sorted[currentIndex]);
  if (currentIndex < sorted.length - 1) result.push(sorted[currentIndex + 1]);
  return result;
}

/**
 * Returns only the first N stages (for new lead creation).
 */
export function getInitialStages(stages: PipelineStage[], maxOrder = 1): PipelineStage[] {
  return [...stages].sort((a, b) => a.order - b.order).filter((s) => s.order <= maxOrder);
}
