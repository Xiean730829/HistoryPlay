interface FloorTimelineProps {
  labels: readonly string[];
  activeIndex: number | null;
}

export function FloorTimeline({ labels, activeIndex }: FloorTimelineProps) {
  return (
    <div className="floor-timeline" aria-label="展位年代顺序">
      {labels.map((label, index) => (
        <span className={index === activeIndex ? "is-active" : ""} key={`${index}-${label}`}>
          {label}
        </span>
      ))}
      <span className="timeline-future" aria-hidden="true">更晚年代</span>
    </div>
  );
}
