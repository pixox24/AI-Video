import { maxForecastShotsForDuration } from "../../src/utils/scriptDuration";
import { toLoose, toLooseList, type Loose } from "../loose";

export function validateGeneratedShots(
  parsed: unknown,
  fallbackTitle: string,
  fallbackGenre: string,
  fallbackDuration: number
) {
  const root = toLoose(parsed);
  const shotsRaw = root.shots;
  if (!parsed || !Array.isArray(shotsRaw) || shotsRaw.length === 0) return null;

  const validatedShots = toLooseList(shotsRaw).map((shot: Loose, index: number) => ({
    order: typeof shot.order === "number" ? shot.order : index + 1,
    duration: typeof shot.duration === "number" ? shot.duration : 3.5,
    narration: typeof shot.narration === "string" && shot.narration
      ? shot.narration
      : `镜头 ${index + 1}：关于${fallbackTitle}的精彩解析`,
    secondaryText: typeof shot.secondaryText === "string" ? shot.secondaryText : "",
    visualPrompt:
      (typeof shot.visualPrompt === "string" && shot.visualPrompt)
      || `Cinematic visual for ${fallbackTitle}, scene ${index + 1}, highly detailed, 8k resolution`,
    chineseVisualPrompt: (typeof shot.chineseVisualPrompt === "string" && shot.chineseVisualPrompt)
      || `第 ${index + 1} 幕画面，细腻光影与氛围感`,
    cameraMotion: (typeof shot.cameraMotion === "string" && shot.cameraMotion) || "zoom-in",
    transition: (typeof shot.transition === "string" && shot.transition) || "crossfade"
  }));

  return {
    title: (typeof root.title === "string" && root.title) || fallbackTitle,
    genre: (typeof root.genre === "string" && root.genre) || fallbackGenre,
    totalDuration: (typeof root.totalDuration === "number" && root.totalDuration) || fallbackDuration,
    shots: validatedShots
  };
}

