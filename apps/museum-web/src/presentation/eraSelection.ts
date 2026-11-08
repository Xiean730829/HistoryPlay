/** Entrance dynasty choice. Buttons and XiaoZhi STT share this parser. */
export type EraSelection =
  | { kind: "selected"; era: "tang" | "song" }
  | { kind: "clarify" }
  | { kind: "none" };

const ENTRY_VERB = /进入|参观|去|进|看|打开/u;
const AFFIRMATION = /^(?:嗯)?(?:可以|好的|好|行|没问题)(?:啊|吧|呀)?$/u;
const NEGATION = /(?:不|别|暂时不|先别|不要|不想)(?:要|想|去|看|进入|进|参观|打开|选择|选|去看){0,3}(?:唐代|唐朝|大唐|宋代|宋朝|大宋)/u;
const IN_HALL_DYNASTY_FILTER = /(?:文物|展品|年|世纪)/u;

/** Conservative: contradictory/ambiguous references never select a hall. */
export function selectEraFromEntrance(transcript: string): EraSelection {
  const text = transcript.replace(/[，。！？!?、,.\s]/gu, "");
  if (!text) return { kind: "none" };
  if (AFFIRMATION.test(text)) return { kind: "clarify" };
  const tang = /唐代|唐朝|大唐/u.test(text);
  const song = /宋代|宋朝|大宋/u.test(text);
  if (!tang && !song) {
    if (/博物馆|展厅|展馆|大厅/u.test(text) && ENTRY_VERB.test(text)) return { kind: "clarify" };
    if (/^(?:带我)?(?:进入|参观|进去)(?:吧|呀)?$/u.test(text)) return { kind: "clarify" };
    return { kind: "none" };
  }
  if (tang && song) return { kind: "clarify" };
  if (NEGATION.test(text)) return { kind: "none" };
  if (IN_HALL_DYNASTY_FILTER.test(text) && !/进入|参观/u.test(text)) return { kind: "none" };
  if (!ENTRY_VERB.test(text)) return { kind: "clarify" };
  return { kind: "selected", era: tang ? "tang" : "song" };
}

export const ERA_CHOICE_WELCOME =
  "欢迎来到时空博物馆。请说进入唐代或进入宋代；单说可以不会替你选馆。";
export const TANG_PORTAL_WELCOME =
  "欢迎来到时空博物馆，要我带你进去沿着时间长河欣赏文物的发展吗？";
export const ERA_CLARIFY_SPEECH = "请明确说进入唐代或进入宋代。单说可以不会替你选馆。";

export function applyEntranceIntent(
  transcript: string,
  select: (era: "tang" | "song") => void,
  clarify: () => void,
): boolean {
  const intent = selectEraFromEntrance(transcript);
  if (intent.kind === "selected") {
    select(intent.era);
    return true;
  }
  if (intent.kind === "clarify") {
    clarify();
    return true;
  }
  return false;
}
