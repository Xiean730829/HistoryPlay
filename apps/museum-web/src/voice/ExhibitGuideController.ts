import { enterStory, locateArtifact, refreshSession, type ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { voiceTrace } from "./VoiceTrace";
import type { StoryRequest } from "./VoiceClient";

export interface StoryOffer {
  offerId: string;
  visitId: string;
  artifactId: string;
  storyId: string;
  packId: string;
  version: string;
  revision: number;
  createdAt: number;
  audible: boolean;
  expiresAt: number;
  consumed: boolean;
}

export interface GuideHooks {
  onStatus(message: string): void;
  speakIntro(sequence: number, expectedRevision?: number): Promise<void>;
  presentInspection(receipt: CommandReceipt): Promise<"rendered" | "degraded" | "pending">;
  onStoryOpened(receipt: CommandReceipt): Promise<void>;
  beforeStoryEntry?(): void;
  currentSequence(): number;
  disposed(): boolean;
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

export function isStoryOfferConsent(text: string): boolean {
  const normalized = text.trim().replace(/[，。！？!?、,\.\s]/gu, "");
  return /^(?:嗯)?(?:可以|好|好的|好啊|行|当然|没问题|那就听听)(?:啊|的)?(?:进入故事|讲故事|讲吧)?(?:吧|呀)?$/u.test(normalized)
    || /^(?:好啊讲吧|那就听听|继续讲这个故事)$/u.test(normalized);
}

/** Short replies that the backend still treats as non-commands, so the guide may consume an audible offer. */
export function isShortStoryConsent(text: string): boolean {
  const normalized = text.trim().replace(/[，。！？!?、,\.\s]/gu, "");
  return /^(?:嗯)?(?:可以|好|好的|好啊|行|当然|没问题|那就听听)(?:啊|的)?(?:吧|呀)?$/u.test(normalized);
}

export function isStoryDecline(text: string): boolean {
  const normalized = text.trim().replace(/[，。！？!?、,\.\s]/gu, "");
  return /^(?:先不听|不想听(?:故事)?|不要听(?:故事)?|别听(?:故事)?|先不要|不要讲故事|先等等|等等|先别讲)(?:了|吧|呀)?$/u.test(normalized);
}

function rememberUtterance(seen: Set<string>, id: string | undefined): boolean {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 32) seen.delete(seen.values().next().value as string);
  return false;
}

/** Owns one exhibit visit: intro, offer, and a single story entry. */
export class ExhibitGuideController {
  private visitId: string | null = null;
  private visitArtifactId: string | null = null;
  private offer: StoryOffer | null = null;
  private inFlight = false;
  private readonly seen = new Set<string>();

  constructor(
    private session: ActiveSession,
    private readonly hooks: GuideHooks,
  ) {}

  replaceSession(session: ActiveSession): void {
    this.session = session;
  }

  currentOffer(): StoryOffer | null {
    return this.offer && !this.offer.consumed ? { ...this.offer } : null;
  }

  invalidate(reason: string): void {
    if (this.offer && !this.offer.consumed) {
      voiceTrace.record("guide", { offer: "revoked", reason, offer_id: this.offer.offerId });
    }
    this.offer = null;
    this.visitId = null;
    this.visitArtifactId = null;
  }

  noteInspection(artifactId: string, revision: number, source: "voice" | "click"): boolean {
    if (!artifactId) return false;
    if (this.visitArtifactId === artifactId && this.visitId) {
      voiceTrace.record("guide", { visit_id: this.visitId, artifact_id: artifactId, reused: true, source });
      return false;
    }
    this.visitId = randomId();
    this.visitArtifactId = artifactId;
    this.offer = null;
    voiceTrace.record("guide", { visit_id: this.visitId, artifact_id: artifactId, source, revision });
    return true;
  }

  markOfferAudible(artifactId: string, storyId: string, revision: number): void {
    if (!this.visitId || this.visitArtifactId !== artifactId) return;
    this.offer = {
      offerId: randomId(),
      visitId: this.visitId,
      artifactId,
      storyId,
      packId: this.session.pack_id,
      version: this.session.version,
      revision,
      createdAt: Date.now(),
      audible: true,
      expiresAt: Date.now() + 60_000,
      consumed: false,
    };
    voiceTrace.record("guide", {
      offer: "created",
      offer_id: this.offer.offerId,
      visit_id: this.visitId,
      artifact_id: artifactId,
      story_id: storyId,
      audible: true,
    });
  }

  async handleStoryRequest(request: StoryRequest, utteranceId?: string): Promise<void> {
    const id = utteranceId || request.utterance_id;
    if (rememberUtterance(this.seen, id)) return;
    if (this.inFlight) return;
    if (request.kind === "decline") {
      this.invalidate("declined");
      this.hooks.onStatus("好，先不讲故事");
      return;
    }
    if (request.kind === "consent") {
      const offer = this.offer;
      if (!offer || offer.consumed || !offer.audible || Date.now() > offer.expiresAt) {
        this.hooks.onStatus("现在没有有效的故事邀请，请先明确说想听当前文物的故事");
        return;
      }
      await this.enter(offer.storyId, offer.artifactId);
      return;
    }
    if (request.kind === "explicit_named") {
      const artifactId = request.artifact_id;
      if (!artifactId) {
        this.hooks.onStatus(request.candidates && request.candidates > 1
          ? "请说更具体的文物名称，我还没有移动"
          : "当前展厅没有这件文物，不能讲它的故事");
        return;
      }
      await this.locateThenEnter(artifactId);
      return;
    }
    await this.enterCurrentStory();
  }

  async acceptExplicitStoryFromTranscript(text: string, utteranceId?: string): Promise<boolean> {
    const normalized = text.trim().replace(/[，。！？!?、,.\s]/gu, "").replace(/[吧呀啊了呢哦嗯]+$/u, "");
    if (!normalized || !normalized.includes("故事")) return false;
    if (/(?:是真的吗|为什么这样讲|故事里发生了什么|是不是真的)$/u.test(normalized)) return false;
    if (isStoryDecline(text)) return false;
    const simple = /^(?:(?:请|麻烦)?(?:你)?(?:我想要|我想|我要|带我|给我|帮我)?)(?:讲讲|讲一讲|讲一下|讲|看看|看|听一听|听听|听)(?:这个)?故事$/u.test(normalized);
    const named = simple ? null : normalized.match(/(?:讲讲|讲一讲|讲一下|讲|看看|看|听一听|听听|听)(.{1,24}?)(?:的)?故事/u)
      ?? normalized.match(/^(.{1,24}?)的故事$/u);
    const currentReference = /^(?:背后|(?:它|这个|这件|这个东西|这件东西|文物|展品|器物|这个文物|这件文物|当前文物|现在的文物|当前展品|这个展品|这件展品|这个器物|这件器物)(?:的)?(?:背后|相关)?)$/u;
    if (named && !currentReference.test(named[1] ?? "")) {
      return false;
    }
    if (rememberUtterance(this.seen, utteranceId)) return true;
    if (this.inFlight) return true;
    return this.enterCurrentStory();
  }

  async acceptConsentFromTranscript(text: string, utteranceId?: string): Promise<boolean> {
    if (isStoryDecline(text)) {
      if (rememberUtterance(this.seen, utteranceId)) return true;
      this.invalidate("declined");
      this.hooks.onStatus("好，先不讲故事");
      return true;
    }
    if (!isShortStoryConsent(text)) return false;
    if (rememberUtterance(this.seen, utteranceId)) return true;
    if (this.inFlight) return true;
    const offer = this.offer;
    if (!offer || offer.consumed || !offer.audible || Date.now() > offer.expiresAt) return false;
    await this.enter(offer.storyId, offer.artifactId);
    return true;
  }

  private async enterCurrentStory(): Promise<boolean> {
    const current = await refreshSession(this.session);
    this.session = current;
    const artifact = current.context.focused_artifact;
    if (!artifact) {
      this.hooks.onStatus("请先选择一件文物，再听它的故事");
      return true;
    }
    const storyId = artifact.story_entry_ids?.[0];
    if (!storyId) {
      this.hooks.onStatus("当前文物还没有开放故事");
      return true;
    }
    await this.enter(storyId, artifact.id);
    return true;
  }

  private async locateThenEnter(artifactId: string): Promise<void> {
    const sequence = this.hooks.currentSequence();
    this.inFlight = true;
    try {
      const current = await refreshSession(this.session);
      this.session = current;
      if (current.context.focused_artifact?.id !== artifactId) {
        const located = await locateArtifact(current, artifactId);
        if (this.hooks.disposed() || sequence !== this.hooks.currentSequence()) return;
        if (located.receipt.status !== "committed") {
          this.hooks.onStatus(located.receipt.reason ?? "还没有走到这件文物，不能继续讲它的故事");
          return;
        }
        this.session = located.session;
        this.hooks.onStatus("已定位到指定文物，正在打开它的故事");
        const status = await this.hooks.presentInspection(located.receipt);
        if (this.hooks.disposed() || sequence !== this.hooks.currentSequence()) return;
        if (status !== "rendered") {
          this.hooks.onStatus("指定文物画面尚未呈现，故事没有打开");
          return;
        }
      }
      const latest = await refreshSession(this.session);
      this.session = latest;
      if (latest.context.focused_artifact?.id !== artifactId) {
        this.hooks.onStatus("画面还停在刚才的文物，指定故事没有打开");
        return;
      }
      const storyId = latest.context.focused_artifact.story_entry_ids?.[0];
      if (!storyId) {
        this.hooks.onStatus("这件文物还没有开放故事");
        return;
      }
      await this.commitEnter(storyId, artifactId);
    } finally {
      this.inFlight = false;
    }
  }

  private async enter(storyId: string, artifactId: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.commitEnter(storyId, artifactId);
    } finally {
      this.inFlight = false;
    }
  }

  private async commitEnter(storyId: string, artifactId: string): Promise<void> {
    const sequence = this.hooks.currentSequence();
    const current = await refreshSession(this.session);
    this.session = current;
    const stories = current.context.focused_artifact?.story_entry_ids ?? [];
    if (this.hooks.disposed() || sequence !== this.hooks.currentSequence()
      || current.context.mode !== "explore" || current.context.story_node
      || current.context.focused_artifact?.id !== artifactId || !stories.includes(storyId)
      || current.pack_id !== this.session.pack_id) {
      this.hooks.onStatus("当前展台已变化，故事没有打开");
      return;
    }
    if (this.offer && this.offer.artifactId === artifactId) this.offer.consumed = true;
    this.hooks.beforeStoryEntry?.();
    voiceTrace.record("guide", { enter: true, story_id: storyId, artifact_id: artifactId });
    const result = await enterStory(current, storyId);
    if (this.hooks.disposed() || sequence !== this.hooks.currentSequence()) return;
    if (result.receipt.status !== "committed") {
      if (this.offer && this.offer.artifactId === artifactId) this.offer.consumed = false;
      this.hooks.onStatus(result.receipt.reason ?? "故事暂时无法打开，请稍后重试");
      return;
    }
    this.session = result.session;
    this.offer = null;
    this.hooks.onStatus("正在打开故事并准备第一幕讲解");
    await this.hooks.onStoryOpened(result.receipt);
  }
}
