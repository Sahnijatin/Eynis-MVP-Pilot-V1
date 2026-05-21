import type { IncomingMessage } from "node:http";
import { isValidRole, type UserRole } from "@eynis/shared";

export interface RequestContext {
  hotelId: string;
  role: UserRole;
  email: string;
}

export const getRequestContext = (req: IncomingMessage): RequestContext | null => {
  const hotelId = req.headers["x-hotel-id"];
  const roleHeader = req.headers["x-user-role"];
  const emailHeader = req.headers["x-user-email"];

  if (typeof hotelId !== "string" || !hotelId.trim()) {
    return null;
  }

  if (typeof roleHeader !== "string" || !isValidRole(roleHeader)) {
    return null;
  }
  if (typeof emailHeader !== "string" || !emailHeader.trim()) {
    return null;
  }

  return {
    hotelId: hotelId.trim(),
    role: roleHeader,
    email: emailHeader.trim().toLowerCase()
  };
};
