import { describe, expect, it } from 'vitest';
import { AITurnEpoch } from '../../src/ui/ai-turn-epoch';

describe('AITurnEpoch', () => {
  it('marks earlier turn tokens stale after invalidate', () => {
    const epoch = new AITurnEpoch();
    const turn1 = epoch.begin();

    epoch.invalidate();

    expect(epoch.isCurrent(turn1)).toBe(false);
  });

  it('marks earlier turn tokens stale after a newer turn begins', () => {
    const epoch = new AITurnEpoch();
    const turn1 = epoch.begin();
    const turn2 = epoch.begin();

    expect(epoch.isCurrent(turn1)).toBe(false);
    expect(epoch.isCurrent(turn2)).toBe(true);
  });
});
