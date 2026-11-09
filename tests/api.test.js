"use strict";
const { PostgreSqlContainer } = require("@testcontainers/postgresql");
const { Client } = require("pg");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { createApp } = require("../src/api");

jest.setTimeout(120000);
let container;
let client;
let server;
let baseUrl;

beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    const migrationDirectory = join(__dirname, "../migrations");
    const migrations = readdirSync(migrationDirectory)
        .filter(name => /^V.*__.*[.]sql$/.test(name))
        .sort();
    for (const migration of migrations) {
        await client.query(readFileSync(join(migrationDirectory, migration), "utf8"));
    }

    process.env.DB_HOST = container.getHost();
    process.env.DB_PORT = String(container.getPort());
    process.env.DB_NAME = container.getDatabase();
    process.env.DB_USER = container.getUsername();
    process.env.DB_PASSWORD = container.getPassword();

    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (client) await client.end();
    if (container) await container.stop();
});

test("API creates a product and order, then returns the order", async () => {
    const productResponse = await fetch(`${baseUrl}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: `API-${Date.now()}`, unitPrice: 60000, stock: 5 })
    });
    expect(productResponse.status).toBe(201);
    const product = await productResponse.json();

    const orderResponse = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: `API-${Date.now()}`, productId: product.id, quantity: 2, premium: true })
    });
    expect(orderResponse.status).toBe(201);
    const order = await orderResponse.json();
    expect(order.total).toBe(108000);
    expect(order.status).toBe("CONFIRMED");

    const returnResponse = await fetch(`${baseUrl}/orders/${order.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysSincePurchase: 2, packagingOpen: true })
    });
    expect(returnResponse.status).toBe(200);
    expect((await returnResponse.json()).status).toBe("RETURNED");
});
