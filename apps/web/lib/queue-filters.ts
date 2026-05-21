export type QueueFilterState = {
  status: string;
  slaState: string;
  assignedToMe: string;
  sortBy: string;
  sortOrder: string;
};

/** Query string to restore filters after POST redirect (no leading ?). */
export function filtersToSearchString(filters: QueueFilterState): string {
  const p = new URLSearchParams();
  if (filters.status) p.set("status", filters.status);
  if (filters.slaState) p.set("slaState", filters.slaState);
  if (filters.sortBy) p.set("sortBy", filters.sortBy);
  if (filters.sortOrder) p.set("sortOrder", filters.sortOrder);
  if (filters.assignedToMe === "true") p.set("assignedToMe", "true");
  return p.toString();
}
