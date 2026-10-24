import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { friendlyError, showToast } from '../../app/toasts';
import { fontChoices } from '../../lib/fonts';
import { LIBRARY_EXTENSIONS } from '../../lib/library';
import { useRootProject } from '../../store/projectStore';
import { loadLibrary, useLibrary } from '../library/libraryService';
import { addLibraryFont, FontFileError, uploadFont } from './fontService';

const UPLOAD = '__upload__';
const SERVER = '__server__:';

/**
 * The font picker of text clips and subtitle styles: the built-in fonts, the project's own, the
 * server's library/fonts not used yet, and "Upload a font…".
 */
export function FontField({ label, value, onChange }: { label: string; value: string; onChange: (family: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const fonts = useRootProject()?.fonts;
  const server = useLibrary((s) => s.lists.fonts);
  useEffect(() => void loadLibrary('fonts'), []);
  const used = new Set(fonts?.map((f) => f.library).filter(Boolean));
  const extra = (server?.status === 'ready' ? server.items : []).filter((i) => !used.has(i.path));

  return (
    <div className="flex flex-col gap-1 text-xs">
      <label htmlFor={id} className="text-neutral-400">
        {label}
      </label>
      <select
        id={id}
        data-testid="font-picker"
        className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === UPLOAD) return fileRef.current?.click();
          if (v.startsWith(SERVER)) {
            const item = extra.find((i) => i.path === v.slice(SERVER.length));
            if (item) onChange(addLibraryFont(item));
            return;
          }
          onChange(v);
        }}
      >
        {fontChoices(fonts).map((f) => (
          <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>
            {f.label}
          </option>
        ))}
        {extra.length > 0 && (
          <optgroup label={t('fonts.server')}>
            {extra.map((i) => (
              <option key={i.path} value={`${SERVER}${i.path}`}>
                {i.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={UPLOAD}>{t('fonts.upload')}</option>
      </select>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={LIBRARY_EXTENSIONS.fonts.map((e) => `.${e}`).join(',')}
        data-testid="font-upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          uploadFont(file).then(onChange, (err) =>
            showToast(err instanceof FontFileError ? t(`fonts.errors.${err.message}`) : friendlyError(err, t)),
          );
        }}
      />
    </div>
  );
}
