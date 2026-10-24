import type { ArtifactProjection } from "../application/museumApi";

export function ArtifactCaption({ artifact }: { artifact: ArtifactProjection }) {
  return (
    <div className="artifact-caption">
      <strong>{artifact.title}</strong>
      <span>{artifact.time_range.display_label ?? `${artifact.time_range.start_year}—${artifact.time_range.end_year}年`}</span>
    </div>
  );
}
