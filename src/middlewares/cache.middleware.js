import { catalogCache } from "../cache/catalog-cache.js";

// For routers that change the catalog (products, categories, reviews): after any successful
// write, clear THIS server's cache before the response goes out. Then the admin who just
// saved can't see the old version on their very next request.
// (Other servers find out through the database's NOTIFY; see src/cache/invalidation.js.)
export const clearCatalogCacheOnWrite = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return next();
  }
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) {
      catalogCache.clear();
    }
    return sendJson(body);
  };
  next();
};
