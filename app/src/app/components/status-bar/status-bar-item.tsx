/**
 * Description: Individual status bar item. Renders text with optional tooltip,
 *   click handler, and hover action buttons shown as a popup above the item.
 * Inputs: text, tooltip, onClick callback, hoverActions array.
 * Outputs: Rendered span element.
 */

import { useRef, useState } from 'react';
import { Tooltip } from '../tooltip/tooltip';
import type { StatusBarHoverAction } from './status-bar-registry';

interface StatusBarItemProps {
  text: string;
  tooltip?: string;
  onClick?: () => void;
  hoverActions?: StatusBarHoverAction[];
}

export default function StatusBarItem({ text, tooltip, onClick, hoverActions }: StatusBarItemProps) {
  const hasActions = hoverActions && hoverActions.length > 0;
  const [actionsOpen, setActionsOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => setActionsOpen(false), 120);
  };
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const content = (
    <span
      className={`status-bar-item${onClick ? ' status-bar-item-clickable' : ''}${hasActions ? ' status-bar-item-has-actions' : ''}`}
      onClick={onClick}
      onMouseEnter={hasActions ? () => { cancelHide(); setActionsOpen(true); } : undefined}
      onMouseLeave={hasActions ? scheduleHide : undefined}
    >
      {text}
      {hasActions && actionsOpen && (
        <span
          className="status-bar-item-actions"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {hoverActions!.map((action) => (
            <button
              key={action.id}
              className="status-bar-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setActionsOpen(false);
                try { action.onClick(); } catch { /* plugin error isolation */ }
              }}
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );

  if (tooltip && !actionsOpen) {
    return <Tooltip content={tooltip}>{content}</Tooltip>;
  }
  return content;
}
