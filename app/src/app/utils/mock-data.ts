import { FileType } from '../types';
import { EXAMPLE_NOTE } from './constants';

const STORAGE_PREFIX = 'mock:';

// Default content for initial mock files
const defaults: Record<string, string> = {
  '/mock/Example Note.md': EXAMPLE_NOTE,
  '/mock/Todo.md': `# Todo List

## Today
- [x] Review pull requests
- [ ] Write documentation
- [ ] Fix login bug

## This Week
- [ ] Deploy v2.0
- [ ] Team sync meeting
- [ ] Update dependencies

> Stay focused and keep shipping!
`,
  '/mock/Ideas.md': `# Ideas

## Project Ideas
1. **CLI Dashboard** - A terminal-based dashboard for monitoring services
2. **Markdown Blog** - Static site generator from markdown files
3. **Note Sync** - Real-time note synchronization across devices

## Reading List
- *Clean Architecture* by Robert C. Martin
- *Designing Data-Intensive Applications* by Martin Kleppmann
`,
};

export const mockFiles: FileType[] = [
  {
    file_name: 'Example Note.md',
    file_path: '/mock/Example Note.md',
    file_text: '',
    is_file: true,
    is_dir: false,
  },
  {
    file_name: 'Todo.md',
    file_path: '/mock/Todo.md',
    file_text: '',
    is_file: true,
    is_dir: false,
  },
  {
    file_name: 'Ideas.md',
    file_path: '/mock/Ideas.md',
    file_text: '',
    is_file: true,
    is_dir: false,
  },
];

export const mockReadDirectory = () => {
  return { files: mockFiles };
};

export const mockReadFile = (filePath: string): string => {
  const stored = sessionStorage.getItem(STORAGE_PREFIX + filePath);
  if (stored !== null) return stored;
  return defaults[filePath] ?? '';
};

export const mockWriteFile = (filePath: string, text: string) => {
  sessionStorage.setItem(STORAGE_PREFIX + filePath, text);
};
