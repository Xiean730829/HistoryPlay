from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema.validators import validator_for
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "contracts" / "schemas" / "v1"
EXAMPLES = ROOT / "contracts" / "examples" / "v1"
SCHEMA_FILES = {
    "content-pack": "content-pack.schema.json",
    "artifact": "artifact.schema.json",
    "asset": "asset.schema.json",
    "source": "source.schema.json",
    "fact-card": "fact-card.schema.json",
    "story-node": "story-node.schema.json",
    "story": "story.schema.json",
    "historical-event": "historical-event.schema.json",
    "relation": "relation.schema.json",
    "session": "session.schema.json",
    "command": "command.schema.json",
    "event": "event.schema.json",
    "receipt": "receipt.schema.json",
    "voice-event": "voice-event.schema.json",
    "mcp-tools": "mcp-tools.schema.json",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def schema_registry() -> Registry:
    resources = []
    for path in SCHEMAS.glob("*.json"):
        contents = load_json(path)
        resources.append((contents["$id"], Resource.from_contents(contents)))
    return Registry().with_resources(resources)


def schema_name_for(example: Path) -> str:
    stem = example.name.split(".", 1)[0]
    matches = [key for key in SCHEMA_FILES if stem == key]
    if not matches:
        raise AssertionError(f"没有对应 Schema：{example.name}")
    return SCHEMA_FILES[matches[0]]


def validate(example: Path) -> list[str]:
    schema = load_json(SCHEMAS / schema_name_for(example))
    Validator = validator_for(schema)
    validator = Validator(schema, registry=schema_registry())
    return [error.message for error in validator.iter_errors(load_json(example))]


@pytest.mark.parametrize("example", sorted(EXAMPLES.glob("*.valid.json")))
def test_valid_examples_pass(example: Path) -> None:
    errors = validate(example)
    assert errors == [], f"{example.name}: {errors}"


@pytest.mark.parametrize("example", sorted(EXAMPLES.glob("*.invalid-*.json")))
def test_invalid_examples_fail(example: Path) -> None:
    errors = validate(example)
    assert errors, f"{example.name} 应被拒绝"
