import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_WRITING_STYLES, BASE_BANNED_PATTERNS, findWritingStyleProfile, writingStyleProfileSchema } from '../../src/shared/writingStyle';
import { sectionStyleViolations, styleGuidelineList, violatedStyleRules, writingStyleBlock } from './writingStyle';
import { styleLint, styleSentenceUnits, splitStyleSentences } from './lint';

const pundit = BUILTIN_WRITING_STYLES.find(profile => profile.id === 'pundit')!;
const analyst = BUILTIN_WRITING_STYLES.find(profile => profile.id === 'analyst')!;

test('acceptance 3: styleLint reports a violation for a sentence containing 众所周知', () => {
  const violations = styleLint('众所周知，这个方法一定有效。', pundit);
  const banned = violations.filter(item => item.code === 'banned_pattern');
  assert.equal(banned.length, 1);
  assert.match(banned[0].message, /众所周知/);
  assert.match(banned[0].evidence, /众所周知/);
  assert.equal(banned[0].severity, 'medium');
  assert.ok(banned[0].suggestedFix.length > 0);
});

test('styleLint is quiet on clean copy and stays deterministic across calls', () => {
  const clean = '别再谈自律了。问题不是自律，是诱惑太便宜。手机就在手边，短视频三秒给一次反馈。';
  assert.deepEqual(styleLint(clean, pundit), []);
  assert.deepEqual(styleLint(clean, pundit), styleLint(clean, pundit));
  assert.deepEqual(styleLint('   ', pundit), []);
  assert.deepEqual(styleLint(clean, pundit).slice(0, 0), []);
});

test('styleLint dedupes repeated banned hits and honours the result limit', () => {
  const noisy = '众所周知，甲。众所周知，乙。显而易见，丙。毋庸置疑，丁。';
  const codes = styleLint(noisy, pundit).filter(item => item.code === 'banned_pattern');
  assert.deepEqual(codes.map(item => item.evidence).length, codes.length);
  assert.equal(new Set(codes.map(item => item.message)).size, codes.length);
  assert.equal(styleLint(noisy, pundit, { limit: 2 }).length, 2);
});

test('styleLint flags abstract placeholder words shared with the draft system prompt', () => {
  const violations = styleLint('这个画面很有氛围，整体很有电影感。', BUILTIN_WRITING_STYLES[1]);
  const abstract = violations.filter(item => item.code === 'abstract_placeholder');
  assert.ok(abstract.some(item => item.message.includes('很有氛围')));
  assert.ok(abstract.some(item => item.message.includes('电影感')));
  assert.ok(abstract.every(item => item.severity === 'medium'));
  // A word that is also in the archive's own ban list is reported as a banned pattern instead.
  const banned = styleLint('整体氛围感爆棚。', BUILTIN_WRITING_STYLES[1]);
  assert.equal(banned.some(item => item.code === 'banned_pattern' && item.message.includes('氛围感爆棚')), true);
  assert.equal(banned.some(item => item.code === 'abstract_placeholder'), false);
});

test('sentence-length thresholds use the archive declaration and never exceed medium severity', () => {
  const longSentence = `${'这是一个非常长的句子用来测试句长阈值'.repeat(4)}。`;
  const violations = styleLint(longSentence, pundit);
  const share = violations.find(item => item.code === 'short_sentence_share');
  const length = violations.find(item => item.code === 'sentence_length');
  assert.ok(share, 'short-sentence share must be reported');
  assert.match(share!.message, /60%/);
  assert.ok(length, 'over-hard-limit sentence must be reported');
  assert.match(length!.message, /60 字硬上限/);
  assert.ok(violations.every(item => item.severity === 'medium' || item.severity === 'low'));
  // The same copy breaches analyst's looser share floor (40%) but stays under its 80-unit hard cap.
  const analystViolations = styleLint(longSentence, analyst);
  assert.equal(analystViolations.some(item => item.code === 'short_sentence_share'), true);
  assert.equal(analystViolations.some(item => item.code === 'sentence_length'), false);
});

test('sentence-length thresholds are skipped for English drafts and profiles without thresholds', () => {
  const longEnglish = 'This is a deliberately long english sentence that keeps going and going without any stop.';
  assert.equal(styleLint(longEnglish, pundit, { language: 'en' }).some(item => item.code === 'sentence_length'), false);
  const noThresholds = { ...pundit, id: 'custom-test', kind: 'custom' as const, lintThresholds: undefined };
  assert.equal(styleLint('这是一个非常长的句子用来测试句长阈值'.repeat(4), noThresholds).some(item => item.code === 'sentence_length'), false);
});

