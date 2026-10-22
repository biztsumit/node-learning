import type { Request, Response } from "express";
import * as userService from "../services/user.services.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { Role as RoleChange } from "../validators/audit.validators.ts";

// PATCH /users/:id/role  { role }
export const updateUserRole = async (req: Checked<IdParam, RoleChange>, res: Response): Promise<void> => {

  const user = await userService.changeUserRole(currentUser(req).id, req.params.id, req.body.role);

  res.json({
    success: true,
    data: user
  });
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {

  const users = await userService.getAllUsers();

  res.json({
    success: true,
    data: users
  });
};
