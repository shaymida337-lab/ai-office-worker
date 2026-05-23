import type { Response } from "express";
import { signToken } from "./auth.js";

type UserWithOrg = {
  id: string;
  email: string;
  name: string | null;
  organization: { id: string; name: string } | null;
};

export function sendAuthSuccess(res: Response, user: UserWithOrg) {
  const org = user.organization;
  if (!org) {
    res.status(500).json({ error: "Organization missing" });
    return;
  }

  const token = signToken({
    userId: user.id,
    organizationId: org.id,
    email: user.email,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    organization: {
      id: org.id,
      name: org.name,
    },
  });
}
