/** Keep this list identical to services/voice-bridge museum_voice.control_flow.RENDER_GATED_ACTIONS. */
export const RENDER_GATED_ACTIONS = [
  "locate_artifact",
  "move_next",
  "move_previous",
  "return_to_exhibit",
  "set_view",
  "browse_gallery",
  "seek_time_range",
] as const;

export type RenderGatedAction = (typeof RENDER_GATED_ACTIONS)[number];

const RENDER_GATED_ACTION_SET = new Set<string>(RENDER_GATED_ACTIONS);

/** Actions that change the four-slot overview and must not start a close-up intro. */
export const OVERVIEW_WINDOW_ACTIONS = ["browse_gallery", "seek_time_range"] as const;

const OVERVIEW_WINDOW_ACTION_SET = new Set<string>(OVERVIEW_WINDOW_ACTIONS);

export const CLOSE_UP_INTRO_ACTIONS = ["locate_artifact", "move_next", "move_previous"] as const;

const CLOSE_UP_INTRO_ACTION_SET = new Set<string>(CLOSE_UP_INTRO_ACTIONS);

export function isRenderGatedAction(action: string | null | undefined): action is RenderGatedAction {
  return typeof action === "string" && RENDER_GATED_ACTION_SET.has(action);
}

export function isOverviewWindowAction(action: string | null | undefined): boolean {
  return typeof action === "string" && OVERVIEW_WINDOW_ACTION_SET.has(action);
}

export function isCloseUpIntroAction(action: string | null | undefined): boolean {
  return typeof action === "string" && CLOSE_UP_INTRO_ACTION_SET.has(action);
}
