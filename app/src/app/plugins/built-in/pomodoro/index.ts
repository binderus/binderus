/**
 * Description: Built-in Pomodoro timer plugin. Registers a left-aligned
 *   status bar item that cycles: idle -> focus (25 min) -> break (5 min).
 *   Click to start/pause/resume; when a session ends the item shows
 *   "Done" until the user clicks to reset. Plain text only — no emoji —
 *   per Binderus minimal design. Ships its own locale bundles (en-US,
 *   ja, es-ES, zh-CN) resolved via ctx.t().
 * Inputs: user clicks on the status bar item.
 * Outputs: a single status bar item (left, priority 50) that ticks once per second while running.
 */

import type { AppPlugin, PluginContext } from '../../plugin-types';
import arSA from './locales/ar-SA.json';
import deDE from './locales/de-DE.json';
import enUS from './locales/en-US.json';
import esES from './locales/es-ES.json';
import frFR from './locales/fr-FR.json';
import hiIN from './locales/hi-IN.json';
import itIT from './locales/it-IT.json';
import ja from './locales/ja.json';
import ruRU from './locales/ru-RU.json';
import zhCN from './locales/zh-CN.json';

const ITEM_ID = 'timer';
const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

type Mode = 'idle' | 'focus' | 'break' | 'done';

function format(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  const s = Math.max(0, sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const pomodoroPlugin: AppPlugin = {
  id: 'pomodoro',
  version: '1.0.0',
  name: 'Pomodoro Timer',
  description: '25-minute focus sessions with a 5-minute break. Click the status bar item to start, pause, or resume.',
  locales: {
    'ar-SA': arSA,
    'de-DE': deDE,
    'en-US': enUS,
    'es-ES': esES,
    'fr-FR': frFR,
    'hi-IN': hiIN,
    'it-IT': itIT,
    ja,
    'ru-RU': ruRU,
    'zh-CN': zhCN,
  },
  activate(ctx: PluginContext) {
    let mode: Mode = 'idle';
    let remaining = WORK_SECONDS;
    let running = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const clearTick = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const computeDisplay = (): { text: string; tooltip: string } => {
      if (mode === 'idle') {
        return { text: ctx.t('IDLE'), tooltip: ctx.t('TOOLTIP_IDLE') };
      }
      if (mode === 'done') {
        return { text: ctx.t('DONE'), tooltip: ctx.t('TOOLTIP_DONE') };
      }
      const label = mode === 'focus' ? ctx.t('FOCUS') : ctx.t('BREAK');
      const timeStr = format(remaining);
      return {
        text: running ? `${label} ${timeStr}` : `${label} ${timeStr} ${ctx.t('PAUSED_SUFFIX')}`,
        tooltip: running ? ctx.t('TOOLTIP_RUNNING') : ctx.t('TOOLTIP_PAUSED'),
      };
    };

    const computeHoverActions = () => {
      if (mode === 'idle' || mode === 'done') return [];
      if (running) {
        return [
          { id: 'pause', label: ctx.t('ACTION_PAUSE'), onClick: () => toggle() },
          { id: 'stop',  label: ctx.t('ACTION_STOP'),  onClick: () => stop() },
        ];
      }
      return [
        { id: 'play', label: ctx.t('ACTION_PLAY'), onClick: () => toggle() },
        { id: 'stop', label: ctx.t('ACTION_STOP'), onClick: () => stop() },
      ];
    };

    // Create once; subsequent updates go through the handle.
    const initial = computeDisplay();
    const item = ctx.statusBar.create({
      id: ITEM_ID,
      text: initial.text,
      tooltip: initial.tooltip,
      align: 'left',
      priority: 50,
      onClick: () => toggle(),
      hoverActions: [],
    });

    const render = () => item.set({ ...computeDisplay(), hoverActions: computeHoverActions() });

    const startTick = () => {
      clearTick();
      running = true;
      intervalId = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (mode === 'focus') {
            mode = 'break';
            remaining = BREAK_SECONDS;
            render();
            return;
          }
          clearTick();
          running = false;
          mode = 'done';
          render();
          return;
        }
        render();
      }, 1000);
      render();
    };

    const stop = () => {
      clearTick();
      mode = 'idle';
      remaining = WORK_SECONDS;
      running = false;
      render();
    };

    const toggle = () => {
      if (mode === 'idle') {
        mode = 'focus';
        remaining = WORK_SECONDS;
        startTick();
        return;
      }
      if (mode === 'done') {
        mode = 'idle';
        remaining = WORK_SECONDS;
        running = false;
        clearTick();
        render();
        return;
      }
      if (running) {
        clearTick();
        running = false;
        render();
      } else {
        startTick();
      }
    };

    // Re-render on locale change so strings update without waiting for a tick
    const unsubLocale = ctx.onLocaleChange(() => render());

    return () => {
      clearTick();
      unsubLocale();
      item.dispose();
    };
  },
};
