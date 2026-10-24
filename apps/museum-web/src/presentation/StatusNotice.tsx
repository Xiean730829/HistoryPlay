interface StatusNoticeProps {
  message: string;
  tone?: "info" | "error" | "success";
}

export function StatusNotice({ message, tone = "info" }: StatusNoticeProps) {
  return (
    <div className={`status-notice status-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true" className="status-indicator" />
      <span>{message}</span>
    </div>
  );
}
