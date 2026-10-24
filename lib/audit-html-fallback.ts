export type InitialHtmlResult = { html: string; status: number };

export type AuditHtmlResult = {
  html: string;
  status: number;
  rendered: boolean;
  renderWarning?: string;
};

/**
 * Prefer Browser Run when available, but keep the audit usable with the safe
 * pinned-IP initial-HTML fetch when the remote renderer fails.
 */
export async function fetchAuditHtmlWithFallback(
  render: () => Promise<string>,
  fetchInitialHtml: () => Promise<InitialHtmlResult>,
): Promise<AuditHtmlResult> {
  let renderWarning: string | undefined;
  try {
    const html = await render();
    return { html, status: 200, rendered: true };
  } catch (error) {
    renderWarning = error instanceof Error
      ? error.message
      : "Browser rendering failed; used initial HTML instead.";
  }

  const initial = await fetchInitialHtml();
  return {
    html: initial.html,
    status: initial.status,
    rendered: false,
    renderWarning,
  };
}
