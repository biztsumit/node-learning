import * as userService from "../services/user.services.js";

export const getUsers = async (req, res) => {

  const users = await userService.getAllUsers();

  res.json({
    success: true,
    data: users
  });
};
