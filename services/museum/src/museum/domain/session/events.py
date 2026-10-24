from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SessionEventKind(StrEnum):
    ARTIFACT_OPENED = "artifact_opened"
    FOCUS_CHANGED = "focus_changed"
    STORY_ENTERED = "story_entered"
    STORY_ADVANCED = "story_advanced"
    QA_ENTERED = "qa_entered"
    RETURNED_TO_STORY = "returned_to_story"


@dataclass(frozen=True, slots=True)
class SessionEvent:
    session_id: str
    event_seq: int
    kind: SessionEventKind
    revision: int
    interaction_epoch: int
    entity_id: str | None = None
    story_id: str | None = None
    node_id: str | None = None


@dataclass(frozen=True, slots=True)
class TransitionResult:
    state: SessionState
    event: SessionEvent


from museum.domain.session.models import SessionState
