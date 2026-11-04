#!/usr/bin/env node
// Stand-in for `claude -p --output-format json` playing a koala. Behaviour chosen by
// env FAKE_MODE: ok | text | garbage | error | budget | hang. FAKE_DECISION (JSON)
// fixes the decision; otherwise a plausible one is picked at random from the prompt.
// FAKE_DELAY_MS waits before answering, so demos feel like a real model call.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_FILE) fs.appendFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(args) + '\n');

const mode = process.env.FAKE_MODE || 'ok';
const delay = Number(process.env.FAKE_DELAY_MS) || 0;
if (delay) await new Promise((r) => setTimeout(r, delay * (0.6 + Math.random() * 0.8)));

const system = args[args.indexOf('--system-prompt') + 1] || '';
const prompt = args[args.indexOf('-p') + 1] || '';
const me = /You are (\w+)/.exec(system)?.[1] || 'Koala';
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

function invent() {
  const holds = /You hold: (.*)\./.exec(prompt)?.[1] || 'nothing';
  const heard = /said: "([^"]+)"\s*$/m.test(prompt);
  const hungry = /Hunger: (hungry|starving)/.test(prompt);
  const tired = /Energy: (exhausted|tired)/.test(prompt);
  const options = [
    { action: 'move', target: pick(['pond', 'lookout', 'flowers', 'clearing', 'swing']), say: pick(['', 'Ooh, what is over there?', 'Race you!']), mood: 'curious' },
    { action: 'play', target: pick(['ball', 'swing', 'pond']), say: pick(['Wheee!', '', 'Catch!']), mood: 'playful' },
    { action: 'approach', target: '', say: pick(['Hello, friend.', 'Can I sit with you?', '']), mood: 'happy' },
    { action: 'climb', target: pick(['big_gum', 'blue_gum', 'river_gum']), say: '', mood: 'content' },
    { action: 'sit', target: '', say: pick(['The wind smells like rain.', '', 'Hmm.']), mood: 'cozy' },
  ];
  if (/You can build/.test(prompt)) {
    const underway = /Being built: (?!nothing)/.test(prompt);
    const names = ['Sky Nest', 'Cozy Corner', 'Moon Perch', 'Gumnut Lodge', 'Pebble Path', 'Snack Shack', 'Glow Post'];
    const build = () => ({ action: 'build', target: pick(['bench', 'lantern', 'flowerbed', 'birdhouse', 'stones', 'hut', 'treehouse', 'tower']), build_name: pick(names), say: pick(['Let us build something!', 'I have an idea!', '']), mood: 'curious' });
    const keepGoing = () => ({ action: 'build', target: '', build_name: '', say: pick(['Tap tap tap!', 'Almost there!', '']), mood: 'happy' });
    options.push(build(), underway ? keepGoing() : build(), underway ? keepGoing() : build());
  }
  if (hungry) options.push({ action: 'eat', target: pick(['big_gum', 'river_gum', 'blue_gum']), say: 'Munch munch.', mood: 'hungry' });
  if (tired) options.push({ action: 'nap', target: '', say: 'Just a little nap...', mood: 'sleepy' });
  if (heard) options.push({ action: 'sit', target: '', say: pick(['I heard you!', 'Yes, I think so too.', 'Really? Tell me more.']), mood: 'happy' });
  if (holds !== 'nothing') options.push({ action: 'give', target: holds.split(', ')[0], say: 'This is for you.', mood: 'happy' });
  const d = pick(options);
  return {
    thought: `${me} wonders what happens next.`,
    remember: Math.random() < 0.2 ? `A ${pick(['quiet', 'sunny', 'funny'])} moment at the grove.` : '',
    bond: pick([0, 0, 1, 1, 2, -1]),
    opinion: Math.random() < 0.3 ? pick(['A good friend.', 'A bit noisy, but kind.', 'I like having them around.']) : '',
    ...d,
  };
}

const decision = process.env.FAKE_DECISION ? JSON.parse(process.env.FAKE_DECISION) : invent();
const usage = { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 600, output_tokens: 80 };
const base = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0021, duration_ms: 1500, usage };

if (mode === 'ok') {
  process.stdout.write(JSON.stringify({ ...base, result: '', structured_output: decision }) + '\n');
} else if (mode === 'text') {
  process.stdout.write(JSON.stringify({ ...base, result: `Here is my move: ${JSON.stringify(decision)}` }) + '\n');
} else if (mode === 'garbage') {
  process.stdout.write(JSON.stringify({ ...base, result: 'I am a koala and I refuse JSON.' }) + '\n');
} else if (mode === 'error') {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }) + '\n');
  process.stderr.write('not logged in\n');
  process.exitCode = 1;
} else if (mode === 'budget') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.05)'], total_cost_usd: 0.06, usage }) + '\n');
  process.exitCode = 1;
} else if (mode === 'hang') {
  setInterval(() => {}, 1000);
}
