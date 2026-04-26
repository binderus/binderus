/**
 * TabBar — VS Code-style horizontal tab strip for open editor files.
 * Supports drag-and-drop reorder via @hello-pangea/dnd, close, middle-click close,
 * right-click context menu, and dirty indicator. Persisted order via Zustand persist.
 */
import { useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { BsX } from 'react-icons/bs';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useAppStore } from '../../hooks/use-app-store';
import { t } from '../../utils/base-utils';

/** Only the fields TabBar renders — excludes content/scrollPos so those
 *  store updates don't trigger a re-render. */
interface TabView { file_path: string; file_name: string; isDirty: boolean }

/** Custom equality: only re-render when display-relevant fields change. */
const tabViewsEqual = (a: TabView[], b: TabView[]) =>
  a.length === b.length &&
  a.every((t, i) => t.file_path === b[i].file_path && t.file_name === b[i].file_name && t.isDirty === b[i].isDirty);

export default function TabBar() {
  const tabViews = useStoreWithEqualityFn(
    useAppStore,
    (s) => s.tabs.map(({ file_path, file_name, isDirty }) => ({ file_path, file_name, isDirty })),
    tabViewsEqual
  );
  const activeTabPath = useAppStore((s) => s.activeTabPath);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const reorderTab = useAppStore((s) => s.reorderTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeAllTabs = useAppStore((s) => s.closeAllTabs);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filePath: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  if (tabViews.length === 0) return null;

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    reorderTab(result.source.index, result.destination.index);
  };

  const handleContextMenu = (e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, filePath });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  const tabLabel = (tab: TabView) => {
    const name = tab.file_name;
    const lc = name.toLowerCase();
    if (lc.endsWith('.md') || lc.endsWith('.txt')) {
      return name.replace(/\.(md|txt)$/i, '');
    }
    return name;
  };

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="tab-bar" direction="horizontal">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="tab-bar">
              {tabViews.map((tab, index) => {
                const isActive = tab.file_path === activeTabPath;
                return (
                  <Draggable key={tab.file_path} draggableId={tab.file_path} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`tab-item ${isActive ? 'tab-item-active' : ''} ${snapshot.isDragging ? 'tab-item-dragging' : ''}`}
                        onClick={() => setActiveTab(tab.file_path)}
                        onAuxClick={(e) => {
                          if (e.button === 1) closeTab(tab.file_path);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, tab.file_path)}
                      >
                        {tab.isDirty && <span className="tab-item-dirty" />}
                        <span className="tab-item-label">{tabLabel(tab)}</span>
                        <button
                          className="tab-item-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.file_path);
                          }}
                        >
                          <BsX size={14} />
                        </button>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeCtxMenu} />
          <div
            ref={ctxRef}
            className="popover-panel py-1 fixed z-50"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="menu-item"
              onClick={() => {
                closeTab(ctxMenu.filePath);
                closeCtxMenu();
              }}
            >
              {t('TAB_CLOSE') || 'Close'}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                closeOtherTabs(ctxMenu.filePath);
                closeCtxMenu();
              }}
            >
              {t('TAB_CLOSE_OTHERS') || 'Close Others'}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                closeAllTabs();
                closeCtxMenu();
              }}
            >
              {t('TAB_CLOSE_ALL') || 'Close All'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
