import { Router } from "express";
import {
  getAddresses,
  addAddress,
  editAddress,
  removeAddress
} from "../controllers/address.controllers.ts";
import { requireAuth } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { idParamSchema } from "../validators/common.validators.ts";
import { createAddressSchema, updateAddressSchema } from "../validators/address.validators.ts";

const router = Router();

// Every route works on the logged-in user's own addresses only
router.use(requireAuth);

router.get("/", getAddresses);
router.post("/", validate({ body: createAddressSchema }), addAddress);
router.patch("/:id", validate({ params: idParamSchema, body: updateAddressSchema }), editAddress);
router.delete("/:id", validate({ params: idParamSchema }), removeAddress);

export default router;
