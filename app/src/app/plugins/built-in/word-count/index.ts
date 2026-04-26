/**
 * Description: Built-in plugin that replaces the previously baked-in word
 *   count in the status bar. Shows "N words" on the right side of the bar
 *   when a document is open; click toggles to "N characters". Subscribes
 *   to active document changes via the plugin context. Uses host i18n keys
 *   (STATUS_WORDS / STATUS_CHARACTERS), so no locales/ bundle is needed.
 * Inputs: active document content via ctx.editor.onDocumentChange.
 * Outputs: a single status bar item (right, high priority) managed by this plugin.
 */

import type { AppPlugin } from '../../plugin-types';

const ITEM_ID = 'count';

// priority kept below the built-in Ln/Col render in status-bar.tsx so
// this sits to the left of Ln/Col, matching the old layout.
const PRIORITY = 50;

function compute(content: string): { words: number; chars: number } {
  return {
    words: content.split(/\s+/).filter(Boolean).length,
    chars: content.length,
  };
}

export const wordCountPlugin: AppPlugin = {
  id: 'word-count',
  version: '1.0.0',
  name: 'Word Count',
  description: 'Shows word or character count for the active document. Click to toggle.',
  activate(ctx) {
    let showChars = false;
    let current = ctx.editor.getActiveDocument();

    const computeDisplay = () => {
      const { words, chars } = compute(current.content);
      const wordsStr = `${words.toLocaleString()} ${ctx.t('STATUS_WORDS') || 'words'}`;
      const charsStr = `${chars.toLocaleString()} ${ctx.t('STATUS_CHARACTERS') || 'characters'}`;
      return {
        text: showChars ? charsStr : wordsStr,
        tooltip: showChars ? wordsStr : charsStr,
      };
    };

    // Create the handle once. Hide when there is no active tab; show again
    // when one opens — no destroy/recreate dance.
    const item = ctx.statusBar.create({
      id: ITEM_ID,
      text: '',
      tooltip: '',
      align: 'right',
      priority: PRIORITY,
      onClick: () => {
        showChars = !showChars;
        render();
      },
    });

    const render = () => {
      if (!current.path) {
        item.hide();
        return;
      }
      item.set(computeDisplay());
      item.show();
    };

    render();

    const unsubDoc = ctx.editor.onDocumentChange((doc) => {
      current = doc;
      render();
    });

    // Word Count uses host keys (STATUS_WORDS / STATUS_CHARACTERS), so strings
    // update the moment the host locale changes — re-render to pick them up.
    const unsubLocale = ctx.onLocaleChange(() => render());

    return () => {
      unsubDoc();
      unsubLocale();
      item.dispose();
    };
  },
};
