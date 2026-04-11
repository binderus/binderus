import { v4 as uuidV4 } from 'uuid';
import { Theme } from '../types';
import packageJson from '../../../package.json';
import exampleNoteContent from './example-note.md?raw';

export const VERSION = packageJson.version;

export const VAULT_META_DIR = '.binderus';
export const VAULT_SETTINGS_FILE = 'settings.json';

export const RECENT_LIST_MAX = 10;
export const FAVORITE_LIST_MAX = 10;

export const DEFAULT_THEME = Theme.DarkNord;
export const DEFAULT_LANG = 'en-US';

export const DEFAULT_SETTING = { ver: VERSION, clientUuid: `${uuidV4()}`, theme: DEFAULT_THEME, lang: '', storageBackend: 'filesystem', encryptionEnabled: false, autoLockTimeout: 15, autoLockOnMinimize: false, enterMode: 'paragraph' };

export const BINDERUS_WEB_URL = `https://binderus.com`;
export const BINDERUS_WEB_NAME = `Binderus.com`;
export const USER_GUIDE_BASE_URL = `https://www.binderus.com/how-to`;

export const EXAMPLE_NOTE = exampleNoteContent;
