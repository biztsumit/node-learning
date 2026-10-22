import * as auditService from "../services/audit.services.js";

// GET /admin/audit-log
export const getAuditLog = async (req, res) => {

  const { entries, pagination } = await auditService.listAuditLog(req.query);

  res.json({
    success: true,
    data: entries,
    pagination
  });
};
