import * as reportService from "../services/report.services.js";

const send = (res, data) => {
  res.json({
    success: true,
    data
  });
};

// GET /admin/reports/summary
export const getSummary = async (req, res) => {
  send(res, await reportService.getSummary(req.query));
};

// GET /admin/reports/revenue
export const getRevenue = async (req, res) => {
  send(res, await reportService.getRevenueSeries(req.query));
};

// GET /admin/reports/top-products
export const getTopProducts = async (req, res) => {
  send(res, await reportService.getTopProducts(req.query));
};

// GET /admin/reports/customers
export const getCustomers = async (req, res) => {
  send(res, await reportService.getCustomerReport(req.query));
};

// POST /admin/reports/refresh — "show me the latest numbers now"
export const refreshReports = async (req, res) => {
  const refreshedAt = await reportService.refreshSalesReport();
  send(res, { refreshedAt });
};
