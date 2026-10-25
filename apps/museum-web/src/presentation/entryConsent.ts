const AFFIRMATIVE_ENTRY_RESPONSES = new Set([
  "可以", "可以啊", "好的", "好", "好啊", "行", "当然", "没问题", "带我进去", "带我进去吧", "开始参观", "走吧", "进馆", "进入博物馆",
]);

const NEGATED_ENTRY_INTENT = /(?:不|别|先别|暂时不)(?:要|想|愿意|需要|准备|打算|可以)?(?:我|带我|带你|让我)?(?:走进|进入|进去|进馆|参观|进|去)/u;
const CLEAR_ENTRY_INTENT = /(?:(?:请)?带我(?:走进|进入|进去|进|去)(?:博物馆|展厅|展馆|大厅|里面)?|(?:我)?(?:想|要|愿意)?(?:走进|进入|进去|进馆|去博物馆|去展厅|去展馆|参观)(?:吧|呀)?|进馆吧|进去吧)/u;

/** Only clear, affirmative visitor replies open the entrance; negations stay at the door. */
export function isMuseumEntryConsent(transcript: string): boolean {
  const normalized = transcript.trim().replace(/[，。！？!?、,.\s]/gu, "");
  if (!normalized || NEGATED_ENTRY_INTENT.test(normalized)) return false;
  if (AFFIRMATIVE_ENTRY_RESPONSES.has(normalized)) return true;
  if (CLEAR_ENTRY_INTENT.test(normalized)) return true;
  return /^(?:嗯)?(?:可以|好|好的|行)(?:啊|的)?(?:带我进去|进入博物馆|开始参观)?(?:吧|呀)?$/u.test(normalized);
}