test('style sentence splitting and unit counting are stable for both languages', () => {
  assert.deepEqual(splitStyleSentences('第一句。第二句！第三句？'), ['第一句。', '第二句！', '第三句？']);
  assert.deepEqual(splitStyleSentences('没有结束标点'), ['没有结束标点']);
  assert.equal(styleSentenceUnits('短句。', 'zh'), 2);
  assert.equal(styleSentenceUnits('one two three', 'en'), 3);
  assert.equal(styleSentenceUnits('', 'zh'), 0);
});

test('style blocks render the exact spec template and only when a profile is selected', () => {
  const block = writingStyleBlock(pundit);
  assert.match(block, /^【写作风格】按「犀利观点」执行：\n1\. /);
  assert.ok(block.includes(`禁止表达：${pundit.bannedPatterns.join('、')}`));
  assert.ok(block.includes(`范例（就照这个语感写）：「${pundit.exemplar}」`));
  assert.ok(block.includes(`反例（不要写成这样）：「${pundit.counterExemplar}」`));
  assert.match(block, /风格约束不改变本章 promise、证据约束与时长预算；冲突时内容与时长优先。$/);
  assert.ok(block.split('\n').length >= pundit.rules.length + 5);
  assert.equal(writingStyleBlock(pundit, []), writingStyleBlock(pundit));
  const oneRule = writingStyleBlock(pundit, [pundit.rules[1]]);
  assert.ok(!oneRule.includes(`1. ${pundit.rules[0]}`));
  assert.ok(oneRule.includes(`1. ${pundit.rules[1]}`));
});

test('violated style rules are derived from findings for the revise block', () => {
  const rule = pundit.rules[0];
  assert.deepEqual(violatedStyleRules(pundit, [{ message: `违反：${rule}` }]), [rule]);
  assert.deepEqual(violatedStyleRules(pundit, [{ message: '无关', evidence: rule }]), [rule]);
  assert.deepEqual(violatedStyleRules(pundit, [{ message: '无关内容' }]), []);
  assert.equal(styleGuidelineList(pundit).split('\n').length, pundit.rules.length);
});

test('built-in archives satisfy the schema, stay unlocked and are explicitly provisional', () => {
  assert.deepEqual(BUILTIN_WRITING_STYLES.map(profile => profile.id), ['analyst', 'narrator', 'pundit']);
  for (const profile of BUILTIN_WRITING_STYLES) {
    assert.equal(writingStyleProfileSchema.safeParse(profile).success, true, profile.id);
    assert.equal(profile.kind, 'builtin');
    assert.ok(profile.rules.length >= 5 && profile.rules.length <= 8, `${profile.id} rule count`);
    assert.equal(profile.locked, false);
    assert.equal(profile.derivedFromSamples, false);
    assert.equal(profile.provisional, true, 'archives are not yet inducted from real samples');
    for (const base of BASE_BANNED_PATTERNS) assert.ok(profile.bannedPatterns.includes(base), `${profile.id} missing ${base}`);
    assert.deepEqual(styleLint(profile.exemplar, profile), [], `${profile.id} exemplar must pass its own lint`);
  }
});

test('findWritingStyleProfile resolves built-ins, custom archives and empty ids', () => {
  const custom = { ...pundit, id: 'custom-123', kind: 'custom' as const };
  assert.equal(findWritingStyleProfile('pundit')?.label, '犀利观点');
  assert.equal(findWritingStyleProfile('custom-123', [custom])?.id, 'custom-123');
  assert.equal(findWritingStyleProfile('custom-123'), undefined);
  assert.equal(findWritingStyleProfile(undefined, [custom]), undefined);
  assert.equal(findWritingStyleProfile('  '), undefined);
  assert.equal(findWritingStyleProfile('  analyst  ')?.id, 'analyst');
});

test('sectionStyleViolations returns the exact records used for before/after comparison', () => {
  assert.deepEqual(sectionStyleViolations(pundit, '别再谈自律了。', 'zh'), []);
  assert.ok(sectionStyleViolations(pundit, '众所周知，自律最重要。').length > 0);
});
