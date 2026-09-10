import React from 'react';
import type { ScriptStage } from '../types';

type StageCanvasProps = {
  children: React.ReactNode;
};

function StageCanvas({ stage, children }: StageCanvasProps & { stage: ScriptStage }) {
  return <section data-script-stage={stage} className="min-w-0">{children}</section>;
}

export function BriefStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="brief">{children}</StageCanvas>;
}

export function IntentStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="intent">{children}</StageCanvas>;
}

export function TopicStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="topic">{children}</StageCanvas>;
}

export function ResearchStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="research">{children}</StageCanvas>;
}

export function DurationStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="duration">{children}</StageCanvas>;
}

export function BeatsStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="beats">{children}</StageCanvas>;
}

export function CopyStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="copy">{children}</StageCanvas>;
}

export function RhythmStageCanvas({ children }: StageCanvasProps) {
  return <StageCanvas stage="rhythm">{children}</StageCanvas>;
}

export function ScriptStageViewport({
  stage,
  canvases,
  afterCanvas
}: {
  stage: ScriptStage;
  canvases: Partial<Record<ScriptStage, React.ReactNode>>;
  afterCanvas?: React.ReactNode;
}) {
  return <>
    {canvases[stage] || null}
    {afterCanvas || null}
  </>;
}
