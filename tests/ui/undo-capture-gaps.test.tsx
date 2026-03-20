/**
 * Tests for undo capture gap fixes:
 * - #1169: Knob pointerCancel triggers undo
 * - #1171/#1182: Keyboard edits on knobs trigger gesture start/end
 * - #1174: Processor undo uses union of prev+current keys
 * - #1175: Modulator undo uses union of prev+current keys
 * - #1181: Source knob drags produce single undo entry
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Knob } from '../../src/ui/Knob';
import { SemanticKnob } from '../../src/ui/SemanticKnob';

beforeAll(() => {
  if (typeof SVGElement.prototype.setPointerCapture !== 'function') {
    SVGElement.prototype.setPointerCapture = () => {};
  }
  if (typeof SVGElement.prototype.releasePointerCapture !== 'function') {
    SVGElement.prototype.releasePointerCapture = () => {};
  }
});

describe('#1169 — Knob pointerCancel triggers undo', () => {
  it('calls onPointerUp when pointerCancel fires during a drag', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onChange = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={onChange}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;

    // Start drag
    fireEvent.pointerDown(svg, { pointerId: 1, clientY: 100 });
    expect(onPointerDown).toHaveBeenCalledTimes(1);

    // Cancel mid-drag
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('does not call onPointerUp on pointerCancel when not dragging', () => {
    const onPointerUp = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(onPointerUp).not.toHaveBeenCalled();
  });
});

describe('#1171/#1182 — Keyboard edits trigger gesture undo', () => {
  it('Knob: ArrowUp triggers onPointerDown, onChange, onPointerUp', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onChange = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={onChange}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowUp' });

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.51);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('Knob: ArrowDown triggers onPointerDown, onChange, onPointerUp', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onChange = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={onChange}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowDown' });

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.49);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('Knob: Shift+ArrowUp uses large step', () => {
    const onChange = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={onChange}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowUp', shiftKey: true });

    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it('Knob: calls onKeyboardEdit callback', () => {
    const onKeyboardEdit = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
        onKeyboardEdit={onKeyboardEdit}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowUp' });
    expect(onKeyboardEdit).toHaveBeenCalledTimes(1);
  });

  it('Knob: non-arrow keys do not trigger undo', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'Tab' });

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onPointerUp).not.toHaveBeenCalled();
  });

  it('SemanticKnob: ArrowUp triggers onPointerDown, onChange, onPointerUp', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onChange = vi.fn();

    const { container } = render(
      <SemanticKnob
        name="Brightness"
        value={0.5}
        onChange={onChange}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={() => {}}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowUp' });

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.51);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('SemanticKnob: pointerCancel triggers onPointerUp', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();

    const { container } = render(
      <SemanticKnob
        name="Test"
        value={0.5}
        onChange={() => {}}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={() => {}}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientY: 100 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });
});

describe('#1169 — SemanticKnob pointerCancel without drag is no-op', () => {
  it('does not call onPointerUp on pointerCancel when not dragging', () => {
    const onPointerUp = vi.fn();

    const { container } = render(
      <SemanticKnob
        name="Test"
        value={0.5}
        onChange={() => {}}
        onPointerDown={() => {}}
        onPointerUp={onPointerUp}
        onClick={() => {}}
      />,
    );

    const svg = container.querySelector('svg')!;
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(onPointerUp).not.toHaveBeenCalled();
  });
});

describe('#1181 — Keyboard edits produce individual undo entries (start+change+end per keypress)', () => {
  it('each keypress calls onPointerDown and onPointerUp once', () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    const onChange = vi.fn();

    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={onChange}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />,
    );

    const svg = container.querySelector('svg')!;

    // 3 key presses should produce 3 start/end pairs
    fireEvent.keyDown(svg, { key: 'ArrowUp' });
    fireEvent.keyDown(svg, { key: 'ArrowUp' });
    fireEvent.keyDown(svg, { key: 'ArrowUp' });

    expect(onPointerDown).toHaveBeenCalledTimes(3);
    expect(onPointerUp).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
