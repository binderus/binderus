import React from 'react';

export interface PageProps {
  onNav?: (path: string) => void;
  children?: React.ReactNode;
  /** Incremented on locale change to force re-render through React Compiler memoization. */
  i18nVersion?: number;
}

export type FileType = {
  file_name: string;
  file_path: string;
  file_text: string;
  is_file: boolean;
  is_dir: boolean;
};

export enum Theme {
  DarkNord = 'dark-nord',
  LightWhite = 'light-white',
  DarkDracula = 'dark-dracula',
  DarkOneDark = 'dark-one-dark',
  DarkCatppuccin = 'dark-catppuccin',
  LightCatppuccin = 'light-catppuccin',
  DarkGithub = 'dark-github',
  DarkSolarized = 'dark-solarized',
  DarkGruvbox = 'dark-gruvbox',
  DarkTokyoNight = 'dark-tokyo-night'
}
export const themeValues = Object.values(Theme).filter((value) => typeof value === 'string');

export { isDarkTheme } from '../utils/theme-registry';

export interface EditorTab {
  file_path: string;
  file_name: string;
  content: string | null;
  isDirty: boolean;
  scrollPos?: number;
}
