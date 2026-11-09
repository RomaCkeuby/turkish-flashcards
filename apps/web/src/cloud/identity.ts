let current: string | null = null;
let revision = 0;
export function setCloudIdentity(userId: string | null) {
  if (current !== userId) { current = userId; revision++; }
}
export function cloudIdentityRevision() { return revision; }
