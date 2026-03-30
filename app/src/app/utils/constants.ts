import { v4 as uuidV4 } from 'uuid';
import { Theme } from '../types';
import packageJson from '../../../package.json';

export const VERSION = packageJson.version;
export const BUILD_EXPIRED_DATE_STR = '2026-05-01' + 'T13:00:00'; // next month, +1 month, + 1 month

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

export const EXAMPLE_NOTE = `# Hi, welcome to Binderus! 

Binderus is a user-first, cross-platform knowledge management app.

Binderus is designed to be a tool with a focus on simplicity
yet powerful for every daily use like writing, research, studying, collaboration, task and project management, etc.&#x20;

Here are some highlights of Binderus:

*   Simplicity 💖

*   Lightweight and fast! ⚡

*   Advanced visual editor (WYSIWYG - What You See Is What You Get) 👁

*   Support plain text and [Markdown](https://github.github.com/gfm/) with internal / external hyperlinks 🔗

*   You own your data and they are always portable. No lock-in 📦

*   It’s like a "just right" mashup of Evernote, Notion, and WordPress minus the complexities ✨

*   Sync your notes to the cloud using Dropbox, OneDrive, Google Drive, etc. or Binderus Cloud ☁

Still have questions?

*   Join our [Discord](https://discord.gg/hqx7DSq8J6) channels

> Binderus has an advanced visual editor (WYSIWYG - What You See Is What You Get).

* Visual Editor
  * [x] 📝 **WYSIWYG Editor** - Write markdown in an elegant way. What is [Markdown](https://github.github.com/gfm/)?
  * [x] 🎮 **Customizable** - Support your awesome ideas by plugin
  * [x] 🦾 **Reliable** - Built on top of quality software components
  * [x] ⚡ **Slash & Tooltip** - Write fast for everyone, driven by plugin
  * [x] 🧮 **Math** - LaTeX math equations support, driven by plugin
  * [x] 📊 **Table** - Table support with fluent ui, driven by plugin
  * [x] 📰 **Diagram** - Diagram support with [mermaid](https://mermaid-js.github.io/mermaid/#/), driven by plugin
  * [x] 🍻 **Collaborate** - Shared editing support with [yjs](https://docs.yjs.dev/), driven by plugin
  * [x] 💾 **Clipboard** - Support copy and paste markdown, driven by plugin
  * [x] 👍 **Emoji** - Support emoji shortcut and picker, driven by plugin

***

You can add \`inline code\` and code block:

\`\`\`javascript
function main() {
  console.log("Hello Binderus!");
}
\`\`\`

> Tips: use \`Mod-Enter\` to exit blocks such as code block.

***

You can type \`||\` and a \`space\` to create a table:

| First Header   |    Second Header   |
| -------------- | :----------------: |
| Content Cell 1 |  Content Cell 1  |
| Content Cell 2 | **Content** Cell 2 |

***

Math is supported by [TeX expression](https://en.wikipedia.org/wiki/TeX).

Now we have some inline math: $E = mc^2$. You can click to edit it.

Math block is also supported.

$$
\begin{aligned}
T( (v\_1 + v\_2) \otimes w) &= T(v\_1 \otimes w) + T(v\_2 \otimes w) \\
T( v \otimes (w\_1 + w\_2)) &= T(v \otimes w\_1) + T(v \otimes w\_2) \\
T( (\alpha v) \otimes w ) &= T( \alpha ( v \otimes w) ) \\
T( v \otimes (\alpha w) ) &= T( \alpha ( v \otimes w) ) \\
\end{aligned}
$$

You can type \`$$\` and a \`space\` to create a math block.

***

Use [emoji cheat sheet](https://www.webfx.com/tools/emoji-cheat-sheet/) such as \`:+1:\` to add emoji[^1].

You may notice the emoji filter while inputting values, try to type \`:baby\` to see the list.

***

Diagrams is powered by [mermaid](https://mermaid-js.github.io/mermaid/#/).

You can type \` \`\`\`mermaid \` to add diagrams.

\`\`\`mermaid
graph TD;
    EditorState-->EditorView;
    EditorView-->DOMEvent;
    DOMEvent-->Transaction;
    Transaction-->EditorState;
\`\`\`

***

Have fun!

[^1]: We use [tweet emoji](https://twemoji.twitter.com) to make emojis viewable cross platforms.
`;
