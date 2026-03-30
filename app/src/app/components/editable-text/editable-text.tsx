import { useEffect, useRef, useState } from 'react';
import { AiOutlineEdit } from 'react-icons/ai';
import { Tooltip } from '../tooltip/tooltip';
import { t } from '../../utils/base-utils';

// Tests:
// - click to edit, press Enter to commit.
// - click to edit again, press Esc to cancel new changes.
// - click to edit again, click outside to commit.
// - click Edit icon to focus and edit.

interface Props {
  text: string;
  onChange?: (updatedText: string) => void;
}

export default ({ text, onChange }: Props) => {
  const [prevText, setPrevText] = useState(text);
  const [isEditing, setIsEditing] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    if (text) {
      setPrevText(text);
    }
  }, [text]);

  const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    setIsEditing(true);
    const el = e.target as HTMLSpanElement;
    setTimeout(() => {
      if (textRef?.current) {
        (textRef?.current as HTMLSpanElement).focus();
      }
    }, 50);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      // don't allow Pasting (it may include formatted text => cause issues)
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target as HTMLSpanElement;
      setPrevText(el.innerText);
      el.blur();
      onChange ? onChange(el.innerText) : '';
      setIsEditing(false);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target as HTMLSpanElement;
      el.blur();
      el.innerText = text;
      setIsEditing(false);
    }
  };

  const onBlur = () => {
    // use setTimeout to wait for other .blur() (like Enter, Escape) completed first
    setTimeout(() => {
      if (textRef?.current) {
        const innerText = (textRef?.current as HTMLSpanElement).innerText;
        setPrevText(innerText);
        onChange ? onChange(innerText) : '';
      }
    }, 50);
  };

  return (
    <span className="flex items-center">
      <span ref={textRef} contentEditable={isEditing} onClick={onClick} onKeyDown={onKeyDown} onBlur={onBlur}>
        {text}
      </span>

      <Tooltip content={t('TEXT_RENAME_FILE')}>
        {text && (
          <button className="ml-2 text-gray-600 hover:text-blue-500" onClick={onClick}>
            <AiOutlineEdit />
          </button>
        )}
      </Tooltip>
    </span>
  );
};
