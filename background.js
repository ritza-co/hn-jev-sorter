const API = 'https://api.typesafe.ai/v1/systemone';

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !/^https:\/\/news\.ycombinator\.com\//.test(tab.url || '')) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

async function ask(key, body) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', ...body })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new Error('That API key was rejected. Check it in the TypeSafe console.');
  if (!response.ok) throw new Error(data.detail?.message || data.message || `TypeSafe returned HTTP ${response.status}`);
  return data;
}

async function classify({ state, comment, parent, categories }) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) throw new Error('Add your Jev API key to start.');
  const criteria = {};
  for (const c of categories) criteria[c.id] = c.description || c.name;
  const instructions = { question: 'Which category best describes what this Hacker News comment is doing?' };
  if (parent) instructions.replying_to = parent;
  instructions.comment = comment;
  const data = await ask(apiKey, { state, questions: { bucket: { type: 'choice', instructions, criteria } } });
  return { answer: data.answers.bucket, usage: data.usage };
}

async function testKey({ key }) {
  await ask(key, { state: 'Key check', questions: { ok: { type: 'noul', instructions: 'Is this a key check?' } } });
  return {};
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const handler = { HNS_CLASSIFY: classify, HNS_TEST_KEY: testKey }[message.type];
  if (!handler) return;
  handler(message).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
