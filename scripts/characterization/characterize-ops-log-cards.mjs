import { parseAgentLog } from '../../src/dashboard/ops-console/log-cards.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = `[slot:0 sid:700fced0] [replay] [1/5] go_to_url {'url': 'http://test.creditv5p2.tansun.com.cn/#/login'}
[slot:0 sid:700fced0] [replay] [1/5] OK → ok | locate=ok
[slot:0 sid:700fced0] Phase 1: 关闭「天元相关配置」欢迎弹窗（若有，点击确定）。预期结果：欢迎弹窗关闭或当前页面无该弹窗。 (max_steps=300)
[slot:0 sid:700fced0] [step 2] done=no stopped=no | goal=点击「确 定」按钮关闭「天元相关配置」欢迎弹窗，然后终检确认当前页面已无该弹窗。 | act={"click_element_by_index": {"index": 1}} | res=ok-clicked-1`;
const blocks = parseAgentLog(sample);
assert(blocks.some((b) => b.kind === 'phase' && b.phase === 1), 'phase 1 header');
assert(
  blocks.some((b) => b.kind === 'replay' && b.operation === 'go_to_url' && b.status === 'ok'),
  'replay go_to_url',
);
assert(
  blocks.some((b) => b.kind === 'step' && b.goal.includes('点击「确 定」')),
  'legacy step goal',
);
assert(!blocks.some((b) => b.kind === 'info'), 'old log has no [card] lines');

const longText = `甲`.repeat(201) + '\n第二行';
const cardLine = '[card] ' + JSON.stringify({
  kind: 'kb', phase: 1, title: '对公用信申请', score: 100, text: longText,
});
const parsed = parseAgentLog('[slot:0 sid:abc] ' + cardLine);
const info = parsed.find((b) => b.kind === 'info');
assert(info && info.text === longText && info.score === 100, 'card text round-trip');

const stepLine = '[step 4] done=yes stopped=no | goal='
  + JSON.stringify('目标\n含|act')
  + ' | act=' + JSON.stringify('{"done":{}}')
  + ' | res=' + JSON.stringify('全文结果')
  + ' | err=' + JSON.stringify('');
const step = parseAgentLog(stepLine).find((b) => b.kind === 'step');
assert(step && step.goal === '目标\n含|act' && step.status === 'done', 'json step line');

const empty = parseAgentLog(
  '[step 3] done=no stopped=no | goal="Execute AgentOutput" | act="{}" | res="None" | err=""',
);
assert(empty.find((b) => b.kind === 'step').status === 'empty', 'empty act');

console.log('characterize-ops-log-cards: OK');
