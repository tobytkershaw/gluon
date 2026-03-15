import type { Transport } from './sequencer-types';

export type TransportStatus = Transport['status'];

export interface RuntimeTransportState {
  status: TransportStatus;
  playheadBeats: number;
  anchorAudioTime: number | null;
  generation: number;
  bpm: number;
  swing: number;
}

export function normalizeTransport(transport: Transport): Transport {
  const status = transport.status ?? (transport.playing ? 'playing' : 'stopped');
  return {
    ...transport,
    status,
    playing: status === 'playing',
  };
}

export function createRuntimeTransport(transport: Transport): RuntimeTransportState {
  const normalized = normalizeTransport(transport);
  return {
    status: normalized.status,
    playheadBeats: 0,
    anchorAudioTime: null,
    generation: 0,
    bpm: normalized.bpm,
    swing: normalized.swing,
  };
}

export function playTransportState(state: RuntimeTransportState, audioTime: number, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'playing',
    anchorAudioTime: audioTime,
    generation,
  };
}

export function pauseTransportState(state: RuntimeTransportState, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'paused',
    anchorAudioTime: null,
    generation,
  };
}

export function stopTransportState(state: RuntimeTransportState, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'stopped',
    playheadBeats: 0,
    anchorAudioTime: null,
    generation,
  };
}
