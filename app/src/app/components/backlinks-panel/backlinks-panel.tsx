/**
 * Description: Collapsible panel that displays backlinks (notes referencing the current note).
 *   Shows below the editor content with a toggle to expand/collapse.
 * Requirements: useBacklinks hook, Tauri backend
 * Inputs: filePath - current note path, onFileSelect - callback when a backlink is clicked
 * Outputs: Rendered panel UI
 */
import { useState } from 'react';
import { BsChevronDown, BsChevronRight, BsLink45Deg } from 'react-icons/bs';
import { FileType } from '../../types';
import { useBacklinks } from '../../hooks/use-backlinks';
import { t } from '../../utils/base-utils';

interface Props {
  filePath: string | null;
  onFileSelect: (file: FileType) => void;
}

export default ({ filePath, onFileSelect }: Props) => {
  const { backlinks, isLoading } = useBacklinks(filePath);
  const [expanded, setExpanded] = useState(true);

  if (!filePath || (backlinks.length === 0 && !isLoading)) return null;

  return (
    <div className="backlinks-panel border-t border-gray-700 mx-4 mt-4 pt-3 pb-4">
      <button
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <BsChevronDown size={10} /> : <BsChevronRight size={10} />}
        <BsLink45Deg size={14} />
        <span>{backlinks.length} {t('TEXT_BACKLINKS') || 'Backlinks'}</span>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1">
          {isLoading && <li className="text-xs text-gray-500">{t('TEXT_LOADING') || 'Loading...'}</li>}
          {backlinks.map((item) => (
            <li
              key={item.file_path}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer truncate pl-5"
              onClick={() => onFileSelect(item)}
            >
              {item.file_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
