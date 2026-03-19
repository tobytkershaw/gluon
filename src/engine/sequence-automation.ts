import type { Pattern } from './canonical-types';
import type { PatternRef, SequenceAutomationLane, SequenceAutomationPoint } from './sequencer-types';

function applyCurveTension(t: number, tension: number): number {
  if (tension === 0) return t;
  const exponent = Math.pow(2, -tension);
  return Math.pow(t, exponent);
}

export function interpolateSequenceAutomationValue(
  fromPoint: SequenceAutomationPoint,
  toPoint: SequenceAutomationPoint,
  at: number,
): number {
  const duration = toPoint.at - fromPoint.at;
  if (duration <= 0) return fromPoint.value;

  const mode = fromPoint.interpolation ?? 'step';
  if (mode === 'step') return fromPoint.value;

  let t = (at - fromPoint.at) / duration;
  t = Math.max(0, Math.min(1, t));

  if (mode === 'curve') {
    const tension = Math.max(-1, Math.min(1, fromPoint.tension ?? 0));
    t = applyCurveTension(t, tension);
  }

  return fromPoint.value + (toPoint.value - fromPoint.value) * t;
}

export function normalizeSequenceAutomationPoints(points: SequenceAutomationPoint[]): SequenceAutomationPoint[] {
  const sorted = [...points]
    .map(point => ({
      at: point.at,
      value: Math.max(0, Math.min(1, point.value)),
      ...(point.interpolation ? { interpolation: point.interpolation } : {}),
      ...(point.tension !== undefined ? { tension: Math.max(-1, Math.min(1, point.tension)) } : {}),
    }))
    .sort((a, b) => a.at - b.at);

  const normalized: SequenceAutomationPoint[] = [];
  for (const point of sorted) {
    const previous = normalized[normalized.length - 1];
    if (previous && Math.abs(previous.at - point.at) < 0.0001) {
      normalized[normalized.length - 1] = point;
      continue;
    }
    normalized.push(point);
  }
  return normalized;
}

function findSegmentPoints(
  points: SequenceAutomationPoint[],
  at: number,
): { previous?: SequenceAutomationPoint; next?: SequenceAutomationPoint; exact?: SequenceAutomationPoint } {
  let previous: SequenceAutomationPoint | undefined;

  for (const point of points) {
    if (Math.abs(point.at - at) < 0.0001) {
      return { previous: point, next: point, exact: point };
    }
    if (point.at < at) {
      previous = point;
      continue;
    }
    return { previous, next: point };
  }

  return { previous };
}

export function evaluateSequenceAutomationAt(
  points: SequenceAutomationPoint[],
  at: number,
): SequenceAutomationPoint | undefined {
  if (points.length === 0) return undefined;
  const segment = findSegmentPoints(points, at);
  if (segment.exact) return segment.exact;
  if (segment.previous && segment.next) {
    return {
      at,
      value: interpolateSequenceAutomationValue(segment.previous, segment.next, at),
      interpolation: segment.previous.interpolation,
      tension: segment.previous.tension,
    };
  }
  if (segment.previous) {
    return {
      at,
      value: segment.previous.value,
      interpolation: 'step',
    };
  }
  return undefined;
}

function upsertLane(
  ref: PatternRef,
  controlId: string,
  lane: SequenceAutomationLane | undefined,
): PatternRef {
  const existing = (ref.automation ?? []).filter(candidate => candidate.controlId !== controlId);
  if (!lane || lane.points.length === 0) {
    return existing.length > 0 ? { ...ref, automation: existing } : { patternId: ref.patternId };
  }
  return { ...ref, automation: [...existing, lane] };
}

export function splitSequenceAutomationAcrossRefs(
  sequence: PatternRef[],
  patterns: Pattern[],
  controlId: string,
  inputPoints: SequenceAutomationPoint[],
): PatternRef[] {
  const points = normalizeSequenceAutomationPoints(inputPoints);
  if (points.length === 0) {
    return sequence.map(ref => upsertLane(ref, controlId, undefined));
  }

  let offset = 0;
  return sequence.map(ref => {
    const pattern = patterns.find(candidate => candidate.id === ref.patternId);
    if (!pattern || pattern.duration <= 0) return upsertLane(ref, controlId, undefined);

    const start = offset;
    const end = offset + pattern.duration;
    offset = end;

    const localPoints: SequenceAutomationPoint[] = [];
    const startPoint = evaluateSequenceAutomationAt(points, start);
    if (startPoint) {
      localPoints.push({
        at: 0,
        value: startPoint.value,
        ...(startPoint.interpolation ? { interpolation: startPoint.interpolation } : {}),
        ...(startPoint.tension !== undefined ? { tension: startPoint.tension } : {}),
      });
    }

    for (const point of points) {
      if (point.at <= start || point.at >= end) continue;
      localPoints.push({
        at: point.at - start,
        value: point.value,
        ...(point.interpolation ? { interpolation: point.interpolation } : {}),
        ...(point.tension !== undefined ? { tension: point.tension } : {}),
      });
    }

    const endPoint = evaluateSequenceAutomationAt(points, end);
    if (endPoint && Math.abs(endPoint.at - start) > 0.0001) {
      localPoints.push({
        at: pattern.duration,
        value: endPoint.value,
      });
    }

    const normalizedLocal = normalizeSequenceAutomationPoints(localPoints);
    if (normalizedLocal.length === 0) {
      return upsertLane(ref, controlId, undefined);
    }

    return upsertLane(ref, controlId, {
      controlId,
      points: normalizedLocal,
    });
  });
}

export function getSequenceAutomationValue(
  ref: PatternRef | undefined,
  controlId: string,
  localAt: number,
): number | undefined {
  const lane = ref?.automation?.find(candidate => candidate.controlId === controlId);
  if (!lane) return undefined;
  return evaluateSequenceAutomationAt(lane.points, localAt)?.value;
}

export function getSequenceAutomationValuesAt(
  ref: PatternRef | undefined,
  localAt: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const lane of ref?.automation ?? []) {
    const value = evaluateSequenceAutomationAt(lane.points, localAt)?.value;
    if (value !== undefined) result[lane.controlId] = value;
  }
  return result;
}

export function hasSequenceAutomationPointAt(
  ref: PatternRef | undefined,
  controlId: string,
  localAt: number,
): boolean {
  return Boolean(ref?.automation?.some(lane =>
    lane.controlId === controlId
    && lane.points.some(point => Math.abs(point.at - localAt) < 0.0001)
  ));
}
