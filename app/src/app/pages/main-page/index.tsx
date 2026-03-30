import { useState } from 'react';
import AppNav from '../../components/app-nav/app-nav';
import { PageProps } from '../../types';
// import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { MdEditor } from '../../components/editor/md-editor';
import { selectDir } from '../../utils/tauri-utils';

function MainPage({ onNav }: PageProps) {
  const [md, setMd] = useState('');

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    await invoke('greet', { name: 'John Do' }); // call 'greet' in main.rs
  }

  return (
    <div>
      <MdEditor onChange={(md: string) => setMd(md)} />

      {/* <AppNav onNav={onNav} />
      <br />
      <button onClick={() => greet()}>Greet</button> */}

      {/* <textarea value={md} className="text-black w-full" rows="10"></textarea> */}
    </div>
  );
}

export default MainPage;
