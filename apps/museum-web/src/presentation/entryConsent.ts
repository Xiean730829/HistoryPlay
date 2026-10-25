const AFFIRMATIVE_ENTRY_RESPONSES = new Set([
  "可以", "可以啊", "好的", "好", "好啊", "行", "带我进去", "带我进去吧", "开始参观", "走吧", "进馆", "进入博物馆",
]);

/** Only clear, affirmative visitor replies open the entrance; negations stay at the door. */
export function isMuseumEntryConsent(transcript: string): boolean {
  const normalized = transcript.trim().replace(/[，。！？!?、,.\s]/gu, "");
  if (AFFIRMATIVE_ENTRY_RESPONSES.has(normalized)) return true;
  return /^(?:嗯)?(?:可以|好|好的|行)(?:啊|的)?(?:带我进去|进入博物馆|开始参观)?(?:吧|呀)?$/u.test(normalized);
}
