import { Router } from "express";
import {
  getAddresses,
  addAddress,
  editAddress,
  removeAddress
} from "../controllers/address.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { createAddressSchema, updateAddressSchema } from "../validators/address.validators.js";

const router = Router();

// Every route works on the logged-in user's own addresses only
router.use(requireAuth);

router.get("/", getAddresses);
router.post("/", validate({ body: createAddressSchema }), addAddress);
router.patch("/:id", validate({ params: idParamSchema, body: updateAddressSchema }), editAddress);
router.delete("/:id", validate({ params: idParamSchema }), removeAddress);

export default router;
