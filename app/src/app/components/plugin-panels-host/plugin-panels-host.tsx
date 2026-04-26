/**
 * Description: Host component that renders every plugin-registered slide-out
 *   panel. Panels animate in from their configured side using the same CSS
 *   transform pattern as RawMdPanel. Multiple panels may exist; each maintains
 *   its own visible state. Later-registered panels win the z-stack. Each
 *   panel is drag-resizable along its inner edge and remembers its width.
 * Inputs: usePanelRegistry state.
 * Outputs: a stack of fixed-position <div>s, one per registered panel.
 */

import { useCallback } from 'react';
import { usePanelRegistry, type PanelEntry } from '../../plugins/panel-registry';
import { useResizableWidth } from '../../hooks/use-resizable-width';
import { t } from '../../utils/base-utils';

export default function PluginPanelsHost() {
  const panels = usePanelRegistry((s) => s.panels);

  return (
    <>
      {panels.map((p, idx) => (
        <PluginPanelShell key={p.id} panel={p} idx={idx} />
      ))}
    </>
  );
}

interface ShellProps {
  panel: PanelEntry;
  idx: number;
}

function PluginPanelShell({ panel: p, idx }: ShellProps) {
  const setVisible = usePanelRegistry((s) => s.setVisible);
  const close = useCallback(() => setVisible(p.id, false), [p.id, setVisible]);

  const { widthVw, ResizeHandle } = useResizableWidth({
    storageKey: `bindeck.pluginPanel.${p.id}.widthVw`,
    side: p.side,
    initialVw: p.widthPct,
  });

  const style: React.CSSProperties = {
    width: `${widthVw}vw`,
    zIndex: 9900 + idx,
    backgroundColor: 'var(--bg-primary)',
    transform: p.visible
      ? 'translateX(0)'
      : p.side === 'right' ? 'translateX(100%)' : 'translateX(-100%)',
    transition: 'transform 0.3s ease',
    [p.side]: 0,
  } as React.CSSProperties;

  return (
    <div
      className={`fixed top-0 h-full flex flex-col shadow-2xl ${
        p.side === 'right'
          ? 'border-l border-gray-600'
          : 'border-r border-gray-600'
      }`}
      style={style}
    >
      <ResizeHandle />
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          {p.title}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setVisible(p.id, false); }}
          className="text-gray-400 hover:text-white text-lg leading-none px-2 cursor-pointer"
          title={t('RAW_MD_CLOSE_TITLE') || 'Close'}
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {p.render({ close })}
      </div>
    </div>
  );
}
