import { BsFolderFill } from 'react-icons/bs';
import { FileType } from '../../types';
import { BsArrowLeft } from 'react-icons/bs';
import { useAppContext } from '../../hooks/use-app-context';
import { useAppStore } from '../../hooks/use-app-store';
import { t } from '../../utils/base-utils';
import { Popover } from '@headlessui/react';
import { useState } from 'react';
import { FiDatabase, FiPlus } from 'react-icons/fi';

interface Props {
  folder: FileType | null;
  onClickBack: () => void;
  onClickRoot: () => void;
  onNewFolder: (name: string) => void;
  onNewFile: (name: string) => void;
}

export default ({ folder, onClickBack, onClickRoot, onNewFolder, onNewFile }: Props) => {
  const { dataDir } = useAppContext();
  const storageBackend = useAppStore((s) => s.storageBackend);
  const isDbMode = storageBackend === 'libsql';
  const [addMode, setAddMode] = useState<'file' | 'folder' | null>(null);
  const [name, setName] = useState('');

  const handleConfirm = (close: () => void) => {
    if (!name.trim()) return;
    if (addMode === 'file') onNewFile(name.trim());
    else if (addMode === 'folder') onNewFolder(name.trim());
    setName('');
    setAddMode(null);
    close();
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>, close: () => void) => {
    if (e.key === 'Enter') handleConfirm(close);
    if (e.key === 'Escape') { setAddMode(null); setName(''); close(); }
  };

  return (
    <div className="sidebar-header">
      <div className="flex items-center">
        <span className="sidebar-header-icon" onClick={onClickRoot}>
          {isDbMode ? <FiDatabase size={15} /> : <BsFolderFill size={16} />}
        </span>
        {folder && (
          <span className="sidebar-header-icon ml-1" onClick={onClickBack}>
            <BsArrowLeft size={16} />
          </span>
        )}
        <span className="sidebar-dir-name">{folder ? `../${folder.file_name}` : (dataDir.split('/').pop() || dataDir)}</span>
      </div>

      <Popover className="relative">
        {({ open, close }) => (
          <>
            <Popover.Button
              as="span"
              className="sidebar-header-icon"
              onClick={() => { setAddMode(null); setName(''); }}
            >
              <FiPlus size={16} />
            </Popover.Button>

            {open && (
              <Popover.Panel className="absolute right-0 z-10 w-44" static>
                <div className="popover-panel py-1">
                  {addMode === null ? (
                    <>
                      <button className="menu-item" onClick={() => { setAddMode('file'); setName(''); }}>
                        {t('APP_MAIN_NEW_FILE')}
                      </button>
                      <button className="menu-item" onClick={() => { setAddMode('folder'); setName(''); }}>
                        {t('APP_MAIN_NEW_FOLDER')}
                      </button>
                    </>
                  ) : (
                    <div className="px-3 py-2">
                      <input
                        autoFocus
                        className="input-dark w-full"
                        placeholder={addMode === 'file' ? t('APP_MAIN_NEW_FILE_PLACEHOLDER') : t('APP_MAIN_NEW_FOLDER_PLACEHOLDER')}
                        value={name}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        onChange={(e) => setName(e.target.value)}
                        onKeyUp={(e) => handleKeyUp(e, close)}
                      />
                      <button className="btn btn-primary mt-2 w-full" onClick={() => handleConfirm(close)}>
                        {addMode === 'file' ? t('APP_MAIN_NEW_FILE') : t('APP_MAIN_NEW_FOLDER')}
                      </button>
                    </div>
                  )}
                </div>
              </Popover.Panel>
            )}
          </>
        )}
      </Popover>
    </div>
  );
};
