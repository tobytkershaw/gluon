import { useEffect, useRef } from 'react';
import type { Session, SynthParamValues } from '../engine/types';
import type { AudioEngine } from '../audio/audio-engine';
import { TransportController } from '../engine/transport-controller';

interface UseTransportControllerOptions {
  audioStarted: boolean;
  audio: AudioEngine;
  session: Session;
  getSession: () => Session;
  onPositionChange: (step: number) => void;
  getHeldParams: (trackId: string) => Partial<SynthParamValues>;
  onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void;
}

export function useTransportController({
  audioStarted,
  audio,
  session,
  getSession,
  onPositionChange,
  getHeldParams,
  onParameterEvent,
}: UseTransportControllerOptions) {
  const controllerRef = useRef<TransportController | null>(null);

  useEffect(() => {
    if (!audioStarted) return;
    controllerRef.current = new TransportController({
      audio,
      getSession,
      onPositionChange,
      getHeldParams,
      onParameterEvent,
    });
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [audioStarted, audio, getSession, onPositionChange, getHeldParams, onParameterEvent]);

  useEffect(() => {
    controllerRef.current?.sync();
  }, [session.transport]);

  useEffect(() => {
    controllerRef.current?.syncArrangement();
  }, [session.tracks]);

  return controllerRef;
}
