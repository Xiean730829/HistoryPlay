import type { VoiceControlResult } from "./VoiceClient";

export interface SpokenCandidate {
  id: string;
  title: string;
  order: number;
  purpose: string;
}

const ORDINAL = /^(?:(?:那就|就)?(?:选|要)|我选)?(?:第)?(一|二|三|四|五|1|2|3|4|5)(?:个|件)?$/;
const ORDINAL_MAP: Record<string, number> = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
};

function normalize(text: string): string {
  return text.trim().replace(/[，。！？!?、,.\s]/gu, "");
}

/** Keeps the last spoken candidate list across reconnects of the same session. */
export class ConversationCoordinator {
  private candidates: SpokenCandidate[] = [];
  private query: string | null = null;
  private purpose: string | null = null;

  remember(result: VoiceControlResult): SpokenCandidate[] {
    const items = this.extract(result);
    if (items.length > 1) {
      this.candidates = items;
      this.query = result.diagnosis?.query ?? null;
      this.purpose = result.diagnosis?.intent ?? "locate";
    }
    return this.current();
  }

  setCandidates(items: SpokenCandidate[], query?: string, purpose?: string): void {
    this.candidates = items.slice(0, 5);
    this.query = query ?? null;
    this.purpose = purpose ?? "locate";
  }

  current(): SpokenCandidate[] {
    return this.candidates.map((item) => ({ ...item }));
  }

  lastQuery(): string | null {
    return this.query;
  }

  clear(): void {
    this.candidates = [];
    this.query = null;
    this.purpose = null;
  }

  resolveFollowUp(text: string): SpokenCandidate | null {
    if (!this.candidates.length) return null;
    const value = normalize(text).replace(/的$/u, "");
    if (!value) return null;
    // Full requests are resolved by the trusted STT orchestrator. Executing
    // them here too races /commands against /voice/act and can retire narration.
    if (/看|找|参观|打开|定位|故事|介绍|为什么|是不是|什么|如何|哪里|多久|吗/u.test(value)) return null;
    const ordinal = value.match(ORDINAL);
    if (ordinal) {
      const index = ORDINAL_MAP[ordinal[1] ?? ""];
      if (index !== undefined && this.candidates[index]) return this.candidates[index]!;
    }
    return this.candidates.find((item) => {
      const title = normalize(item.title);
      return title.includes(value) || value.includes(title);
    }) ?? null;
  }

  private extract(result: VoiceControlResult): SpokenCandidate[] {
    const extra = result as VoiceControlResult & {
      diagnosis?: VoiceControlResult["diagnosis"] & {
        candidate_ids?: string[];
        candidate_titles?: string[];
      };
    };
    const ids = extra.diagnosis?.candidate_ids ?? [];
    const titles = extra.diagnosis?.candidate_titles ?? [];
    return ids.map((id, order) => ({
      id,
      title: titles[order] ?? id,
      order,
      purpose: extra.diagnosis?.intent ?? this.purpose ?? "locate",
    }));
  }
}
