import { useTranslation } from 'react-i18next';
import { setCueText } from '../../model/subtitles';
import type { ID } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { Section } from '../inspector/controls';

/** Text of the selected cue, editable from the inspector (typing merges into one undo step). */
export function CueTextField({ cueId, text, rtl }: { cueId: ID; text: string; rtl: boolean }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  return (
    <Section id="cueText" title={t('subtitles.cueText')}>
      <textarea
        dir={rtl ? 'rtl' : 'ltr'}
        data-testid="inspector-cue-text"
        rows={Math.max(2, text.split('\n').length)}
        className="w-full resize-y rounded bg-surface-0 px-1.5 py-1 text-sm leading-6"
        value={text}
        onChange={(e) => edit('ops.cueText', (p) => setCueText(p, cueId, e.target.value), { mergeKey: `${cueId}:text` })}
      />
    </Section>
  );
}
