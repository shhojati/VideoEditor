import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Button } from '../../app/ui';
import { formatDuration } from '../../lib/time';
import { ASPECT_PRESETS, type AspectPreset } from '../../model/factories';
import { PLATFORM_MAX_DURATION, PLATFORMS } from '../../model/platforms';
import type { Platform } from '../../model/types';
import { newProject } from './session';

export const useNewProjectDialog = create<{ open: boolean }>()(() => ({ open: false }));

/** Portrait first, as the social platforms are. */
const SIZES: AspectPreset[] = ['9:16', '4:5', '1:1', '16:9', '5:4'];

const choice = (selected: boolean) =>
  `flex flex-col items-center gap-1.5 rounded border p-2 text-xs ${selected ? 'border-accent bg-accent/15 text-white' : 'border-line bg-surface-2 text-neutral-300 hover:bg-surface-3'}`;

/** The page shown for "New project": name, canvas size and target platform (its length limit). */
export function NewProjectDialog() {
  const open = useNewProjectDialog((s) => s.open);
  // Remount per opening so the form starts fresh.
  return open ? <Form /> : null;
}

function Form() {
  const { t } = useTranslation();
  const nameId = useId();
  const [name, setName] = useState(t('app.untitled'));
  const [aspect, setAspect] = useState<AspectPreset>('9:16');
  const [platform, setPlatform] = useState<Platform | undefined>('instagramReels');
  const [busy, setBusy] = useState(false);
  const close = () => useNewProjectDialog.setState({ open: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      await newProject(name.trim() || t('app.untitled'), aspect, platform);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
    >
      <form
        className="w-[min(560px,100%)] space-y-4 rounded-lg border border-line bg-surface-1 p-5 text-sm shadow-2xl"
        data-testid="new-project-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="new-project-title" className="text-base font-semibold text-white">
          {t('newProject.title')}
        </h2>

        <div className="space-y-1">
          <label htmlFor={nameId} className="text-xs text-neutral-400">
            {t('newProject.name')}
          </label>
          <input
            id={nameId}
            dir="auto"
            autoFocus
            className="w-full rounded border border-line bg-surface-2 px-2 py-1.5 focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-neutral-400">{t('newProject.size')}</legend>
          <div
            className="grid grid-cols-5 gap-2 max-sm:grid-cols-3"
            role="radiogroup"
            aria-label={t('newProject.size')}
          >
            {SIZES.map((k) => {
              const { width, height } = ASPECT_PRESETS[k];
              const scale = 36 / Math.max(width, height);
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={aspect === k}
                  className={choice(aspect === k)}
                  onClick={() => setAspect(k)}
                  data-aspect={k}
                >
                  <span className="flex h-10 items-center">
                    <span
                      className="block rounded-sm border-2 border-current"
                      style={{ width: width * scale, height: height * scale }}
                      aria-hidden
                    />
                  </span>
                  <span dir="ltr">
                    {width}×{height}
                  </span>
                  <span className="text-neutral-400" dir="ltr">
                    {k}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-neutral-400">{t('newProject.platform')}</legend>
          <div
            className="grid grid-cols-5 gap-2 max-sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('newProject.platform')}
          >
            {[...PLATFORMS, undefined].map((p) => (
              <button
                key={p ?? 'none'}
                type="button"
                role="radio"
                aria-checked={platform === p}
                className={choice(platform === p)}
                onClick={() => setPlatform(p)}
                data-platform={p ?? 'none'}
              >
                <span className="text-center font-medium">
                  {p ? t(`platforms.${p}`) : t('newProject.none')}
                </span>
                <span className="text-neutral-400">
                  {p
                    ? t('newProject.upTo', { time: formatDuration(PLATFORM_MAX_DURATION[p]) })
                    : t('newProject.noLimit')}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={close}>{t('newProject.cancel')}</Button>
          <Button
            type="submit"
            className="bg-accent! text-white"
            disabled={busy}
            data-testid="create-project"
          >
            {t('newProject.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
