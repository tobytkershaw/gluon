// src/ui/usePlayheadPosition.ts
// Hook: provides a smooth fractional playhead position using requestAnimationFrame,
// decoupled from the 25ms scheduler tick. Interpolates between scheduler updates
// based on BPM and elapsed time for jitter-free visual updates at 60fps.

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Smooth playhead position for visual rendering.
 *
 * The scheduler fires onPositionChange every ~25ms via setInterval, but
 * setInterval has significant jitter (10-50ms). When the UI floors the
 * fractional position to integer steps, the playhead snaps unevenly —
 * sometimes holding a step too long, sometimes jumping too fast.
 *
 * This hook runs a requestAnimationFrame loop that interpolates the position
 * between scheduler ticks using the known BPM, producing a smooth 60fps
 * fractional position. The scheduler position is used as ground truth to
 * correct drift, while rAF provides visual smoothness between corrections.
 *
 * Returns:
 * - `playheadStep`: integer step for row highlighting (which row is active)
 * - `playheadFraction`: 0-1 progress within the current step (for visual indicator)
 */
export function usePlayheadPosition(
  /** Raw globalStep from the scheduler (fractional, updated every ~25ms). */
  schedulerStep: number,
  /** Whether transport is playing. */
  playing: boolean,
  /** Current BPM for interpolation. */
  bpm: number,
  /** Pattern duration for wrapping (0 = no wrap). */
  wrapLength: number,
): { playheadStep: number; playheadFraction: number } {
  // Smooth fractional position, updated at 60fps
  const [smoothPosition, setSmoothPosition] = useState(schedulerStep);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastSchedulerStepRef = useRef(schedulerStep);
  const smoothPositionRef = useRef(schedulerStep);

  // Sync ground truth from scheduler — snap when not playing or on large jumps
  const handleSchedulerUpdate = useCallback((newStep: number) => {
    lastSchedulerStepRef.current = newStep;
    if (!playing) {
      smoothPositionRef.current = newStep;
      setSmoothPosition(newStep);
    }
  }, [playing]);

  // Update when scheduler step changes
  useEffect(() => {
    handleSchedulerUpdate(schedulerStep); // eslint-disable-line react-hooks/set-state-in-effect -- syncing external scheduler state
  }, [schedulerStep, handleSchedulerUpdate]);

  // rAF interpolation loop
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const stepsPerSecond = (bpm * 4) / 60; // 16th notes per second

    const animate = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(animate);

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
        return;
      }

      const dt = (timestamp - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = timestamp;

      // Advance the smooth position by BPM-based delta
      let newPos = smoothPositionRef.current + dt * stepsPerSecond;

      // Wrap if needed
      if (wrapLength > 0) {
        newPos = newPos % wrapLength;
        // Handle wrap-around when scheduler has wrapped but our interpolation hasn't
        const schedulerPos = lastSchedulerStepRef.current;
        const diff = schedulerPos - newPos;
        if (Math.abs(diff) > wrapLength / 2) {
          // Scheduler wrapped around — snap to its position
          newPos = schedulerPos;
        }
      }

      // Correct drift toward scheduler ground truth.
      // Blend toward the scheduler's reported position to prevent unbounded drift.
      const schedulerPos = lastSchedulerStepRef.current;
      let error = schedulerPos - newPos;

      // Handle wrap-around in error calculation
      if (wrapLength > 0 && Math.abs(error) > wrapLength / 2) {
        if (error > 0) error -= wrapLength;
        else error += wrapLength;
      }

      // Soft correction: blend 20% toward scheduler each frame
      // This keeps the visual smooth while preventing drift
      newPos += error * 0.2;

      // Wrap again after correction
      if (wrapLength > 0 && newPos < 0) newPos += wrapLength;
      if (wrapLength > 0) newPos = newPos % wrapLength;

      smoothPositionRef.current = newPos;
      setSmoothPosition(newPos);
    };

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [playing, bpm, wrapLength]);

  // When stopping, snap to scheduler position
  useEffect(() => {
    if (!playing) {
      smoothPositionRef.current = schedulerStep;
      setSmoothPosition(schedulerStep); // eslint-disable-line react-hooks/set-state-in-effect -- syncing external scheduler state
    }
  }, [playing, schedulerStep]);

  const playheadStep = Math.floor(smoothPosition);
  const playheadFraction = smoothPosition - playheadStep;

  return { playheadStep, playheadFraction };
}
