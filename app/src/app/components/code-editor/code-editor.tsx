import React, { Component, useEffect, useState } from 'react';

// You can choose to use the component or the hook
import { ReactCodeJar } from 'react-codejar';
import Prismjs from 'prismjs';
import { FileType } from '../../types';
import { getCodeLang } from '../../utils/base-utils';

interface Props {
  file: FileType;
  value: string;
  onChange: (str: string) => void;
}

const CodeEditor = ({ file, value, onChange }: Props) => {
  const [key, setKey] = useState('key-' + Math.random());
  const [code, setCode] = useState(value);

  useEffect(() => {
    setKey('key-' + Math.random());
  }, [file]);

  useEffect(() => {
    onChange(code);
  }, [code]);

  const highlight = (editor: any) => {
    const lang = getCodeLang(file?.file_name);

    let code = editor.textContent;
    // code = code.replace(/\((\w+?)(\b)/g, '(<font color="#8a2be2">$1</font>$2');
    code = Prismjs.highlight(code, Prismjs.languages.javascript, lang);
    editor.innerHTML = code;
  };

  return (
    <div key={key} className="mt-4">
      <ReactCodeJar
        code={code} // Initial code value
        onUpdate={setCode} // Update the text
        highlight={highlight} // Highlight function, receive the editor
        lineNumbers={true} // Show line numbers
        style={{}}
      />
    </div>
  );
};

export default CodeEditor;
