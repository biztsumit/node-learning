import type { Request, Response } from "express";
import * as addressService from "../services/address.services.ts";
import { AppError } from "../utils/app-error.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { CreateAddress, UpdateAddress } from "../validators/address.validators.ts";

// GET /addresses
export const getAddresses = async (req: Request, res: Response): Promise<void> => {

  const addresses = await addressService.listAddresses(currentUser(req).id);

  res.json({
    success: true,
    data: addresses
  });
};

// POST /addresses
export const addAddress = async (req: Checked<Record<string, never>, CreateAddress>, res: Response): Promise<void> => {

  const address = await addressService.createAddress(currentUser(req).id, req.body);

  res.status(201).json({
    success: true,
    data: address
  });
};

// PATCH /addresses/:id
export const editAddress = async (req: Checked<IdParam, UpdateAddress>, res: Response): Promise<void> => {

  const address = await addressService.updateAddress(currentUser(req).id, req.params.id, req.body);

  if (!address) {
    throw new AppError(404, "Address not found");
  }

  res.json({
    success: true,
    data: address
  });
};

// DELETE /addresses/:id
export const removeAddress = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const deleted = await addressService.deleteAddress(currentUser(req).id, req.params.id);

  if (!deleted) {
    throw new AppError(404, "Address not found");
  }

  res.json({
    success: true,
    message: "Address deleted successfully"
  });
};
