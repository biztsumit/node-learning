import * as userService from "../services/user.services.ts";

// PATCH /users/:id/role  { role }
export const updateUserRole = async (req, res) => {

  const user = await userService.changeUserRole(req.user.id, req.params.id, req.body.role);

  res.json({
    success: true,
    data: user
  });
};

export const getUsers = async (req, res) => {

  const users = await userService.getAllUsers();

  res.json({
    success: true,
    data: users
  });
};
