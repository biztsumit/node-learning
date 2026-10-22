import * as addressService from "../services/address.services.ts";
import { AppError } from "../utils/app-error.ts";

// GET /addresses
export const getAddresses = async (req, res) => {

  const addresses = await addressService.listAddresses(req.user.id);

  res.json({
    success: true,
    data: addresses
  });
};

// POST /addresses
export const addAddress = async (req, res) => {

  const address = await addressService.createAddress(req.user.id, req.body);

  res.status(201).json({
    success: true,
    data: address
  });
};

// PATCH /addresses/:id
export const editAddress = async (req, res) => {

  const address = await addressService.updateAddress(req.user.id, req.params.id, req.body);

  if (!address) {
    throw new AppError(404, "Address not found");
  }

  res.json({
    success: true,
    data: address
  });
};

// DELETE /addresses/:id
export const removeAddress = async (req, res) => {

  const deleted = await addressService.deleteAddress(req.user.id, req.params.id);

  if (!deleted) {
    throw new AppError(404, "Address not found");
  }

  res.json({
    success: true,
    message: "Address deleted successfully"
  });
};
