import { AiOutlineSearch, AiOutlineStar } from 'react-icons/ai';
import { t } from '../../utils/base-utils';
import { BsArrowBarLeft } from 'react-icons/bs';

export const enum ModeTab {
  ALL = 'ALL',
  RECENT = 'RECENT',
  SHARED = 'SHARED',
  FAVORITES = 'FAVORITES',
  SEARCH = 'SEARCH'
}

export const nextTab = (currentTab: ModeTab): ModeTab => {
  if (currentTab === ModeTab.ALL) return ModeTab.RECENT;
  if (currentTab === ModeTab.RECENT) return ModeTab.FAVORITES;
  if (currentTab === ModeTab.FAVORITES) return ModeTab.SEARCH;
  return ModeTab.ALL;
};

export const previousTab = (currentTab: ModeTab): ModeTab => {
  if (currentTab === ModeTab.ALL) return ModeTab.SEARCH;
  if (currentTab === ModeTab.SEARCH) return ModeTab.FAVORITES;
  if (currentTab === ModeTab.FAVORITES) return ModeTab.RECENT;
  return ModeTab.ALL;
};

interface Props {
  modeTab: ModeTab;
  onChange: (modeTab: ModeTab) => void;
  onCollapse: () => void;
}

export default ({ modeTab, onChange, onCollapse }: Props) => {
  const tab = (mode: ModeTab, active: boolean) =>
    `sidebar-tab ${active ? 'sidebar-tab-active' : ''}`;

  return (
    <nav className="sidebar-tabs">
      <button className={tab(ModeTab.ALL, modeTab === ModeTab.ALL)} onClick={() => onChange(ModeTab.ALL)}>
        {t('APP_MAIN_TAB_ALL')}
      </button>
      <button className={tab(ModeTab.RECENT, modeTab === ModeTab.RECENT)} onClick={() => onChange(ModeTab.RECENT)}>
        {t('APP_MAIN_TAB_RECENT')}
      </button>
      <button
        className={`sidebar-tab sidebar-tab-icon ${modeTab === ModeTab.FAVORITES ? 'sidebar-tab-active' : ''}`}
        onClick={() => onChange(ModeTab.FAVORITES)}
      >
        <AiOutlineStar size={15} />
      </button>
      <button
        className={`sidebar-tab sidebar-tab-icon ${modeTab === ModeTab.SEARCH ? 'sidebar-tab-active' : ''}`}
        onClick={() => onChange(ModeTab.SEARCH)}
      >
        <AiOutlineSearch size={15} />
      </button>
      <button className="sidebar-tab sidebar-collapse" onClick={onCollapse}>
        <BsArrowBarLeft size={15} />
      </button>
    </nav>
  );
};
