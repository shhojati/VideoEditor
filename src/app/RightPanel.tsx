// Desktop right column: the Inspector, or the AI chat in its place.
import { useTranslation } from 'react-i18next';
import { ChatPanel } from '../features/chat/ChatPanel';
import { Inspector } from '../features/inspector/Inspector';
import type { Project } from '../model/types';
import { setRightView, useRightView, type RightView } from './layout';

const VIEWS: { id: RightView; label: string }[] = [
  { id: 'inspector', label: 'panels.inspector' },
  { id: 'ai', label: 'chat.tab' },
];

function ViewToggle() {
  const { t } = useTranslation();
  const view = useRightView((s) => s.view);
  return (
    <div role="tablist" className="-my-1 ms-2 flex shrink-0 rounded-md bg-surface-2 p-0.5 text-xs whitespace-nowrap">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={view === v.id}
          data-testid={`right-${v.id}`}
          className={`rounded px-2 py-0.5 ${view === v.id ? 'bg-surface-4 text-white' : 'text-muted hover:text-white'}`}
          onClick={() => setRightView(v.id)}
        >
          {t(v.label)}
        </button>
      ))}
    </div>
  );
}

export function RightPanel({ project }: { project: Project }) {
  const view = useRightView((s) => s.view);
  return view === 'ai' ? <ChatPanel actions={<ViewToggle />} /> : <Inspector project={project} actions={<ViewToggle />} />;
}
