import type { ArtifactProjection } from "../application/museumApi";

export function ArtifactCaption({ artifact }: { artifact: ArtifactProjection }) {
  const dating =
    artifact.time_range.display_label ??
    `${artifact.time_range.start_year}—${artifact.time_range.end_year}年`;
  const teaser = artifact.presentation?.teaser?.trim() || null;

  return (
    <div className="artifact-caption">
      <strong>{artifact.title}</strong>
      <span>{dating}</span>
      {teaser && <p>{teaser}</p>}
    </div>
  );
}
