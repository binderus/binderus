/* Copyright 2021, Milkdown by Mirone. */
import { editorViewCtx, parserCtx } from '@milkdown/core';
import { Slice } from '@milkdown/prose/model';
import { Milkdown, useEditor } from '@milkdown/react';
import { forwardRef, useImperativeHandle } from 'react';

import { createEditor } from './createEditor';

type Props = {
  content: string;
  readOnly?: boolean;
  onChange?: (markdown: string) => void;
};

export type MilkdownRef = { update: (markdown: string) => void };

export const Editor = forwardRef<MilkdownRef, Props>(({ content, readOnly, onChange }, ref) => {
  const {
    loading: editorLoading,
    get: getEditor
  } = useEditor((root) => createEditor(root, content, readOnly, onChange), []);

  useImperativeHandle(ref, () => ({
    update: (markdown: string) => {
      if (editorLoading) return;
      const editor = getEditor();

      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const doc = parser(markdown);
        if (!doc) return;
        const state = view.state;
        view.dispatch(state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)));
      });
    }
  }));

  return <Milkdown />;
});
