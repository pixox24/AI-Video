import {
  FILL_RATIO_MIN,
  clampVideoSeconds,
  resolveScriptForm
} from "../../src/utils/scriptDuration";
import { normalizeScriptBrief } from "../../src/utils/scriptOutline";
import { planScriptSections } from "../../src/utils/scriptSections";
import { normalizeScriptLanguage } from "../../src/utils/scriptLanguage";
import { asNumber, firstString, toLoose, type Loose } from "../loose";

export function scriptDraftContext(body: Loose) {
  const budget = toLoose(body.budget);
  const language = normalizeScriptLanguage(firstString(body.scriptLanguage, budget.scriptLanguage));
  const requestedMaxChars = asNumber(budget.maxChars, asNumber(budget.targetUnits));
  const maxChars = Math.min(20000, Math.max(24, Number.isFinite(requestedMaxChars) && requestedMaxChars > 0 ? requestedMaxChars : 110));
  const targetSeconds = clampVideoSeconds(asNumber(budget.targetSeconds, 30) || 30, 30).seconds;
  const title = firstString(
    body.intent === "have-title" ? body.lockedTitle : "",
    toLoose(body.topicCard).title,
    body.topic,
    body.intentNotes,
    "这件事"
  ).trim();
  const brief = normalizeScriptBrief(toLoose(body.brief));
  const genre = firstString(toLoose(body.genrePack).id, toLoose(body.topicCard).genre, body.genre) || undefined;
  const formOverride = firstString(body.scriptFormOverride, body.scriptForm);
  const form = resolveScriptForm(
    targetSeconds,
    formOverride === "short" || formOverride === "medium" || formOverride === "long" || formOverride === "extended"
      ? formOverride
      : null
  );
  const plans = planScriptSections({ targetSeconds, maxChars, genre, form });
  return { language, maxChars, targetSeconds, title, brief, genre, plans, unitName: language === "en" ? "词" : "字", form };
}

export { FILL_RATIO_MIN };
