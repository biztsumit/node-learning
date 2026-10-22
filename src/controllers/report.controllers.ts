import type { Request, Response } from "express";
import * as reportService from "../services/report.services.ts";
import type { Checked } from "../types/http.ts";
import type { CustomersQuery, RevenueQuery, SummaryQuery, TopProductsQuery } from "../validators/report.validators.ts";

const send = (res: Response, data: unknown): void => {
  res.json({
    success: true,
    data
  });
};

// GET /admin/reports/summary
export const getSummary = async (req: Checked<Record<string, never>, unknown, SummaryQuery>, res: Response): Promise<void> => {
  send(res, await reportService.getSummary(req.query));
};

// GET /admin/reports/revenue
export const getRevenue = async (req: Checked<Record<string, never>, unknown, RevenueQuery>, res: Response): Promise<void> => {
  send(res, await reportService.getRevenueSeries(req.query));
};

// GET /admin/reports/top-products
export const getTopProducts = async (req: Checked<Record<string, never>, unknown, TopProductsQuery>, res: Response): Promise<void> => {
  send(res, await reportService.getTopProducts(req.query));
};

// GET /admin/reports/customers
export const getCustomers = async (req: Checked<Record<string, never>, unknown, CustomersQuery>, res: Response): Promise<void> => {
  send(res, await reportService.getCustomerReport(req.query));
};

// POST /admin/reports/refresh — "show me the latest numbers now"
export const refreshReports = async (req: Request, res: Response): Promise<void> => {
  const refreshedAt = await reportService.refreshSalesReport();
  send(res, { refreshedAt });
};
