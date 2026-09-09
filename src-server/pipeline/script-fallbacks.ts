import type { ScriptLanguage } from "../../src/types";
import { countBudgetUnits } from "../../src/utils/scriptLanguage";

export function fallbackTopicCardsServer(seed: string, intent: string, language: ScriptLanguage = "zh") {
  if (language === "en") {
    const topic = String(seed || "").trim() || "a short video worth shooting";
    const short = topic.split(/\s+/).slice(0, 6).join(" ");
    return [
      {
        id: `topic-fb-1-${Date.now()}`,
        title: intent === "have-title" ? topic : short,
        hook: `Everyone has ${short} backwards.`,
        insight: "Break one common myth, then leave one mechanism people can take away.",
        genre: intent === "product" ? "带货" : "反常识",
        whyNow: "Search and comments keep asking the same why.",
        durationHint: 30,
        paceHint: "medium",
        conceptCount: 1,
        risk: "If you only dunk on the myth, it becomes a rant.",
        completionFit: "Hook is a flip. Show the contrast in 3 seconds.",
        hookType: "misconception"
      },
      {
        id: `topic-fb-2-${Date.now()}`,
        title: `Do ${short} in three steps`,
        hook: `From now on, ${short} is three steps.`,
        insight: "Turn the topic into actions, not a list of opinions.",
        genre: "教程",
        whyNow: "Most videos stay conceptual. Step-by-step is still a gap.",
        durationHint: 30,
        paceHint: "fast",
        conceptCount: 1,
        risk: "More than 3 steps will not fit 15–30 seconds.",
        completionFit: "Fast pace. One action per shot.",
        hookType: "outcome"
      },
      {
        id: `topic-fb-3-${Date.now()}`,
        title: `The 3 seconds inside ${short}`,
        hook: "The part that decides the outcome is not the opening. It is the middle 3 seconds.",
        insight: "Put the theme in one concrete moment the camera can see.",
        genre: intent === "blank" ? "情绪" : "故事",
        whyNow: "Competitors state the conclusion. Few people stage it.",
        durationHint: 45,
        paceHint: "slow",
        conceptCount: 1,
        risk: "If the scene is vague, image gen will miss.",
        completionFit: "Slow pace. Hold after the line.",
        hookType: "mystery"
      }
    ];
  }
  const topic = String(seed || "").trim() || "一个值得拍的短视频主题";
  const short = topic.slice(0, 12);
  return [
    {
      id: `topic-fb-1-${Date.now()}`,
      title: intent === "have-title" ? topic : topic.slice(0, 18),
      hook: `${topic.replace(/[。！？!?]$/, "")}，但大多数人搞反了顺序。`,
      insight: "先拆一个常见误解，再给一个能带走的机制。",
      genre: intent === "product" ? "带货" : "反常识",
      whyNow: "评论区和搜索里反复出现同一句「为什么」，正缺一条把机制讲清的片子。",
      durationHint: 30,
      paceHint: "medium",
      conceptCount: 1,
      risk: "如果只骂误解不给机制，会变成抬杠。",
      completionFit: "钩子是翻转认知，3 秒内要抛出反差。",
      hookType: "misconception"
    },
    {
      id: `topic-fb-2-${Date.now()}`,
      title: `跟着走一遍：${short}`,
      hook: `从现在起 ${short} 只做三步。`,
      insight: "把主题收成可执行步骤，而不是观点清单。",
      genre: "教程",
      whyNow: "同类内容停在概念层，步骤向的讲解仍是缺口。",
      durationHint: 30,
      paceHint: "fast",
      conceptCount: 1,
      risk: "步骤超过 3 个，15–30 秒会装不下。",
      completionFit: "快节奏，每步一镜。",
      hookType: "outcome"
    },
    {
      id: `topic-fb-3-${Date.now()}`,
      title: `${short}的那 3 秒`,
      hook: "真正决定结果的，不是开头，是中间那 3 秒。",
      insight: "用一个具体瞬间当故事容器，主题变成可看见的场面。",
      genre: intent === "blank" ? "情绪" : "故事",
      whyNow: "对标片多在讲结论，少有人用一个场面把结论演出来。",
      durationHint: 45,
      paceHint: "slow",
      conceptCount: 1,
      risk: "场面选得太虚，下游生图会对不准。",
      completionFit: "慢节奏，金句后要敢停。",
      hookType: "mystery"
    }
  ];
}

export function fallbackDraftServer(topic: string, hook: string, maxChars: number, language: ScriptLanguage = "zh", insight = "") {
  const safeTopic = topic.trim() || (language === "en" ? "this" : "这件事");
  const note = String(insight || "").trim();
  const setup = note
    ? (language === "en" ? `Here is the point: ${note}.` : `先把这件事讲清：${note}。`)
    : (language === "en" ? "The usual story is backwards." : "先把最常见的误会拿掉：它不是看起来那样运作的。");
  const sentences = language === "en"
    ? [
      hook || `You think you understand ${safeTopic}. You don't.`,
      setup,
      "The part that actually matters is the change you missed.",
      "Once you see that, the next choice gets simple.",
      `Keep your attention on ${safeTopic} itself.`
    ]
    : [
      hook || `你以为你懂${safeTopic}，其实关键不在那儿。`,
      setup,
      "真正起作用的，是中间那一下你没注意到的变化。",
      "看清这一点之后，后面的选择会简单很多。",
      `记住这一句就够：把注意力放回${safeTopic}本身。`
    ];
  let fullNarration = "";
  for (const sentence of sentences) {
    const next = fullNarration ? `${fullNarration}${language === "en" ? " " : ""}${sentence}` : sentence;
    if (countBudgetUnits(next, language) > maxChars && fullNarration) break;
    fullNarration = next;
  }
  const beats = [
    { id: "beat-1", order: 1, function: "hook", intent: "前 3 秒制造缺口", narration: sentences[0], targetSeconds: 3, energy: "fast", visualIntent: "特写一张被打断的日常画面，主体正看向镜头外", needsHold: false },
    { id: "beat-2", order: 2, function: "setup", intent: "为什么要看下去", narration: sentences[1], targetSeconds: 6, energy: "medium", visualIntent: "把误解画成一个简单对比：左边常见做法，右边被划掉", needsHold: false },
    { id: "beat-3", order: 3, function: "turn", intent: "转折", narration: sentences[2], targetSeconds: 8, energy: "fast", visualIntent: "镜头推进到被忽略的细节，光线刚好落在变化发生的位置", needsHold: false },
    { id: "beat-4", order: 4, function: "reveal", intent: "关键一句", narration: sentences[3], targetSeconds: 7, energy: "slow", visualIntent: "细节展开后的全貌，主体停住，环境安静", needsHold: true },
    { id: "beat-5", order: 5, function: "cta", intent: "收束", narration: sentences[4], targetSeconds: 6, energy: "hold", visualIntent: "回到开场同一构图，只改一处细节作为回收", needsHold: true }
  ];
  return { title: safeTopic.slice(0, 20), fullNarration, beats };
}
