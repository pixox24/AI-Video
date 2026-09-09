import {
  PRESET_STYLE_PACKS,
  styleContractForPrompt
} from "../src/utils/stylePack";
import type { StylePack } from "../src/types";
import { isLoose } from "./loose";

export function incomingStyleContract(raw: unknown): string {
  if (isLoose(raw) && raw.world && raw.render) {
    return styleContractForPrompt(raw as unknown as StylePack);
  }
  return styleContractForPrompt(PRESET_STYLE_PACKS.cinematic);
}