export function generateIntelligentShots(
  topic: string,
  genre: string = "爆款科普",
  visualStyle: string = "cinematic",
  clipCount: number = 4,
  targetDuration: number = 30,
  tone: string = "punchy"
) {
  void tone;
  const safeCount = Math.max(3, Math.min(maxForecastShotsForDuration(targetDuration), Math.round(clipCount) || 4));
  const avgDuration = Math.round((targetDuration / safeCount) * 10) / 10;

  const styleKeywords: Record<string, { promptTag: string; cnStyle: string }> = {
    photorealistic: {
      promptTag: "photorealistic, shot on 35mm lens, f/1.8 aperture, natural volumetric lighting, 8k resolution, award winning photography",
      cnStyle: "超写实单反摄影，通透自然光影"
    },
    cinematic: {
      promptTag: "cinematic lighting, anamorphic lens, blockbuster movie still, 35mm film still, shallow depth of field, atmospheric mist, high production value",
      cnStyle: "电影质感院线大片，戏剧性光影"
    },
    anime: {
      promptTag: "Makoto Shinkai style, vibrant anime art, beautiful lighting, dramatic volumetric clouds, sunbeams, highly detailed background, gorgeous color palette, 4k anime wallpaper",
      cnStyle: "新海诚风唯美动漫，梦幻通透光影"
    },
    cyberpunk: {
      promptTag: "cyberpunk aesthetic, neon city lights, rainy reflective street, holographic interfaces, futuristic skyscrapers, purple and cyan color grading, moody night atmosphere",
      cnStyle: "赛博朋克未来科幻，霓虹流光夜景"
    },
    "3d-render": {
      promptTag: "3D CGI render, Unreal Engine 5, Octane render, ray tracing, cute stylized character, Pixar Disney style lighting, smooth textures, volumetric lighting",
      cnStyle: "皮克斯3D三维渲染，精细全局光照"
    },
    "chinese-ink": {
      promptTag: "traditional Chinese ink wash painting, ethereal poetic atmosphere, watercolor brush strokes, mist and distant mountains, gold foil accents, elegant oriental aesthetics",
      cnStyle: "东方古典水墨意境，苍茫泼墨山水"
    },
    "vintage-film": {
      promptTag: "vintage 1990s 35mm Kodak Portra 400 film photograph, nostalgic warm tones, subtle film grain, soft lens flare, documentary realism",
      cnStyle: "90年代怀旧胶片，温润柯达色调"
    },
    "vector-art": {
      promptTag: "modern vector illustration, clean lines, minimalist flat art, elegant color palette, high contrast, trendy graphic design, Dribbble trending",
      cnStyle: "现代极简矢量插画，扁平几何科技感"
    }
  };

  const currentStyle = styleKeywords[visualStyle] || styleKeywords.cinematic;

  const isSpace = /宇宙|星|深空|太空|黑洞|银河|月球|火星|天文|物理|大爆炸/i.test(topic);
  const isAI = /AI|人工智能|机器人|科技|未来|算法|大模型|数字化|元宇宙|芯片/i.test(topic);
  const isNature = /深海|海洋|地球|生物|自然|动物|森林|极光|火山|冰川/i.test(topic);
  const isHealing = /治愈|人生|焦虑|哲学|允许|成长|心理|生活|情绪|孤独/i.test(topic);
  const isHistory = /历史|古代|文明|战争|帝王|遗迹|王朝|考古|神话/i.test(topic);

  const shotTemplates = [
    {
      hookText: isSpace
        ? `你敢相信吗？当我们仰望星空，所见的浩瀚宇宙，竟只是冰山一角。`
        : isAI
        ? `如果未来就在明天，你是否已经做好准备，迎接AI重构的新世界？`
        : isNature
        ? `在深海一万米的极度深渊，隐藏着颠覆人类认知的神秘生命。`
        : isHealing
        ? `学会允许一切发生，才是治愈内耗、重塑自我的终极力量。`
        : isHistory
        ? `翻开尘封千年的历史画卷，隐藏着许多惊心动魄的文明转折。`
        : `关于「${topic}」，很多人的认知其实只停留在最表层。`,
      enText: isSpace
        ? "Look up at the stars—what we see is merely the tip of the cosmic iceberg."
        : isAI
        ? "If the future arrives tomorrow, are we truly ready for the AI era?"
        : isNature
        ? "In the deep abyss, uncharted life forms defy human imagination."
        : isHealing
        ? "Allowing everything to unfold is the ultimate cure for inner turmoil."
        : isHistory
        ? "Ancient chronicles reveal breathless turning points of civilization."
        : `Unveiling the captivating essence and deeper truth behind ${topic}.`,
      motion: "zoom-in",
      trans: "crossfade",
      sceneDesc: `宏大震撼的黄金开场抓人镜头，聚焦${topic}的极致氛围感`,
      promptKeyword: `Dramatic wide establishing shot of ${topic}, epic atmosphere, stunning visual hook`
    },
    {
      hookText: isSpace
        ? `数百亿光年的尺度上，无数星系与引力交织，蕴含着时空起源的终极谜题。`
        : isAI
        ? `算力与神经网络的指数级爆发，正在以前所未有的速度重塑每个行业。`
        : isNature
        ? `在黑暗与高压的极限环境中，大自然以独特的方式孕育着奇迹。`
        : isHealing
        ? `放下对未知的执念，专注当下每一次呼吸，内心便会逐渐平静澄明。`
        : isHistory
        ? `无数英雄与智者的每一次抉择，都在悄然改变着整个时代的走向。`
        : `深入探索其核心逻辑，你会发现一个环环相扣、充满魅力的全新视角。`,
      enText: isSpace
        ? "Across billions of light years, galaxies weave the ultimate puzzle of time."
        : isAI
        ? "Exponential computing power reshapes every frontier of human innovation."
        : isNature
        ? "Under extreme pressure and darkness, nature crafts breathtaking miracles."
        : isHealing
        ? "Releasing stubborn resistance brings profound clarity and peace to the soul."
        : isHistory
        ? "Pivotal decisions by great minds quietly altered the course of human destiny."
        : `Delving into the inner mechanisms reveals a breathtaking perspective.`,
      motion: "pan-left",
      trans: "crossfade",
      sceneDesc: `层层递进的细节特写与中景，展现核心演化过程与精细机理`,
      promptKeyword: `Intricate detailed medium shot exploring the depth of ${topic}, master composition`
    },
    {
      hookText: isSpace
        ? `每一次深空探测的突破，都是人类智慧跨越光年、触碰真理的勇气。`
        : isAI
        ? `人机共生的时代已经到来，唯有拥抱变化，才能成为时代的引领者。`
        : isNature
        ? `万物生生不息的奥秘，正是生命在漫长岁月里书写的最美赞歌。`
        : isHealing
        ? `接纳所有的不完美，风雨过后，自会迎来属于你的万里晴空。`
        : isHistory
        ? `文明的火种历经风雨淬炼，依然在岁月的长河中熠熠生辉。`
        : `突破认知的边界之后，呈现在眼前的，是一片更为广阔壮美的天地。`,
      enText: isSpace
        ? "Every deep-space discovery marks humanity's relentless quest for truth."
        : isAI
        ? "In the era of human-AI collaboration, adaptability defines the visionary."
        : isNature
        ? "The endless cycle of existence is nature's most magnificent symphony."
        : isHealing
        ? "Embracing imperfection clears the path to your own vibrant horizon."
        : isHistory
        ? "The flames of civilization endure through centuries of trial and resilience."
        : `Transcending boundaries reveals an even grander, breathtaking horizon.`,
      motion: "cinematic-orbit",
      trans: "slide-left",
      sceneDesc: `高潮段落的动感视角，光影层次丰富，展现宏大的张力`,
      promptKeyword: `High-octane dynamic cinematic shot capturing the essence of ${topic}, volumetric rays`
    },
    {
      hookText: isSpace
        ? `探索未知的征途永无止境，我们的征途，始终是星辰大海。`
        : isAI
        ? `未来的画卷已然铺展，让我们一起见证并创造科技的无限可能。`
        : isNature
        ? `敬畏自然，珍视每一个生命的律动，守护这颗蓝色星球的奇迹。`
        : isHealing
        ? `愿你带着这份从容与热爱，勇敢前行，去拥抱更广阔的自我。`
        : isHistory
        ? `读懂历史的厚重与智慧，方能更加坚定地走向属于我们的明天。`
        : `关注更多深度思考与精彩瞬间，一起探索更广阔的认知世界。`,
      enText: isSpace
        ? "The cosmic journey is endless; our quest remains the boundless ocean of stars."
        : isAI
        ? "The canvas of tomorrow unfolds—join the journey into limitless innovation."
        : isNature
        ? "Revere the wild and protect the wonder of our shared living planet."
        : isHealing
        ? "Walk forward with calm conviction and embrace the boundless light within."
        : isHistory
        ? "Understanding the past empowers us to stride confidently into the future."
        : `Stay inspired and join us as we continue to explore deeper horizons.`,
      motion: "zoom-out",
      trans: "fade-black",
      sceneDesc: `意境深远的收尾镜头，余韵悠长，引发情感共鸣与互动`,
      promptKeyword: `Poetic closing wide shot of ${topic}, golden hour glow, awe-inspiring beauty`
    }
  ];

  return Array.from({ length: safeCount }, (_, i) => {
    const template = shotTemplates[i % shotTemplates.length];
    const shotNum = i + 1;
    const duration = i === safeCount - 1
      ? Math.round((targetDuration - (avgDuration * (safeCount - 1))) * 10) / 10 || avgDuration
      : avgDuration;

    return {
      order: shotNum,
      duration: Math.max(2.5, Math.min(8.0, duration)),
      narration: template.hookText,
      secondaryText: template.enText,
      visualPrompt: `${template.promptKeyword}, depicting ${topic}, scene ${shotNum}, ${currentStyle.promptTag}`,
      chineseVisualPrompt: `${template.sceneDesc}，${currentStyle.cnStyle}`,
      cameraMotion: template.motion,
      transition: template.trans
    };
  });
}
