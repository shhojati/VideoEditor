import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { SHAPE_KINDS } from '../../model/overlays';
import { addShape } from '../timeline/actions';
import { SHAPE_ICONS } from './shapesUi';

const MENU_HEIGHT = 140;

/** "+ Shape" button with a small grid of shapes; picking one adds it at the playhead. */
export function ShapeMenu() {
  const { t } = useTranslation();
  // In a portal at a fixed position (from the button): the toolbar scrolls horizontally on phones
  // and would clip it, and the timeline below would cover it.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) &&
      !menuRef.current?.contains(e.target as Node) &&
      setOpen(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        className="text-xs"
        aria-haspopup="menu"
        aria-expanded={!!open}
        title={t('shapes.addTitle')}
        data-testid="btn-add-shape"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // Opens upwards when there is no room below.
          const top =
            r.bottom + MENU_HEIGHT + 8 > window.innerHeight ? r.top - MENU_HEIGHT - 4 : r.bottom + 4;
          setOpen((o) => (o ? null : { left: Math.max(4, Math.min(r.left, window.innerWidth - 232)), top }));
        }}
      >
        ★+ {t('shapes.add')}
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={open}
            className="fixed z-50 grid w-56 grid-cols-2 gap-1 rounded border border-line bg-surface-2 p-1 shadow-xl"
          >
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                role="menuitem"
                data-testid={`add-shape-${kind}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-start text-xs hover:bg-surface-3"
                onClick={() => {
                  setOpen(null);
                  addShape(kind);
                }}
              >
                <span className="w-4 text-center text-base leading-none" aria-hidden>
                  {SHAPE_ICONS[kind]}
                </span>
                {t(`shapes.${kind}`)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
