import fs from "fs";
import path from "path";
import { countBudgetUnits } from "../../src/utils/scriptLanguage";
import { llmFixturesDir } from "../paths";
import { isLoose, toLoose, type Loose } from "../loose";

export function isLlmMock(): boolean {
  const raw = String(process.env.LLM_MOCK || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function readFixtureFile(stage: string): unknown {
  const file = path.join(llmFixturesDir(), `${stage}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseUnitRange(user: string): { min: number; max: number; language: "zh" | "en" } | null {
  const en = user.match(/word count must be between (\d+) and (\d+)/i);
  if (en) {
    return { min: Number(en[1]), max: Number(en[2]), language: "en" };
  }
  const zh = user.match(/汉字数必须在 (\d+)[–-](\d+)/);
  if (zh) {
    return { min: Number(zh[1]), max: Number(zh[2]), language: "zh" };
  }
  return null;
}

function fillUnits(min: number, max: number, language: "zh" | "en", seed: string): string {
  const unit = language === "en" ? "This is a concrete spoken sentence about the topic. " : "这是一句可拍的口播内容，用来兑现本章承诺。";
  let text = seed || (language === "en" ? "Mocked narration. " : "模拟口播。");
  while (countBudgetUnits(text, language) < min) {
    text += unit;
  }
  const used = countBudgetUnits(text, language);
  if (used > max) {
    if (language === "en") {
      const words = text.trim().split(/\s+/);
      text = words.slice(0, Math.max(1, max)).join(" ");
    } else {
      text = text.replace(/\s+/g, "").slice(0, max);
    }
  }
  return text;
}

function beatFunctionForPrompt(user: string): string {
  const chapter = user.match(/【本章】[^\n]*\b(hook|setup|body|turn|proof|reveal|cta)\b/i);
  const role = (chapter?.[1] || "").toLowerCase();
  if (role === "hook") return "hook";
  if (role === "cta") return "cta";
  if (role === "reveal") return "reveal";
  if (role === "turn") return "turn";
  if (role === "proof" || role === "body") return "proof";
  return "setup";
}

function adaptSection(user: string, fixture: Loose): Loose {
  const range = parseUnitRange(user);
  const language = range?.language || ( /[\u4e00-\u9fff]/.test(user) ? "zh" : "en");
  const min = range?.min || 40;
  const max = range?.max || Math.max(min, 120);
  const orderMatch = user.match(/【本章】(\d+)\//);
  const order = orderMatch ? orderMatch[1] : "1";
  const seedBase = typeof fixture.narration === "string" ? fixture.narration : "";
  const uniqueLead = language === "en" ? `Section ${order}. ` : `第${order}章。`;
  const seed = `${uniqueLead}${seedBase}`;
  const narration = fillUnits(min, max, language, seed);
  const visualIntent = typeof fixture.visualIntent === "string" && fixture.visualIntent
    ? fixture.visualIntent
    : "主体站在窗边看着外面的雨，雨水打在玻璃上";
  return {
    ...fixture,
    narration,
    usedEvidenceIds: Array.isArray(fixture.usedEvidenceIds) ? fixture.usedEvidenceIds : [],
    beats: [
      {
        function: beatFunctionForPrompt(user),
        intent: "兑现本章承诺",
        narration,
        energy: "medium",
        visualIntent,
        needsHold: false
      }
    ]
  };
}

function adaptShortDraft(user: string, fixture: Loose): Loose {
  const range = parseUnitRange(user);
  const language = range?.language || "zh";
  const min = range?.min || 80;
  const max = range?.max || Math.max(min, 160);
  const title = typeof fixture.title === "string" && fixture.title ? fixture.title : "模拟标题";
  const seed = typeof fixture.fullNarration === "string" ? fixture.fullNarration : "";
  const fullNarration = fillUnits(min, max, language, seed);
  const mid = Math.max(1, Math.floor(fullNarration.length / 2));
  const first = fullNarration.slice(0, mid);
  const second = fullNarration.slice(mid) || fullNarration;
  return {
    ...fixture,
    title,
    fullNarration,
    beats: [
      {
        id: "beat-1",
        order: 1,
        function: "hook",
        intent: "前 3 秒制造缺口",
        narration: first,
        energy: "fast",
        visualIntent: "特写一张被打断的日常画面，主体正看向镜头外",
        needsHold: false
      },
      {
        id: "beat-2",
        order: 2,
        function: "cta",
        intent: "收束",
        narration: second,
        energy: "hold",
        visualIntent: "回到开场同一构图，只改一处细节作为回收",
        needsHold: true
      }
    ]
  };
}

export function loadMockPayload(stage: string, user: string): { data: unknown; missing: boolean } {
  const raw = readFixtureFile(stage);
  if (raw == null) return { data: null, missing: true };
  const fixture = isLoose(raw) && raw.data !== undefined ? toLoose(raw.data) : toLoose(raw);
  if (stage === "script_section" || stage === "section_revise") {
    return { data: adaptSection(user, fixture), missing: false };
  }
  if (stage === "script_draft") {
    return { data: adaptShortDraft(user, fixture), missing: false };
  }
  if (stage === "blueprint") {
    return {
      data: {
        oneSentenceThesis: typeof fixture.oneSentenceThesis === "string"
          ? fixture.oneSentenceThesis
          : "模拟全片命题",
        sections: Array.isArray(fixture.sections) ? fixture.sections : []
      },
      missing: false
    };
  }
  return { data: Object.keys(fixture).length ? fixture : raw, missing: false };
}
