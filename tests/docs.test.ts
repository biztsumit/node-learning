// Keeps the API documentation honest: valid, served, and in sync with the real routes
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import app from "../src/app.ts";
import type { OpenAPI } from "openapi-types";
import { openApiDocument } from "../src/docs/openapi.ts";
import { api, closeDatabase } from "./helpers.ts";

after(closeDatabase);

const METHODS = ["get", "post", "put", "patch", "delete"];

const documentedOperations = Object.entries(openApiDocument.paths).flatMap(([path, item]) =>
  METHODS.filter((method) => item[method]).map((method) => ({ method, path }))
);

// Counts the route handlers Express really has (nested routers included)
const countRoutes = (stack) =>
  stack.reduce((total, layer) => {
    if (layer.route) {
      return total + Object.keys(layer.route.methods).filter((m) => m !== "_all").length;
    }
    return total + (layer.handle?.stack ? countRoutes(layer.handle.stack) : 0);
  }, 0);

describe("API documentation", () => {

  it("is a valid OpenAPI document", async () => {
    // Our document is a plain object to TypeScript, not its "OpenAPI document" type, so a cast:
    // this test IS the check that it's a valid OpenAPI document (the parser validates it fully)
    await SwaggerParser.validate(structuredClone(openApiDocument) as unknown as OpenAPI.Document);
  });

  it("is served as JSON and as an interactive page", async () => {
    const json = await api().get("/docs/openapi.json").expect(200);
    assert.equal(json.body.openapi, "3.1.0");

    const page = await api().get("/docs/").expect(200);
    assert.match(page.text, /swagger-ui/);
  });

  it("only documents routes that really exist", async () => {
    for (const { method, path } of documentedOperations) {
      const url = path.replace(/\{slug\}/g, "some-slug").replace(/\{\w+\}/g, "1");
      const res = await api()[method](url).send({});
      const notRouted = res.status === 404 && /^Route .* not found$/.test(res.body?.message ?? "");
      assert.ok(!notRouted, `${method.toUpperCase()} ${path} is documented but has no route`);
    }
  });

  it("documents every route (add new routes to src/docs/openapi.ts)", () => {
    // The only undocumented route is the docs' own GET /docs/openapi.json
    assert.equal(countRoutes(app.router.stack) - 1, documentedOperations.length);
  });
});
