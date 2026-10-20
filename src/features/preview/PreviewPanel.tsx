import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import { playbackEngine } from '../../engine/playback/engine';
import type { Project } from '../../model/types';
import { TransportBar } from './TransportBar';

/**
 * Letterboxed preview. The canvas backing store matches its on-screen size (× devicePixelRatio,
 * capped at the project resolution), so preview cost scales with the panel, not the export size.
 */
export function PreviewPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { width, height } = project.settings;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = boxRef.current!;
    const ro = new ResizeObserver(() => {
      // clientWidth/Height include the padding; fit inside it.
      const cs = getComputedStyle(box);
      const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const s = Math.max(0, Math.min(w / width, h / height));
      setSize({ w: Math.floor(width * s), h: Math.floor(height * s) });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scale = Math.min(window.devicePixelRatio || 1, width / Math.max(1, size.w));
    canvas.width = Math.max(1, Math.round(size.w * scale));
    canvas.height = Math.max(1, Math.round(size.h * scale));
    playbackEngine.attach(canvas);
    return () => playbackEngine.attach(null);
  }, [size, width]);

  return (
    <Panel title={t('panels.preview')}>
      <div className="flex h-full flex-col bg-surface-0" dir="ltr">
        <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center p-3">
          <canvas
            ref={canvasRef}
            data-testid="preview-canvas"
            className="bg-black shadow-lg"
            style={{ width: size.w, height: size.h }}
          />
        </div>
        <TransportBar fps={project.settings.fps} />
      </div>
    </Panel>
  );
}
