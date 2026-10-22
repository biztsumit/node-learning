import type { Response } from "express";
import * as auditService from "../services/audit.services.ts";
import type { Checked } from "../types/http.ts";
import type { AuditLogQuery } from "../validators/audit.validators.ts";

// GET /admin/audit-log
export const getAuditLog = async (req: Checked<Record<string, never>, unknown, AuditLogQuery>, res: Response): Promise<void> => {

  const { entries, pagination } = await auditService.listAuditLog(req.query);

  res.json({
    success: true,
    data: entries,
    pagination
  });
};
