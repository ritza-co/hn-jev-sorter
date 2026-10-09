const $ = id => document.getElementById(id);

chrome.storage.local.get('apiKey').then(({ apiKey }) => {
  $('key').value = apiKey || '';
  if (apiKey) say('A key is saved.', 'ok');
});

function say(text, kind = '') { $('msg').textContent = text; $('msg').className = kind; }

$('show').onclick = () => {
  $('key').type = $('key').type === 'password' ? 'text' : 'password';
  $('show').textContent = $('key').type === 'password' ? 'Show' : 'Hide';
};

async function save() {
  const key = $('key').value.trim();
  if (!key) return say('Paste a key first.', 'err');
  say('Checking…');
  const res = await chrome.runtime.sendMessage({ type: 'HNS_TEST_KEY', key });
  if (!res.ok) return say(res.error, 'err');
  await chrome.storage.local.set({ apiKey: key });
  say('✓ Key works and is saved. Open a Hacker News thread and click the icon.', 'ok');
}

$('save').onclick = save;
$('key').onkeydown = e => { if (e.key === 'Enter') save(); };
