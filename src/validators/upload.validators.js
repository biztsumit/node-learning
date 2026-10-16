import { z } from "zod";
import { productImagePublicId } from "../services/cloudinary.client.js";

// PATCH /products/:id/image — an image uploaded with POST /admin/uploads/product-image, or null to remove it
export const productImageSchema = z.object({
  imageUrl: z
    .string({ error: "imageUrl must be text or null" })
    .trim()
    .refine((url) => productImagePublicId(url) !== null, {
      error: "imageUrl must be an image uploaded through POST /admin/uploads/product-image"
    })
    .nullable()
});
