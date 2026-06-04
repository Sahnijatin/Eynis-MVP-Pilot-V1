import type { IncomingMessage } from "node:http";
import { isValidRole, type UserRole } from "@eynis/shared";

export interface RequestContext {
  tenantId: string;
  role: UserRole;
  email: string;
}

export const getRequestContext = (req: IncomingMessage): RequestContext | null => {
  const tenantId = req.headers["x-hotel-id"];
  const roleHeader = req.headers["x-user-role"];
  const emailHeader = req.headers["x-user-email"];

  if (typeof tenantId !== "string" || !tenantId.trim()) {
    return null;
  }

  if (typeof roleHeader !== "string" || !isValidRole(roleHeader)) {
    return null;
  }
  if (typeof emailHeader !== "string" || !emailHeader.trim()) {
    return null;
  }

  return {
    tenantId: tenantId.trim(),
    role: roleHeader,
    email: emailHeader.trim().toLowerCase()
  };
};
