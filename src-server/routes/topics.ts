import type { Express } from "express";
import { Type } from "@google/genai";
import { generateGeminiJson } from "../llm/gateway";
import { errorMessage, requestBody } from "../loose";

export function registerTopicsRoutes(app: Express): void {
  app.post("/api/topics/suggest", async (req, res) => {
    const { category = "热门趋势" } = requestBody(req.body as unknown);
    const categoryKey = typeof category === "string" && category ? category : "热门趋势";

    const fallbackTopics: Record<string, string[]> = {
      "热门趋势": [
        "深海一万米到底隐藏着什么未知生物？",
        "未来10年，普通人如何通过AI打造超级个体？",
        "宇宙大爆炸之前究竟存在什么？",
        "为什么越来越多年轻人开始践行极简主义生活？",
        "被神话掩盖的历史真相：古蜀文明到底来自哪里？",
        "脑机接口技术将如何彻底改写人类记忆与认知？"
      ],
      "爆款科普": [
        "如果地球突然停止自转1秒钟会发生什么？",
        "光年到底有多远？带你沉浸式体验光速穿越太阳系",
        "为什么人类的大脑只开发了10%是个巨大的谣言？",
        "量子纠缠究竟有多诡异？爱因斯坦为何称它为鬼魅行动？"
      ],
      "情感治愈": [
        "允许一切发生：治愈你所有焦虑的生命智慧",
        "走过半生才明白：真正的高贵，是不与烂人烂事纠缠",
        "不必行色匆匆，不必光芒万丈，做一棵安静生长的树"
      ]
    };

    const defaultList = fallbackTopics[categoryKey] || fallbackTopics["热门趋势"];

    try {
      const gemini = await generateGeminiJson({
        stage: "topics_suggest",
        system: "只输出 JSON 字符串数组。",
        user: `请针对分类【${categoryKey}】，推荐 6 个适合制作 30~60 秒爆款短视频的主题，要求标题极具悬念感或视觉冲击力。以JSON数组返回字符串列表。`,
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      });
      if (Array.isArray(gemini.data) && gemini.data.length > 0) {
        return res.json({ topics: gemini.data });
      }
      return res.json({ topics: defaultList });
    } catch (error: unknown) {
      console.warn("[Topic Suggest] Gemini fallback:", errorMessage(error));
      return res.json({ topics: defaultList });
    }
  });
}
