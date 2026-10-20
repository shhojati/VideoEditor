import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';

interface Props {
  /** Shown in the message so the user knows which part failed. */
  area: string;
  children: ReactNode;
}

/**
 * Keeps one failing panel from taking down the whole editor. The project itself is safe: it is
 * autosaved independently of the UI.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = i18n.t.bind(i18n);
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 bg-surface-1 p-4 text-center text-sm" role="alert">
        <p className="text-red-300">{t('errors.panel', { area: this.props.area })}</p>
        <details className="max-w-full text-xs text-neutral-400">
          <summary className="cursor-pointer">{t('errors.details')}</summary>
          <pre className="mt-1 max-h-32 overflow-auto text-start whitespace-pre-wrap" dir="ltr">
            {error.message}
          </pre>
        </details>
        <div className="flex gap-2">
          <button className="rounded bg-surface-3 px-3 py-1" onClick={() => this.setState({ error: null })}>
            {t('errors.retry')}
          </button>
          <button className="rounded bg-surface-3 px-3 py-1" onClick={() => window.location.reload()}>
            {t('errors.reload')}
          </button>
        </div>
      </div>
    );
  }
}
