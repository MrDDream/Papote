// Same curated set as the Android app (EmojiPicker.kt), so both pickers feel alike.
import { h, clear } from './ui.js';

export const CATEGORIES = [
  { label: "Sourires", icon: "😀", emojis: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾".split(" ") },
  { label: "Gestes", icon: "👋", emojis: "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦵 🦶 👂 👃 🧠 👀 👁️ 👅 👄 💋 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 💁 🙇 🧑\u200d🍳 🧑\u200d🎨 🧑\u200d💻 🧑\u200d🚀 🦸 🧙 🧚 💃 🕺 👯 🧘 🛀 👫 👭 👬 💏 💑 👪".split(" ") },
  { label: "Cœurs", icon: "❤️", emojis: "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ❤️\u200d🔥 ❤️\u200d🩹 💌 💐 🌹 🥀 🌷 🌸 💮 🏵️ 🌻 🌼 ✨ 💫 ⭐ 🌟 🔥 💥 💯 💢 💦 💨 🕊️ 🫶 😻 💑 💏".split(" ") },
  { label: "Animaux", icon: "🐶", emojis: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🦓 🦒 🐘 🦛 🐪 🦘 🐕 🐈 🐇 🦔 🦥 🦦 🌵 🎄 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🍃 🍄 🌍 🌙 ☀️ ⛅ 🌧️ ⛈️ 🌈 ❄️ ☃️ 🌊".split(" ") },
  { label: "Miam", icon: "🍕", emojis: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🌶️ 🥔 🥐 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍯 🍿 🥤 🧋 ☕ 🍵 🍺 🍻 🥂 🍷 🍸 🍹 🧉".split(" ") },
  { label: "Fête", icon: "🎉", emojis: "🎉 🎊 🎈 🎁 🎀 🎂 🪅 🎆 🎇 🧨 🎃 🎄 🎅 🤶 🎓 🏆 🥇 🥈 🥉 🏅 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🛹 ⛸️ 🎿 🏊 🚴 🧗 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎨 🖍️ ✏️ 🎭 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 📸 🎥 📺 📚 📖".split(" ") },
  { label: "Voyage", icon: "✈️", emojis: "🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚲 🛴 🛵 🏍️ 🚂 🚆 🚇 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🗺️ 🧭 🏔️ ⛰️ 🏕️ 🏖️ 🏝️ 🏠 🏡 🏰 🗼 🗽 ⛺ 🎡 🎢 🎠 🌅 🌄 🌃 🌉 🎑 ⌚ 📱 💻 ⌨️ 🖨️ 💡 🔦 🕯️ 💸 💰 💳 🔑 🗝️ 🔨 🧸 🛏️ 🛋️ 🚿 🧼 🧺 🧻 🎒 👓 🕶️ 👕 👖 👗 👙 👠 👟 🧢 👑 💍 ☂️".split(" ") },
  { label: "Symboles", icon: "💬", emojis: "💬 💭 🗯️ 💤 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️ 💲 ♻️ ⚠️ 🚫 ⛔ 🔞 📵 🆗 🆒 🆕 🆙 🆓 🔝 🔜 ⏰ ⏳ 📅 📌 📍 📎 🔔 🔕 🎵 🎶 ➡️ ⬅️ ⬆️ ⬇️ 🔄 🔁 ▶️ ⏸️ ⏹️ ⏺️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 💠 🔷 🔶 🏳️\u200d🌈 🏴\u200d☠️ 🇫🇷 🇧🇪 🇨🇭 🇨🇦 🇪🇺".split(" ") },
];

export const QUICK_REACTIONS = ['😂', '😮', '😢', '🎉', '🔥', '👏'];

const KEY = 'papote.emojiRecents';

export function recents() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function remember(e) {
  try {
    localStorage.setItem(KEY, JSON.stringify([e, ...recents().filter((x) => x !== e)].slice(0, 32)));
  } catch {
    /* private mode: no recents */
  }
}

const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3|[\u{E0020}-\u{E007F}]|\s)+$/u;

/** 1 to 3 emoji and nothing else: shown big, without a bubble. */
export function isEmojiOnly(text) {
  const t = text.replace(/\s+/g, '');
  if (!t || !EMOJI_ONLY.test(t)) return false;
  const n = [...segmenter.segment(t)].length;
  return n >= 1 && n <= 3;
}

export function emojiPicker(onPick) {
  const tabs = h('div', { class: 'emoji-tabs', role: 'tablist', 'aria-label': 'Catégories d’emoji' });
  const grid = h('div', { class: 'emoji-grid', role: 'tabpanel' });
  const el = h('div', { class: 'emoji-picker' }, tabs, grid);
  let current = recents().length ? 0 : 1;

  function render() {
    const all = [{ label: 'Récents', icon: '🕘', emojis: recents() }, ...CATEGORIES];
    clear(
      tabs,
      all.map((c, i) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === current), 'aria-label': c.label, title: c.label, onclick: () => ((current = i), render()) }, c.icon),
      ),
    );
    const list = all[current].emojis;
    if (!list.length) clear(grid, h('div', { class: 'emoji-empty' }, 'Tes emoji récents apparaîtront ici.'));
    else
      clear(
        grid,
        list.map((e) =>
          h('button', { type: 'button', 'aria-label': e, onclick: () => (remember(e), onPick(e)) }, e),
        ),
      );
    grid.scrollTop = 0;
  }
  render();
  return el;
}
